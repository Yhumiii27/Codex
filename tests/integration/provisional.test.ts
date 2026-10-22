import { linkSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { FILES_DIR, schema as s } from '@/db';
import { renameProvisionalFiles } from '@/lib/actions';
import type { Ctx } from '@/lib/context';
import { DICT } from '@/lib/i18n';
import { orphanReport } from '@/lib/orphans';
import { provisionalReport, renameProvisional } from '@/lib/provisional';
import { auditDetailL } from '@/lib/queries';
import { runTask } from '@/lib/scheduler';
import { nameStoredFile, PROVISIONAL_LOCAL_KEY } from '@/lib/storage';
import { addDoc, setupDb } from '../support/db';
import { actAs } from '../support/session';

// Files left under their provisional name (point 36 of docs/reste-a-faire.md, lib/provisional.ts): a record written, the
// rename to {ID}_{version}.{ext} never done (a process stopped between the commit and nameStoredFile, the store out of
// reach). Listed without changing anything, then given their name by a records manager or the scheduler, journaled.
// Files are written for real in a throwaway FILES_DIR (never .data/): their ctime is the real time, so the tests move
// `now` past the grace period.

vi.mock('@/db', async (importOriginal) => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { ...(await importOriginal<typeof import('@/db')>()), FILES_DIR: mkdtempSync(join(tmpdir(), 'codex-provisional-')), getDb: async () => (await import('../support/db')).currentDb() };
});
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();

afterEach(() => {
  for (const f of readdirSync(FILES_DIR)) rmSync(path.join(FILES_DIR, f));
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(() => {
  rmSync(FILES_DIR, { recursive: true, force: true });
});

const HOUR = 3_600_000;
const later = () => Date.now() + 25 * HOUR;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const put = (k: string, bytes = 'x') => writeFileSync(path.join(FILES_DIR, k), bytes);
const stored = () => readdirSync(FILES_DIR).sort();
const keyOf = async (id: string, n = 1) => (await db().select({ k: s.workingVersions.fileKey }).from(s.workingVersions).where(and(eq(s.workingVersions.docId, id), eq(s.workingVersions.n, n))))[0]?.k;
const quiet = () => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
};

/** Document `id`, revision A drafted, its working version A.n stored under `fileKey` (written unless `write` is false). */
async function recorded(id: string, fileKey: string, opts: { versions?: number; write?: boolean; name?: string; mime?: string } = {}) {
  await addDoc(db(), { id, revisions: [{ letter: 'A', status: 'draft', versions: Array.from({ length: opts.versions ?? 1 }, () => 'owner' as const) }] });
  const n = opts.versions ?? 1;
  if (opts.write !== false) put(fileKey, `${id} A.${n}`);
  await db().update(s.workingVersions).set({ storage: 'local', fileKey, fileName: opts.name ?? 'Rapport final.pdf', mime: opts.mime ?? 'application/pdf', size: 10 })
    .where(and(eq(s.workingVersions.docId, id), eq(s.workingVersions.n, n)));
}

describe('provisional keys', () => {
  it('are those stageFile gives, not final names nor files put by hand', () => {
    expect(PROVISIONAL_LOCAL_KEY.test(`${uuid(1)}-upload.pdf`)).toBe(true);
    expect(PROVISIONAL_LOCAL_KEY.test(`${uuid(1)}-upload`)).toBe(true);
    expect(PROVISIONAL_LOCAL_KEY.test(`${uuid(1)}-PRO-QUA-0001_A.1.pdf`)).toBe(false);
    expect(PROVISIONAL_LOCAL_KEY.test('upload.pdf')).toBe(false);
    expect(PROVISIONAL_LOCAL_KEY.test(`${uuid(1)}-upload.pdf/../x`)).toBe(false);
  });
});

describe('the dry run', () => {
  it('lists records still under a provisional name once past the grace period, and changes nothing', async () => {
    await recorded('PRO-QUA-0001', `${uuid(1)}-upload.pdf`);
    await recorded('PRO-QUA-0002', `${uuid(2)}-upload.docx`, { name: 'Note.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    // Already named, a missing file, a file nobody records: none is to rename.
    await recorded('PRO-QUA-0003', `${uuid(3)}-PRO-QUA-0003_A.1.pdf`);
    await recorded('PRO-QUA-0004', `${uuid(4)}-upload.pdf`, { write: false });
    put(`${uuid(5)}-upload.pdf`);
    const before = stored();
    const now = await provisionalReport({ env: {} });
    expect([now.local.due, now.local.recent, now.local.missing]).toEqual([[], 2, 1]);
    const r = await provisionalReport({ now: later(), env: {} });
    expect(r.graceHours).toBe(24);
    expect(r.local.due.map((f) => [f.key, f.name])).toEqual([
      [`${uuid(1)}-upload.pdf`, 'PRO-QUA-0001_A.1.pdf'],
      [`${uuid(2)}-upload.docx`, 'PRO-QUA-0002_A.1.docx'],
    ].sort((a, b) => a[0].localeCompare(b[0])));
    expect(r.local.missing).toBe(1);
    expect(r.sharepoint).toBeNull();
    expect(stored()).toEqual(before);
    expect(await keyOf('PRO-QUA-0001')).toBe(`${uuid(1)}-upload.pdf`);
    // A file under a provisional name that a record points to is no orphan: the orphan removal never touches it.
    expect((await orphanReport({ now: later(), env: {} })).local.orphans.map((f) => f.key)).toEqual([`${uuid(5)}-upload.pdf`]);
  });
});

describe('the rename', () => {
  it('gives the file its name, moves the record, removes the old key and journals it', async () => {
    quiet();
    await recorded('PRO-QUA-0001', `${uuid(1)}-upload.pdf`, { versions: 2 });
    const res = await renameProvisional('manager', { now: later(), env: {} });
    expect(res).toEqual({ renamed: [{ store: 'local', from: `${uuid(1)}-upload.pdf`, to: `${uuid(1)}-PRO-QUA-0001_A.2.pdf`, doc: 'PRO-QUA-0001', label: 'A.2' }], failed: 0, kept: 0, left: 0 });
    expect(stored()).toEqual([`${uuid(1)}-PRO-QUA-0001_A.2.pdf`]);
    expect(await keyOf('PRO-QUA-0001', 2)).toBe(`${uuid(1)}-PRO-QUA-0001_A.2.pdf`);
    const [entry] = await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'files_renamed'));
    expect(entry).toMatchObject({ userId: 'manager', docId: null, targetKind: 'storage', targetId: 'local' });
    // The names carry a draft's ID and version: records managers only (D-14).
    const as = (seesAll: boolean) => auditDetailL({ t: DICT.fr, lang: 'fr', seesAll } as Ctx, entry);
    expect(as(true)).toBe(`Fichiers : 1 · PRO-QUA-0001 A.2 : ${uuid(1)}-upload.pdf → ${uuid(1)}-PRO-QUA-0001_A.2.pdf`);
    expect(as(false)).toBe('Fichiers : 1');
    // Nothing left: a second run renames nothing and journals nothing.
    expect(await renameProvisional('manager', { now: later(), env: {} })).toEqual({ renamed: [], failed: 0, kept: 0, left: 0 });
    expect(await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'files_renamed'))).toHaveLength(1);
  });

  it('finishes a rename that linked the final name and stopped, and never replaces another file', async () => {
    quiet();
    await recorded('PRO-QUA-0001', `${uuid(1)}-upload.pdf`);
    await recorded('PRO-QUA-0002', `${uuid(2)}-upload.pdf`);
    // 0001: the final name already linked to the same file (stopped before the record changed).
    linkSync(path.join(FILES_DIR, `${uuid(1)}-upload.pdf`), path.join(FILES_DIR, `${uuid(1)}-PRO-QUA-0001_A.1.pdf`));
    // 0002: another file under its final name.
    put(`${uuid(2)}-PRO-QUA-0002_A.1.pdf`, 'someone else');
    const res = await renameProvisional('manager', { now: later(), env: {} });
    expect(res).toMatchObject({ failed: 1, left: 1 });
    expect(res !== 'busy' && res.renamed.map((r) => r.to)).toEqual([`${uuid(1)}-PRO-QUA-0001_A.1.pdf`]);
    expect(await keyOf('PRO-QUA-0001')).toBe(`${uuid(1)}-PRO-QUA-0001_A.1.pdf`);
    expect(await keyOf('PRO-QUA-0002')).toBe(`${uuid(2)}-upload.pdf`);
    expect(stored()).toEqual([`${uuid(1)}-PRO-QUA-0001_A.1.pdf`, `${uuid(2)}-PRO-QUA-0002_A.1.pdf`, `${uuid(2)}-upload.pdf`]);
    expect(statSync(path.join(FILES_DIR, `${uuid(2)}-PRO-QUA-0002_A.1.pdf`)).size).toBe('someone else'.length);
    const [entry] = await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'files_renamed'));
    expect(entry.data?.rename).toEqual({ files: [{ from: `${uuid(1)}-upload.pdf`, to: `${uuid(1)}-PRO-QUA-0001_A.1.pdf`, doc: 'PRO-QUA-0001', label: 'A.1' }], failed: 1 });
  });

  it('nameStoredFile itself goes through when the final name is already the same file', async () => {
    await recorded('PRO-QUA-0001', `${uuid(1)}-upload.pdf`);
    linkSync(path.join(FILES_DIR, `${uuid(1)}-upload.pdf`), path.join(FILES_DIR, `${uuid(1)}-PRO-QUA-0001_A.1.pdf`));
    await nameStoredFile({ storage: 'local', fileKey: `${uuid(1)}-upload.pdf`, fileName: 'x.pdf', mime: 'application/pdf', size: 1, pages: null, sha256: '', ext: '.pdf' }, 'PRO-QUA-0001', 'A.1');
    expect(await keyOf('PRO-QUA-0001')).toBe(`${uuid(1)}-PRO-QUA-0001_A.1.pdf`);
    expect(stored()).toEqual([`${uuid(1)}-PRO-QUA-0001_A.1.pdf`]);
  });

  it('renames only the keys shown that are still due: never another one a page sends', async () => {
    quiet();
    await recorded('PRO-QUA-0001', `${uuid(1)}-upload.pdf`);
    await recorded('PRO-QUA-0002', `${uuid(2)}-upload.pdf`);
    await recorded('PRO-QUA-0003', `${uuid(3)}-PRO-QUA-0003_A.1.pdf`);
    const res = await renameProvisional('manager', { keys: [`${uuid(1)}-upload.pdf`, `${uuid(3)}-PRO-QUA-0003_A.1.pdf`, '../etc/passwd'], now: later(), env: {} });
    expect(res !== 'busy' && [res.renamed.map((r) => r.doc), res.kept, res.left]).toEqual([['PRO-QUA-0001'], 2, 1]);
    expect(await keyOf('PRO-QUA-0002')).toBe(`${uuid(2)}-upload.pdf`);
    expect(await keyOf('PRO-QUA-0003')).toBe(`${uuid(3)}-PRO-QUA-0003_A.1.pdf`);
  });

  it('follows the ID of a document reclassified since: the name it has now', async () => {
    quiet();
    await recorded('PRO-QUA-0001', `${uuid(1)}-upload.pdf`);
    await db().update(s.documents).set({ id: 'PRO-ING-0001' }).where(eq(s.documents.id, 'PRO-QUA-0001'));
    await renameProvisional('manager', { now: later(), env: {} });
    expect(stored()).toEqual([`${uuid(1)}-PRO-ING-0001_A.1.pdf`]);
  });
});

describe('the Server Action and the scheduler', () => {
  it('is reserved to a records manager with access to Administration, and checks what the page sends', async () => {
    quiet();
    await recorded('PRO-QUA-0001', `${uuid(1)}-upload.pdf`);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(later());
    const keys = [`${uuid(1)}-upload.pdf`];
    await db().insert(s.rolePermissions).values({ role: 'validateur', perm: 'admin', granted: true });
    for (const who of ['head', 'writer'] as const) {
      actAs(who);
      expect(await renameProvisionalFiles(keys)).toEqual({ ok: false, error: DICT.fr.forbidden });
    }
    actAs('manager');
    for (const bad of [undefined, 'x', [], [42], Array.from({ length: 201 }, (_, i) => `${uuid(i)}-upload.pdf`)]) {
      expect(await renameProvisionalFiles(bad as string[])).toEqual({ ok: false, error: DICT.fr.error });
    }
    expect(await keyOf('PRO-QUA-0001')).toBe(`${uuid(1)}-upload.pdf`);
    expect(await renameProvisionalFiles(keys)).toEqual({ ok: true, message: 'Fichiers renommés : 1.' });
    expect(await keyOf('PRO-QUA-0001')).toBe(`${uuid(1)}-PRO-QUA-0001_A.1.pdf`);
  });

  it('runs as a task of the scheduler, under the actor Codex', async () => {
    quiet();
    await recorded('PRO-QUA-0001', `${uuid(1)}-upload.pdf`);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(later());
    const run = await runTask('renames', { interval: 0, force: true, db: db() });
    expect(run).toMatchObject({ ran: true, status: 'ok', summary: { renamed: 1, failed: 0, provisional: 0 } });
    const [entry] = await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'files_renamed'));
    expect(entry.userId).toBe('codex');
  });
});
