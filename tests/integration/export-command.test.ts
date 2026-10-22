import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { openDb, schema as s } from '@/db';
import { LOCK_FILE } from '@/lib/backup-core.mjs';
import { verifyExport, zipEntries } from '@/lib/export-core.mjs';
import { insertFixtures } from '../support/fixtures';
import { addDoc } from '../support/db';

/** The last migration of the code: the one an export names (drizzle/meta/_journal.json). */
const LATEST_MIGRATION = (JSON.parse(readFileSync(path.join(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] }).entries.at(-1)!.tag;

// npm run export and npm run export:check (scripts/codex-export.mjs, point 17 of docs/reste-a-faire.md) as an operator
// runs them: Node in a child process, on a data directory of their own, server stopped. The archive is the one the
// application streams (lib/export-core.mjs), written under a temporary name, read back whole, then named; the export
// is journaled in the database under the system actor Codex. Refused while the server holds the database.

const SCRIPT = path.join(process.cwd(), 'scripts', 'codex-export.mjs');
const scratch = mkdtempSync(path.join(tmpdir(), 'codex-export-cmd-'));
const DATA = path.join(scratch, 'data');
const OUT = path.join(scratch, 'out');
const KEY = '00000000-0000-4000-8000-000000000001-PRO-QUA-0001_A.1.pdf';
const PDF = Buffer.from('%PDF-1.7\n% one\n%%EOF\n');

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

type Run = { code: number; stdout: string; stderr: string };

function run(args: string[], env: Record<string, string | undefined> = {}): Promise<Run> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, CODEX_DATA_DIR: DATA, ...env };
  for (const k of Object.keys(childEnv)) if (childEnv[k] === undefined) delete childEnv[k];
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { cwd: process.cwd(), env: childEnv, timeout: 60_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout, stderr });
    });
  });
}

/** A data directory with a database on disk (the fixtures and one document with its file), closed. */
async function prepare() {
  rmSync(DATA, { recursive: true, force: true });
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(DATA, { recursive: true });
  const db = await openDb(path.join(DATA, 'pglite'));
  try {
    await insertFixtures(db);
    await addDoc(db, { id: 'PRO-QUA-0001' });
    await db.update(s.workingVersions).set({ storage: 'local', fileKey: KEY, fileName: 'procédure.pdf', mime: 'application/pdf', size: PDF.length }).where(eq(s.workingVersions.docId, 'PRO-QUA-0001'));
  } finally {
    await db.$client.close();
  }
  mkdirSync(path.join(DATA, 'files'), { recursive: true });
  writeFileSync(path.join(DATA, 'files', KEY), PDF);
}

describe('npm run export', () => {
  it('writes the archive, checks it, journals it; export:check finds it intact, then altered', async () => {
    await prepare();
    const r = await run(['create', '--out', `${OUT}/`]);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`Dossier de données : ${DATA}\n`);
    const [name] = readdirSync(OUT);
    expect(name).toMatch(/^codex-export-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.zip$/);
    const file = path.join(OUT, name);
    expect(r.stdout).toContain(`Export écrit et vérifié : ${file}`);
    // The journal holds one entry: the start of this export, written in the snapshot.
    expect(r.stdout).toContain('  1 documents, 1 révisions, 1 versions de travail, 0 circuits, 0 demandes Vigie, 1 entrées de journal');
    expect(r.stdout).toContain(`1 fichiers (${PDF.length} o), migration ${LATEST_MIGRATION}`);
    // Nothing else written, the lock released.
    expect(readdirSync(OUT)).toEqual([name]);
    expect(existsSync(path.join(DATA, LOCK_FILE))).toBe(false);

    const fh = await open(file, 'r');
    try {
      const m = await verifyExport(fh);
      expect(m).toMatchObject({ mode: 'offline', by: 'cli', counts: { documents: 1, files: 1, audit_log: 1 } });
      const pdfEntry = m.entries.find((e) => e.name === 'files/PRO-QUA-0001/PRO-QUA-0001_A.1.pdf');
      expect(pdfEntry?.sha256).toBe(createHash('sha256').update(PDF).digest('hex'));
      expect((await zipEntries(fh)).map((e) => e.name)).toContain('import/documents.json');
    } finally {
      await fh.close();
    }
    // Journaled in the database, by the system actor Codex, start and end.
    const db = await openDb(path.join(DATA, 'pglite'));
    try {
      const entries = await db.select().from(s.auditLog).where(eq(s.auditLog.targetKind, 'export'));
      expect(entries.map((e) => [e.userId, e.action])).toEqual([['codex', 'export_full'], ['codex', 'export_full_end']]);
      expect(entries[1].data?.archive?.sha256).toBe(createHash('sha256').update(readFileSync(file)).digest('hex'));
    } finally {
      await db.$client.close();
    }

    const ok = await run(['check', file]);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain(`Archive intacte : ${file}`);
    // One byte of the stored PDF changed in the archive: refused, naming the entry.
    const bytes = readFileSync(file);
    const at = bytes.indexOf(PDF);
    bytes[at + 10] ^= 0xff;
    writeFileSync(file, bytes);
    const bad = await run(['check', file]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('Archive altérée : « files/PRO-QUA-0001/PRO-QUA-0001_A.1.pdf » ne correspond pas');
  }, 120_000);

  it('refuses to run while the server holds the data directory, and writes nothing', async () => {
    await prepare();
    writeFileSync(path.join(DATA, LOCK_FILE), JSON.stringify({ pid: process.pid, kind: 'server', since: new Date().toISOString() }));
    const r = await run(['create', '--out', `${OUT}/`]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`Le serveur Codex tourne (processus ${process.pid}) et tient la base de ${DATA}.`);
    expect(r.stderr).toContain('Administration › Journal d\'audit › Export complet');
    expect(existsSync(OUT) ? readdirSync(OUT) : []).toEqual([]);
  }, 60_000);

  it('writes beside the data directory by default, never inside it', async () => {
    await prepare();
    const inside = await run(['create', '--out', path.join(DATA, 'x.zip')]);
    expect(inside.code).toBe(1);
    expect(inside.stderr).toContain('l\'archive ne peut pas être écrite dans le dossier de données');
    const r = await run(['create']);
    expect(r.code).toBe(0);
    expect(readdirSync(`${DATA}-exports`)).toHaveLength(1);
    rmSync(`${DATA}-exports`, { recursive: true, force: true });
  }, 60_000);
});
