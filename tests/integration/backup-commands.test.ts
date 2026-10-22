import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { openDb, schema as s } from '@/db';
import { createBackup, LOCK_FILE, readLock, readMigrations } from '@/lib/backup-core.mjs';
import { addDoc, pgliteOf, setupDb } from '../support/db';

// The npm commands (scripts/codex-backup.mjs, point 48 of docs/reste-a-faire.md) as an operator runs them: Node in a
// child process, on a data directory of their own. They refuse to run while the server holds the database, and to
// replace a database without --replace; they read the .env files Next reads. And the lock the server takes when it
// opens the database (src/db/index.ts, getDb), which keeps a command and the server off the same directory.

const SCRIPT = path.join(process.cwd(), 'scripts', 'codex-backup.mjs');
const db = setupDb({ engine: 'pglite' });
const scratch = mkdtempSync(path.join(tmpdir(), 'codex-backup-cmd-'));
const DATA = path.join(scratch, 'data');
const BACKUPS = path.join(scratch, 'backups');
const KEY = '00000000-0000-4000-8000-000000000001-PRO-QUA-0001_A.1.pdf';

afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

type Run = { code: number; stdout: string; stderr: string };

/** Runs the command as `npm run …` does: node scripts/codex-backup.mjs <args>, from `cwd`, with `env` over this one's. */
function run(args: string[], env: Record<string, string | undefined> = {}, cwd = process.cwd()): Promise<Run> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, CODEX_DATA_DIR: DATA, CODEX_BACKUP_DIR: BACKUPS, ...env };
  for (const k of Object.keys(childEnv)) if (childEnv[k] === undefined) delete childEnv[k];
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { cwd, env: childEnv, timeout: 60_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout, stderr });
    });
  });
}

/** Every file under `dir`, relative to it, with its content. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = readFileSync(p, 'latin1');
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

/** An archive of the test database (one document and its file) in the backup directory; the data directory in use. */
async function prepare() {
  rmSync(DATA, { recursive: true, force: true });
  rmSync(BACKUPS, { recursive: true, force: true });
  const files = path.join(scratch, 'source-files');
  mkdirSync(files, { recursive: true });
  writeFileSync(path.join(files, KEY), '%PDF-one');
  await addDoc(db(), { id: 'PRO-QUA-0001' });
  await db().update(s.workingVersions).set({ storage: 'local', fileKey: KEY, fileName: 'f.pdf', mime: 'application/pdf', size: 8 }).where(eq(s.workingVersions.docId, 'PRO-QUA-0001'));
  const res = await createBackup({
    pg: pgliteOf(db()), filesDir: files, dbDir: null, backupDir: BACKUPS, keep: 7, mode: 'offline', by: 'cli',
    migrations: await readMigrations(path.join(process.cwd(), 'drizzle')),
  });
  // A data directory already in use: a database (a stand-in) and a file of its own.
  mkdirSync(path.join(DATA, 'pglite'), { recursive: true });
  writeFileSync(path.join(DATA, 'pglite', 'PG_VERSION'), 'in use');
  mkdirSync(path.join(DATA, 'files'));
  writeFileSync(path.join(DATA, 'files', 'mine.pdf'), 'mine');
  return res;
}

describe('npm run backup and npm run restore', () => {
  it('refuse to run while the server holds the data directory, and write nothing', async () => {
    const res = await prepare();
    // The server's lock, of a live process (this one, another process for the command).
    writeFileSync(path.join(DATA, LOCK_FILE), JSON.stringify({ pid: process.pid, kind: 'server', since: new Date().toISOString() }));
    const data = snapshot(DATA);
    const backups = snapshot(BACKUPS);
    for (const args of [['create'], ['restore', res.name], ['restore', res.name, '--replace']]) {
      const r = await run(args);
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.stdout).toContain(`Dossier de données : ${DATA}\nDossier des sauvegardes : ${BACKUPS}\n`);
      expect(r.stderr).toContain(`Le serveur Codex tourne (processus ${process.pid}) et tient la base de ${DATA}.`);
      expect(snapshot(DATA), args.join(' ')).toEqual(data);
      expect(snapshot(BACKUPS), args.join(' ')).toEqual(backups);
    }
  }, 60_000);

  it('refuse to replace a database without --replace, set it aside with it, then back up the restored one', async () => {
    const res = await prepare();
    const before = snapshot(DATA);
    const refused = await run(['restore', res.name]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain(`${DATA} contient déjà une base ou des fichiers.\nPour les remplacer, relancez avec --replace`);
    expect(snapshot(DATA)).toEqual(before);

    const done = await run(['restore', 'latest', '--replace']);
    expect(done.stderr).toBe('');
    expect(done.code).toBe(0);
    expect(done.stdout).toContain(`Base et fichiers restaurés dans ${DATA} depuis ${res.path}`);
    const aside = readdirSync(DATA).find((n) => n.startsWith('replaced-'))!;
    expect(done.stdout).toContain(`mis de côté dans ${path.join(DATA, aside)}`);
    expect(readFileSync(path.join(DATA, aside, 'pglite', 'PG_VERSION'), 'utf8')).toBe('in use');
    expect(readFileSync(path.join(DATA, aside, 'files', 'mine.pdf'), 'utf8')).toBe('mine');
    expect(readdirSync(path.join(DATA, 'files'))).toEqual([KEY]);
    expect(readFileSync(path.join(DATA, 'pglite', 'PG_VERSION'), 'utf8')).toMatch(/^\d+\n$/);
    // The command released the directory.
    expect(readdirSync(DATA).sort()).toEqual(['files', 'pglite', aside]);

    // The restored database, opened by the command itself (server stopped), backed up and checked.
    const backup = await run(['create']);
    expect(backup.stderr).toBe('');
    expect(backup.code).toBe(0);
    expect(backup.stdout).toMatch(/Sauvegarde créée : .*codex-backup-.*\.tar\n/);
    expect(backup.stdout).toContain('1 fichiers (8 o)');
    const check = await run(['check', 'latest']);
    expect(check.code).toBe(0);
    expect(check.stdout).toContain('Archive intacte');
    expect(readdirSync(BACKUPS)).toHaveLength(2);
    expect(existsSync(path.join(DATA, LOCK_FILE))).toBe(false);
  }, 120_000);

  it('read the .env files of next start, or of next dev with --dev, after the environment', async () => {
    const project = path.join(scratch, 'project');
    mkdirSync(project, { recursive: true });
    writeFileSync(path.join(project, '.env.production'), 'CODEX_DATA_DIR=/srv/codex/prod\n');
    writeFileSync(path.join(project, '.env.production.local'), 'CODEX_DATA_DIR=/srv/codex/prod-local\nCODEX_BACKUP_DIR=/mnt/backups\n');
    writeFileSync(path.join(project, '.env.development'), 'CODEX_DATA_DIR=/srv/codex/dev\n');
    const plain = { NODE_ENV: undefined, CODEX_DATA_DIR: undefined, CODEX_BACKUP_DIR: undefined };
    const prod = await run(['list'], plain, project);
    expect(prod.stdout).toContain('Dossier de données : /srv/codex/prod-local\nDossier des sauvegardes : /mnt/backups\nVariables : environnement, puis .env.production.local, .env.production (mode production)\n');
    const dev = await run(['list', '--dev'], plain, project);
    expect(dev.stdout).toContain('Dossier de données : /srv/codex/dev\nDossier des sauvegardes : /srv/codex/dev-backups\n');
    const set = await run(['list'], { ...plain, CODEX_DATA_DIR: '/srv/codex/env' }, project);
    expect(set.stdout).toContain('Dossier de données : /srv/codex/env\nDossier des sauvegardes : /mnt/backups\n');
  }, 60_000);
});

describe('the server', () => {
  it('refuses to open the database while a command works on it, then holds the directory, which the commands respect', async () => {
    const dir = path.join(scratch, 'server');
    mkdirSync(dir, { recursive: true });
    // A restore command, alive (the process that started these tests) and refreshed a minute ago.
    const ago = new Date(Date.now() - 60_000).toISOString();
    writeFileSync(path.join(dir, LOCK_FILE), JSON.stringify({ pid: process.ppid, kind: 'restore', since: ago, beat: ago }));
    vi.resetModules();
    vi.stubEnv('CODEX_DATA_DIR', dir);
    const server = await import('@/db');
    expect(server.DATA_DIR).toBe(dir);
    await expect(server.getDb()).rejects.toMatchObject({ code: 'busy', message: expect.stringContaining(path.join(dir, LOCK_FILE)) });
    expect(existsSync(path.join(dir, 'pglite'))).toBe(false);

    // The command done: a database with someone in it, so that opening it does not seed the demonstration data.
    rmSync(path.join(dir, LOCK_FILE));
    const made = await openDb(path.join(dir, 'pglite'));
    await made.insert(s.users).values({ id: 'someone', name: 'Someone', initials: 'S', role: 'gestionnaire' });
    await made.$client.close();
    const opened = await server.getDb();
    try {
      expect(await readLock(dir)).toMatchObject({ pid: process.pid, kind: 'server' });
      const r = await run(['create'], { CODEX_DATA_DIR: dir });
      expect(r.code).toBe(1);
      expect(r.stderr).toContain(`Le serveur Codex tourne (processus ${process.pid})`);
    } finally {
      await opened.$client.close();
      delete (globalThis as { __codexDb?: unknown }).__codexDb;
    }
  }, 60_000);
});
