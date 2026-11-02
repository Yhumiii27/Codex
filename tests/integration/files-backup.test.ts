import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_DIR, FILES_DIR, schema as s } from '@/db';
import { backUpData, restoreBackedUpFiles } from '@/lib/actions';
import type { Ctx } from '@/lib/context';
import { createFilesBackup, filesBackupDir, listFilesBackups, restoreFiles, stateName, verifyFilesBackup } from '@/lib/files-backup-core.mjs';
import { DICT } from '@/lib/i18n';
import { auditDetailL } from '@/lib/queries';
import { addDoc, setupDb } from '../support/db';
import { actAs } from '../support/session';

// Files backup of a server's database (lib/files-backup-core.mjs; decision of 2 November 2026, the document library on
// our own server: docs/stockage-serveur.md). The database is backed up by the server's pg_dump; Codex copies the files
// it points to, once each, checked by their SHA-256, with a state per run; rotation of the states and of the copies;
// files put back into the store after a loss, never replacing one; the Administration actions.

vi.mock('@/db', async (importOriginal) => {
  const { mkdtempSync: mk } = await import('node:fs');
  const { tmpdir: td } = await import('node:os');
  const { join } = await import('node:path');
  const data = mk(join(td(), 'codex-files-backup-data-'));
  return { ...(await importOriginal<typeof import('@/db')>()), DATA_DIR: data, FILES_DIR: join(data, 'files'), getDb: async () => (await import('../support/db')).currentDb() };
});
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));
// The Administration actions take the server's path (DATABASE_URL) when `server` is set, on PGlite too: what differs
// is only which kind of backup Codex makes (lib/backup.ts).
const engine = vi.hoisted(() => ({ server: false }));
vi.mock('@/db/sql-client', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db/sql-client')>();
  return { ...real, embedded: (c: Parameters<typeof real.embedded>[0]) => (engine.server ? null : real.embedded(c)) };
});

const db = setupDb();
const scratch = mkdtempSync(path.join(tmpdir(), 'codex-files-backup-'));
const BACKUPS = path.join(scratch, 'backups');
const sha = (b: string) => createHash('sha256').update(b).digest('hex');
const key = (i: number, name: string) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}-${name}`;
const put = (k: string, bytes: string) => writeFileSync(path.join(FILES_DIR, k), bytes);
let n = 0;

beforeEach(() => {
  mkdirSync(FILES_DIR, { recursive: true });
});
afterEach(() => {
  engine.server = false;
  rmSync(FILES_DIR, { recursive: true, force: true });
  rmSync(BACKUPS, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(DATA_DIR, { recursive: true, force: true });
});

/** A document whose working version points to a stored file `k`, with its SHA-256 recorded. */
async function withFile(id: string, k: string, bytes: string, opts: { storage?: string; sha256?: string | null } = {}) {
  await addDoc(db(), { id });
  const storage = opts.storage ?? 'local';
  if (storage === 'local') put(k, bytes);
  await db().update(s.workingVersions)
    .set({ storage, fileKey: k, fileName: 'f.pdf', mime: 'application/pdf', size: bytes.length, sha256: opts.sha256 === undefined ? sha(bytes) : opts.sha256 })
    .where(eq(s.workingVersions.docId, id));
}

const K1 = key(1, 'PRO-QUA-0001_A.1.pdf'), K2 = key(2, 'PRO-QUA-0002_A.1.pdf');

async function fill() {
  await withFile('PRO-QUA-0001', K1, '%PDF-one');
  await withFile('PRO-QUA-0002', K2, '%PDF-two-two');
  await withFile('PRO-QUA-0003', 'sp-drive-item-id', '%PDF-sp', { storage: 'sharepoint' });
  put(key(9, 'upload.pdf'), 'orphan');
}

function backup(opts: Partial<Parameters<typeof createFilesBackup>[0]> = {}) {
  n++;
  return createFilesBackup({ pg: db().$client, filesDir: FILES_DIR, backupDir: BACKUPS, keep: 7, by: 'manager', now: new Date(Date.UTC(2026, 10, 2, 8, 0, n)), ...opts });
}

const objects = () => readdirSync(path.join(filesBackupDir(BACKUPS), 'objets')).sort();

describe('createFilesBackup', () => {
  it('copies the local files the database points to, once, and writes a state that lists and hashes them', async () => {
    await fill();
    const first = await backup();
    expect(first.name).toBe(stateName(new Date(first.state.createdAt)));
    expect(first.state).toMatchObject({
      format: 'codex-files-backup', version: 1, by: 'manager', counts: { documents: 3 },
      // The orphan is left out; the SharePoint file is counted, not copied.
      files: { count: 2, bytes: 8 + 12, copied: 2, copiedBytes: 20, missing: [], altered: [], sharepoint: 1 },
    });
    expect(first.state.entries).toEqual([{ key: K1, size: 8, sha256: sha('%PDF-one') }, { key: K2, size: 12, sha256: sha('%PDF-two-two') }]);
    expect(objects()).toEqual([K1, K2]);
    expect(readFileSync(path.join(filesBackupDir(BACKUPS), 'objets', K1), 'utf8')).toBe('%PDF-one');

    // A new file: only it is copied; the state lists all three.
    const K3 = key(3, 'PRO-QUA-0004_A.1.pdf');
    await withFile('PRO-QUA-0004', K3, '%PDF-three');
    const second = await backup();
    expect(second.state.files).toMatchObject({ count: 3, copied: 1, copiedBytes: 10 });
    expect(objects()).toEqual([K1, K2, K3]);
    expect((await listFilesBackups(BACKUPS)).map((b) => b.name)).toEqual([second.name, first.name]);
    expect(await verifyFilesBackup(BACKUPS, second.name)).toEqual({ checked: 3, bytes: 30, altered: [], missing: [] });
  });

  it('records a file the store lacks and one whose bytes no longer match, and copies neither', async () => {
    await fill();
    unlinkSync(path.join(FILES_DIR, K1));
    put(K2, '%PDF-two-TWO');
    const res = await backup();
    expect(res.state.files).toMatchObject({ count: 0, copied: 0, missing: [K1], altered: [K2] });
    expect(objects()).toEqual([]);
  });

  it('copies a file renamed since under the key the database records', async () => {
    await withFile('PRO-QUA-0001', K1, '%PDF-one');
    const renamed = `${K1.slice(0, 37)}PRO-QUA-0001_A.2.pdf`;
    writeFileSync(path.join(FILES_DIR, renamed), '%PDF-one');
    unlinkSync(path.join(FILES_DIR, K1));
    const res = await backup();
    expect(res.state.files).toMatchObject({ count: 1, missing: [] });
    expect(objects()).toEqual([K1]);
  });

  it('keeps the rotation of the archives, and removes the copies no kept state lists', async () => {
    await withFile('PRO-QUA-0001', K1, '%PDF-one');
    const old = await backup({ keep: 1, now: new Date(Date.UTC(2026, 10, 1, 8)) });
    // The file is no longer pointed to (a reclassification, a rename): the next states do not list it.
    const K2b = key(2, 'PRO-QUA-0001_A.2.pdf');
    put(K2b, '%PDF-new');
    await db().update(s.workingVersions).set({ fileKey: K2b, size: 8, sha256: sha('%PDF-new') }).where(eq(s.workingVersions.docId, 'PRO-QUA-0001'));
    expect(objects()).toEqual([K1]);
    // keep 1: the latest state, and the latest of the last day that has one: the state of 1 November goes, and its copy.
    const next = await backup({ keep: 1, now: new Date(Date.UTC(2026, 10, 2, 8)) });
    expect(next.removed).toEqual([old.name]);
    expect(next.pruned).toBe(1);
    expect(objects()).toEqual([K2b]);
    const last = await backup({ keep: 1, now: new Date(Date.UTC(2026, 10, 2, 9)) });
    expect(last.removed).toEqual([next.name]);
    expect((await listFilesBackups(BACKUPS)).map((b) => b.name)).toEqual([last.name]);
  });

  it('refuses a backup directory inside the files, or holding them', async () => {
    await expect(backup({ backupDir: path.join(FILES_DIR, 'b') })).rejects.toMatchObject({ code: 'backup_dir' });
    await expect(backup({ backupDir: path.dirname(FILES_DIR) })).rejects.toMatchObject({ code: 'backup_dir' });
  });
});

describe('restoreFiles', () => {
  it('puts back the files the store lacks, checked, without touching those present', async () => {
    await fill();
    await backup();
    rmSync(FILES_DIR, { recursive: true, force: true });
    mkdirSync(FILES_DIR);
    put(K2, 'kept as it is');
    const res = await restoreFiles({ pg: db().$client, filesDir: FILES_DIR, backupDir: BACKUPS });
    expect(res).toEqual({ referenced: 2, present: 1, restored: [K1], restoredBytes: 8, notInBackup: [], altered: [] });
    expect(readFileSync(path.join(FILES_DIR, K1), 'utf8')).toBe('%PDF-one');
    expect(readFileSync(path.join(FILES_DIR, K2), 'utf8')).toBe('kept as it is');
  });

  it('reports a file absent from the backup, and an altered copy it does not put back', async () => {
    await withFile('PRO-QUA-0001', K1, '%PDF-one');
    await backup();
    await withFile('PRO-QUA-0002', K2, '%PDF-two-two');
    writeFileSync(path.join(filesBackupDir(BACKUPS), 'objets', K1), '%PDF-ONE');
    rmSync(FILES_DIR, { recursive: true, force: true });
    const res = await restoreFiles({ pg: db().$client, filesDir: FILES_DIR, backupDir: BACKUPS });
    expect(res).toMatchObject({ restored: [], notInBackup: [K2], altered: [K1] });
    expect(existsSync(path.join(FILES_DIR, K1))).toBe(false);
  });

  it('puts back, under the key the database records, a file renamed between the dump and the files backup', async () => {
    await withFile('PRO-QUA-0001', K1, '%PDF-one');
    // The files backup saw the file under its final name; the database restored records the provisional one.
    const final = `${K1.slice(0, 37)}PRO-QUA-0001_A.2.pdf`;
    put(final, '%PDF-one');
    await db().update(s.workingVersions).set({ fileKey: final }).where(eq(s.workingVersions.docId, 'PRO-QUA-0001'));
    await backup();
    await db().update(s.workingVersions).set({ fileKey: K1 }).where(eq(s.workingVersions.docId, 'PRO-QUA-0001'));
    rmSync(FILES_DIR, { recursive: true, force: true });
    expect(await restoreFiles({ pg: db().$client, filesDir: FILES_DIR, backupDir: BACKUPS })).toMatchObject({ restored: [K1], notInBackup: [], altered: [] });
    expect(readFileSync(path.join(FILES_DIR, K1), 'utf8')).toBe('%PDF-one');
  });

  it('checks a file stored without a recorded fingerprint against the one the state gives', async () => {
    await withFile('PRO-QUA-0001', K1, '%PDF-one', { sha256: null });
    const b = await backup();
    expect(b.state.entries[0].sha256).toBe(sha('%PDF-one'));
    writeFileSync(path.join(filesBackupDir(BACKUPS), 'objets', K1), '%PDF-ONE');
    unlinkSync(path.join(FILES_DIR, K1));
    expect(await restoreFiles({ pg: db().$client, filesDir: FILES_DIR, backupDir: BACKUPS })).toMatchObject({ restored: [], altered: [K1] });
  });
});

describe('the Administration actions on a server database', () => {
  const ctx = (seesAll: boolean) => ({ t: DICT.fr, lang: 'fr', seesAll }) as unknown as Ctx;

  it('backs up the files, journaled with counts only, and puts them back', async () => {
    engine.server = true;
    vi.stubEnv('CODEX_BACKUP_DIR', BACKUPS);
    await fill();
    actAs('manager');
    expect(await backUpData()).toEqual({ ok: true, message: 'Fichiers sauvegardés : 2 (20 o), dont 2 copiés par cette sauvegarde. Fichiers conservés sur SharePoint, non inclus : 1.' });
    // Within 15 minutes of the latest state: refused, as for an archive.
    expect(await backUpData()).toMatchObject({ ok: false, error: expect.stringMatching(/^La dernière sauvegarde date du/) });
    const [entry] = await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'backup_created'));
    expect(entry.data?.backup).toMatchObject({ scope: 'files', files: 2, bytes: 20, copied: 2, size: 20, missing: 0, altered: 0, sharepoint: 1 });
    expect(auditDetailL(ctx(true), entry)).toBe('fichiers seulement · fichiers : 2 (20 o) · copiés : 2 (20 o) · sur SharePoint, non inclus : 1');
    expect(auditDetailL(ctx(false), entry)).toBe('fichiers seulement');

    rmSync(FILES_DIR, { recursive: true, force: true });
    expect(await restoreBackedUpFiles()).toEqual({ ok: true, message: 'Fichiers remis en place : 2 (20 o) ; déjà présents : 0.' });
    expect(readFileSync(path.join(FILES_DIR, K2), 'utf8')).toBe('%PDF-two-two');
    const [put] = await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'files_restored'));
    expect(put).toMatchObject({ userId: 'manager', targetKind: 'backup', targetId: 'fichiers' });
    expect(put.data?.backup).toMatchObject({ scope: 'files', files: 2, bytes: 20, missing: 0 });
  });

  it('is refused to anyone but a records manager', async () => {
    engine.server = true;
    vi.stubEnv('CODEX_BACKUP_DIR', BACKUPS);
    await fill();
    for (const who of ['owner', 'auditor', 'head'] as const) {
      actAs(who);
      expect(await backUpData(), who).toEqual({ ok: false, error: DICT.fr.forbidden });
      expect(await restoreBackedUpFiles(), who).toEqual({ ok: false, error: DICT.fr.forbidden });
    }
    expect(existsSync(BACKUPS)).toBe(false);
  });

  // On PGlite only: npm run test:pg runs the suite on a server, where the action puts files back.
  it.skipIf(!!process.env.CODEX_TEST_DATABASE_URL?.trim())('leaves putting files back to npm run restore with the embedded database', async () => {
    vi.stubEnv('CODEX_BACKUP_DIR', BACKUPS);
    actAs('manager');
    expect(await restoreBackedUpFiles()).toEqual({ ok: false, error: DICT.fr.backup_restore_archive });
  });
});
