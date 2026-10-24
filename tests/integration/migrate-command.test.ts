import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openDb } from '@/db';
import { LOCK_FILE, readMigrations } from '@/lib/backup-core.mjs';

// npm run db:migrate (scripts/codex-migrate.mts, point 51 of docs/reste-a-faire.md): the migrations applied at
// deployment, as an operator runs the command, on a PGlite data directory of its own. A new database gets the schema and
// no data; a database with a pending migration is backed up, migrated, and the backup journaled; --check changes
// nothing; the server's lock keeps the command off its database.

const TSX = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
const SCRIPT = path.join(process.cwd(), 'scripts', 'codex-migrate.mts');
const scratch = mkdtempSync(path.join(tmpdir(), 'codex-migrate-cmd-'));
const DATA = path.join(scratch, 'data');
const BACKUPS = path.join(scratch, 'backups');

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

type Run = { code: number; stdout: string; stderr: string };

function run(args: string[], env: Record<string, string | undefined> = {}): Promise<Run> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, CODEX_DATA_DIR: DATA, CODEX_BACKUP_DIR: BACKUPS, DATABASE_URL: '', CODEX_MIGRATION_BACKUP: '', ...env };
  for (const k of Object.keys(childEnv)) if (childEnv[k] === undefined) delete childEnv[k];
  return new Promise((resolve) => {
    execFile(process.execPath, [TSX, '--conditions=react-server', SCRIPT, ...args], { env: childEnv, timeout: 120_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout, stderr });
    });
  });
}

/** The tags of the migrations the database of DATA applied, its number of people and backup entries of the journal. */
async function state() {
  const db = await openDb(path.join(DATA, 'pglite'));
  try {
    const q = <T,>(text: string) => db.$client.query<T>(text).then((r) => r.rows);
    const [{ n }] = await q<{ n: number }>('select count(*)::int as n from codex.__drizzle_migrations');
    const [{ users }] = await q<{ users: number }>('select count(*)::int as users from users');
    const backups = await q<{ detail: string }>(`select detail from audit_log where action = 'backup_created'`);
    return { migrations: n, users, backups: backups.map((b) => b.detail) };
  } finally {
    await db.$client.close();
  }
}

describe('npm run db:migrate', () => {
  it('creates a new database with the schema and no data; --check says what is pending', { timeout: 180_000 }, async () => {
    const code = await readMigrations(path.join(process.cwd(), 'drizzle'));
    const before = await run(['--check']);
    expect(before.code).toBe(1);
    expect(before.stdout).toContain('Base neuve');
    expect(existsSync(path.join(DATA, 'pglite', 'PG_VERSION'))).toBe(false);
    const done = await run([]);
    expect(done.code, done.stderr).toBe(0);
    expect(done.stdout).toContain(`Appliquée(s) : ${code.map((m) => m.tag).join(', ')}`);
    const after = await run(['--check']);
    expect([after.code, after.stdout.includes('Aucune migration en attente')]).toEqual([0, true]);
    expect(await state()).toEqual({ migrations: code.length, users: 0, backups: [] });
    // Nothing to back up for a new database; the lock is released.
    expect(existsSync(BACKUPS)).toBe(false);
    expect(existsSync(path.join(DATA, LOCK_FILE))).toBe(false);
  });

  it('backs up a database before applying its pending migration, journals it, then has nothing left to do', { timeout: 180_000 }, async () => {
    // The last migration undone by hand: the database is one version behind, and holds a person.
    const code = await readMigrations(path.join(process.cwd(), 'drizzle'));
    const last = code[code.length - 1];
    const db = await openDb(path.join(DATA, 'pglite'));
    await db.$client.exec(`insert into users (id, name, initials, role) values ('p1', 'P', 'P', 'collaborateur'), ('codex', 'Codex', 'CX', 'collaborateur')`);
    // The last migration, 0002_pub_programmes_recherche, undone: its view.
    expect(last.tag).toBe('0002_pub_programmes_recherche');
    await db.$client.exec(`delete from codex.__drizzle_migrations where created_at = ${last.createdAt};
      drop view pub_programmes_recherche;`);
    await db.$client.close();
    const pending = await run(['--check']);
    expect([pending.code, pending.stdout]).toEqual([1, expect.stringContaining(`Migration(s) en attente : ${last.tag}.`)]);
    const done = await run([]);
    expect(done.code, done.stderr).toBe(0);
    expect(done.stdout).toContain('Sauvegarde avant migration');
    expect(readdirSync(BACKUPS).filter((f) => f.endsWith('.tar'))).toHaveLength(1);
    expect(await state()).toEqual({ migrations: code.length, users: 2, backups: [`npm run db:migrate (${last.tag})`] });
    const again = await run([]);
    expect([again.code, again.stdout.includes('Aucune migration en attente')]).toEqual([0, true]);
    expect(readdirSync(BACKUPS).filter((f) => f.endsWith('.tar'))).toHaveLength(1);
  });

  it('refuses while the server holds the database, and a wrong usage', { timeout: 120_000 }, async () => {
    writeFileSync(path.join(DATA, LOCK_FILE), JSON.stringify({ kind: 'server', pid: process.pid, since: new Date().toISOString(), host: 'test' }));
    try {
      const busy = await run([]);
      expect(busy.code).toBe(1);
      expect(busy.stderr).toContain('Le serveur Codex tourne');
    } finally {
      rmSync(path.join(DATA, LOCK_FILE), { force: true });
    }
    expect((await run(['--force'])).code).toBe(2);
  });
});
