import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { openDb, schema as s } from '@/db';
import { LOCK_FILE } from '@/lib/backup-core.mjs';
import { insertFixtures } from '../support/fixtures';
import { addDoc } from '../support/db';

// npm run integrity (scripts/codex-integrity.mjs, point 31 of docs/reste-a-faire.md) as an operator runs it: Node in a
// child process, on a data directory of its own, server stopped. It reads every stored file again, compares it with
// the SHA-256 recorded at its upload, journals the check under the system actor Codex, and exits with 1 on a
// discrepancy, so that a scheduler can raise an alert. Refused while the server holds the database.

const SCRIPT = path.join(process.cwd(), 'scripts', 'codex-integrity.mjs');
const scratch = mkdtempSync(path.join(tmpdir(), 'codex-integrity-cmd-'));
const DATA = path.join(scratch, 'data');
const KEY = '00000000-0000-4000-8000-000000000001-PRO-QUA-0001_A.1.pdf';
const PDF = Buffer.from('%PDF-1.7\n% one\n%%EOF\n');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

type Run = { code: number; stdout: string; stderr: string };

function run(args: string[] = []): Promise<Run> {
  const env: NodeJS.ProcessEnv = { ...process.env, CODEX_DATA_DIR: DATA };
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { cwd: process.cwd(), env, timeout: 60_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout, stderr });
    });
  });
}

/** A data directory with one document whose file is stored with `recorded` as its fingerprint, closed. */
async function prepare(recorded: string | null) {
  rmSync(DATA, { recursive: true, force: true });
  mkdirSync(DATA, { recursive: true });
  const db = await openDb(path.join(DATA, 'pglite'));
  try {
    await insertFixtures(db);
    await addDoc(db, { id: 'PRO-QUA-0001' });
    await db.update(s.workingVersions).set({ storage: 'local', fileKey: KEY, fileName: 'procédure.pdf', mime: 'application/pdf', size: PDF.length, sha256: recorded }).where(eq(s.workingVersions.docId, 'PRO-QUA-0001'));
  } finally {
    await db.$client.close();
  }
  mkdirSync(path.join(DATA, 'files'), { recursive: true });
  writeFileSync(path.join(DATA, 'files', KEY), PDF);
}

/** The journal entries of the checks, and the fingerprint now recorded, read once the command has ended. */
async function after() {
  const db = await openDb(path.join(DATA, 'pglite'));
  try {
    const entries = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'integrity_checked'));
    const [v] = await db.select().from(s.workingVersions).where(eq(s.workingVersions.docId, 'PRO-QUA-0001'));
    return { entries, sha256: v.sha256 };
  } finally {
    await db.$client.close();
  }
}

describe('npm run integrity', () => {
  it('finds every file intact, records a missing fingerprint, journals the check and exits with 0', async () => {
    await prepare(null);
    const r = await run();
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`Dossier de données : ${DATA}\n`);
    expect(r.stdout).toContain(`Fichiers vérifiés : 1 (${PDF.length} o)`);
    expect(r.stdout).toContain('Empreintes enregistrées pour des fichiers déposés avant leur calcul : 1');
    expect(r.stdout).toContain('Aucun écart.');
    expect(existsSync(path.join(DATA, LOCK_FILE))).toBe(false);
    const { entries, sha256 } = await after();
    expect(sha256).toBe(sha(PDF));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ userId: 'codex', targetKind: 'integrity', targetId: 'files' });
    expect(entries[0].data?.integrity).toMatchObject({ checked: 1, alteredCount: 0, missingCount: 0, filled: 1, by: 'cli' });
  });

  it('names an altered file and exits with 1', async () => {
    await prepare(sha(Buffer.from('what was uploaded')));
    const r = await run();
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('ALTÉRÉS (contenu différent de l\'empreinte SHA-256 enregistrée) : 1 : PRO-QUA-0001 A.1');
    const { entries, sha256 } = await after();
    // Reported, never overwritten.
    expect(sha256).toBe(sha(Buffer.from('what was uploaded')));
    expect(entries[0].data?.integrity).toMatchObject({ alteredCount: 1, altered: [{ doc: 'PRO-QUA-0001', label: 'A.1' }] });
  });

  it('is refused while the server holds the database', async () => {
    await prepare(sha(PDF));
    writeFileSync(path.join(DATA, LOCK_FILE), JSON.stringify({ pid: process.pid, kind: 'server', since: new Date().toISOString() }));
    const r = await run();
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Le serveur Codex tourne');
    expect((await after()).entries).toEqual([]);
  });
});
