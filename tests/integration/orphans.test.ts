import { linkSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { FILES_DIR, schema as s } from '@/db';
import { purgeOrphanFiles } from '@/lib/actions';
import type { Ctx } from '@/lib/context';
import { DICT } from '@/lib/i18n';
import { MAX_PER_RUN, orphanReport, purgeOrphans } from '@/lib/orphans';
import { auditDetailL } from '@/lib/queries';
import { listStoredFiles, localTouched } from '@/lib/storage';
import { addDoc, setupDb } from '../support/db';
import { actAs } from '../support/session';

// Orphan files of the local store (point 36 of docs/reste-a-faire.md, lib/orphans.ts): listed without removing anything
// (dry run), removed by a records manager once older than the grace period and named by no working version, journaled;
// SharePoint listed only (O-01). Files are written for real in a throwaway FILES_DIR: their ctime is the real time, so
// the tests move `now` (or the clock) past the grace period rather than files back in time.

vi.mock('@/db', async (importOriginal) => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { ...(await importOriginal<typeof import('@/db')>()), FILES_DIR: mkdtempSync(join(tmpdir(), 'codex-orphans-')), getDb: async () => (await import('../support/db')).currentDb() };
});
// The store as is, two of its calls wrapped so that a test can make the race between the look and the removal happen.
vi.mock('@/lib/storage', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/storage')>();
  return { ...real, listStoredFiles: vi.fn(real.listStoredFiles), localTouched: vi.fn(real.localTouched) };
});
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();

afterEach(() => {
  for (const f of readdirSync(FILES_DIR)) rmSync(path.join(FILES_DIR, f));
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
afterAll(() => {
  rmSync(FILES_DIR, { recursive: true, force: true });
});

const HOUR = 3_600_000;
/** A day and an hour from now: past the default grace period (24 h) for a file written now. */
const later = () => Date.now() + 25 * HOUR;
const key = (n: number, name: string) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}-${name}`;
const put = (k: string, bytes = 'x') => writeFileSync(path.join(FILES_DIR, k), bytes);
const stored = () => readdirSync(FILES_DIR).sort();

/** A document whose working version points to `fileKey` (written to the store). */
async function referenced(id: string, fileKey: string) {
  await addDoc(db(), { id });
  put(fileKey, 'referenced');
  await db().update(s.workingVersions).set({ storage: 'local', fileKey, fileName: 'f.pdf', mime: 'application/pdf', size: 10 }).where(eq(s.workingVersions.docId, id));
}

const purges = async () => (await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'files_purged')));

describe('the dry run', () => {
  it('lists the orphans past the grace period, and removes nothing', async () => {
    await referenced('PRO-QUA-0001', key(1, 'PRO-QUA-0001_A.1.pdf'));
    put(key(2, 'upload.pdf'), 'orphan-1');
    put(key(3, 'PRO-QUA-0007_A.2.docx'), 'orphan-22');
    put('.DS_Store');
    const before = stored();
    const r = await orphanReport({ now: later(), env: {} });
    expect(r.graceHours).toBe(24);
    expect(r.local.orphans.map((f) => f.key).sort()).toEqual([key(2, 'upload.pdf'), key(3, 'PRO-QUA-0007_A.2.docx')]);
    expect(r.local).toMatchObject({ bytes: 8 + 9, recent: 0, foreign: 1 });
    expect(r.sharepoint).toBeNull();
    expect(stored()).toEqual(before);
    expect(await purges()).toEqual([]);
  });

  it('counts a file younger than the grace period as recent, not as an orphan', async () => {
    put(key(2, 'upload.pdf'));
    // Written now: an upload whose record is not committed yet.
    expect((await orphanReport({ env: {} })).local).toMatchObject({ orphans: [], recent: 1 });
    expect((await orphanReport({ now: later(), env: { CODEX_ORPHAN_GRACE_HOURS: '48' } })).local).toMatchObject({ orphans: [], recent: 1 });
    expect((await orphanReport({ now: Date.now() + 2 * HOUR, env: { CODEX_ORPHAN_GRACE_HOURS: '1' } })).local.orphans).toHaveLength(1);
  });

  it('dates a file by its last link too: an old file renamed just now is recent', async () => {
    // nameStoredFile links the staged file under its final name: same inode, its mtime from the upload, a new ctime.
    const staged = key(4, 'upload.pdf');
    put(staged);
    const old = new Date(Math.floor((Date.now() - 72 * HOUR) / 1000) * 1000);
    utimesSync(path.join(FILES_DIR, staged), old, old);
    linkSync(path.join(FILES_DIR, staged), path.join(FILES_DIR, key(4, 'PRO-QUA-0009_A.1.pdf')));
    expect(Math.abs(statSync(path.join(FILES_DIR, staged)).mtimeMs - old.getTime())).toBeLessThan(1000);
    const r = await orphanReport({ env: { CODEX_ORPHAN_GRACE_HOURS: '1' } });
    expect(r.local).toMatchObject({ orphans: [], recent: 2 });
    expect((await purgeOrphans('manager', { env: { CODEX_ORPHAN_GRACE_HOURS: '1' } }))).toMatchObject({ removed: [] });
    expect(stored()).toHaveLength(2);
  });

  it('lists SharePoint when records point to it, and says so when it cannot be reached', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0002' });
    await db().update(s.workingVersions).set({ storage: 'sharepoint', fileKey: 'driveitem-1' }).where(eq(s.workingVersions.docId, 'PRO-QUA-0002'));
    // No CODEX_SP_* here: the listing fails before any request.
    vi.stubEnv('CODEX_SP_TENANT_ID', '');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await orphanReport({ now: later(), env: {} })).sharepoint).toEqual({ error: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('the purge', () => {
  it('removes the orphans only, journals each one, and keeps the referenced, recent and foreign files', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await referenced('PRO-QUA-0001', key(1, 'PRO-QUA-0001_A.1.pdf'));
    put(key(2, 'upload.pdf'), 'orphan-1');
    put(key(3, 'PRO-QUA-0007_A.2.docx'), 'orphan-22');
    put('.DS_Store');
    const res = await purgeOrphans('manager', { now: later(), env: {} });
    expect(res).toMatchObject({ bytes: 17, failed: 0, left: 0 });
    if (res === 'busy') throw new Error('busy');
    expect(res.removed.map((f) => f.key).sort()).toEqual([key(2, 'upload.pdf'), key(3, 'PRO-QUA-0007_A.2.docx')]);
    expect(stored()).toEqual([key(1, 'PRO-QUA-0001_A.1.pdf'), '.DS_Store'].sort());
    const [entry] = await purges();
    expect(entry).toMatchObject({ userId: 'manager', action: 'files_purged', docId: null, targetKind: 'storage', targetId: 'local' });
    expect(entry.data?.purge?.bytes).toBe(17);
    expect(entry.data?.purge?.files.map((f) => [f.key, f.size]).sort()).toEqual([[key(2, 'upload.pdf'), 8], [key(3, 'PRO-QUA-0007_A.2.docx'), 9]]);
    expect(info.mock.calls.flat().join('\n')).toContain(key(3, 'PRO-QUA-0007_A.2.docx'));
    // Nothing left: a second run removes nothing and journals nothing.
    expect(await purgeOrphans('manager', { now: later(), env: {} })).toMatchObject({ removed: [], left: 0 });
    expect(await purges()).toHaveLength(1);
    info.mockRestore();
  });

  it('removes at most MAX_PER_RUN files per run, oldest first', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    for (let i = 1; i <= MAX_PER_RUN + 5; i++) put(key(i, 'upload.pdf'));
    const res = await purgeOrphans('manager', { now: later(), env: {} });
    if (res === 'busy') throw new Error('busy');
    expect([res.removed.length, res.left]).toEqual([MAX_PER_RUN, 5]);
    expect(stored()).toHaveLength(5);
    expect((await purges())[0].data?.purge?.files).toHaveLength(MAX_PER_RUN);
    vi.restoreAllMocks();
  });

  it('removes only the files the dry run listed, each one still an orphan', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await referenced('PRO-QUA-0001', key(1, 'PRO-QUA-0001_A.1.pdf'));
    put(key(2, 'upload.pdf'), 'orphan-1');
    put('.DS_Store');
    const at = later();
    const shown = (await orphanReport({ now: at, env: {} })).local.orphans.map((f) => f.key);
    expect(shown).toEqual([key(2, 'upload.pdf')]);
    // An upload interrupted earlier passes the grace period while the page is open: it was not shown, it stays.
    put(key(3, 'upload.pdf'), 'orphan-22');
    // Keys sent back by a page may have been altered: a referenced file, a foreign one, one that is not there.
    const keys = [...shown, key(1, 'PRO-QUA-0001_A.1.pdf'), '.DS_Store', key(9, 'gone.pdf')];
    const res = await purgeOrphans('manager', { now: at, env: {}, keys });
    if (res === 'busy') throw new Error('busy');
    expect(res.removed.map((f) => f.key)).toEqual([key(2, 'upload.pdf')]);
    expect(res).toMatchObject({ bytes: 8, failed: 0, kept: 3, left: 1 });
    expect(stored()).toEqual([key(1, 'PRO-QUA-0001_A.1.pdf'), key(3, 'upload.pdf'), '.DS_Store'].sort());
    const [entry] = await purges();
    expect(entry.data?.purge?.files.map((f) => f.key)).toEqual([key(2, 'upload.pdf')]);
    expect(info.mock.calls.flat().join('\n')).not.toContain(key(3, 'upload.pdf'));
    info.mockRestore();
  });

  it('keeps a file written again after the look, though the look found it old enough', async () => {
    const k = key(5, 'upload.pdf');
    // Written just now; the listing dates it from two days ago (a large directory read while a rename linked it).
    put(k);
    vi.mocked(listStoredFiles).mockImplementationOnce(async () => [{ key: k, size: 1, touched: Date.now() - 48 * HOUR }]);
    const res = await purgeOrphans('manager', { env: {}, keys: [k] });
    expect(res).toMatchObject({ removed: [], failed: 0, kept: 1 });
    expect(stored()).toEqual([k]);
    expect(await purges()).toEqual([]);
  });

  it('keeps a file that a record comes to name while the purge runs', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0003' });
    const k = key(6, 'PRO-QUA-0003_A.1.pdf');
    put(k);
    const real = await vi.importActual<typeof import('@/lib/storage')>('@/lib/storage');
    // The transaction that records the upload commits between the look and the removal.
    vi.mocked(localTouched).mockImplementationOnce(async (fileKey) => {
      await db().update(s.workingVersions).set({ storage: 'local', fileKey: k, fileName: 'f.pdf', mime: 'application/pdf', size: 1 }).where(eq(s.workingVersions.docId, 'PRO-QUA-0003'));
      return real.localTouched(fileKey);
    });
    const res = await purgeOrphans('manager', { now: later(), env: {}, keys: [k] });
    expect(vi.mocked(localTouched)).toHaveBeenCalledWith(k);
    expect(res).toMatchObject({ removed: [], failed: 0, kept: 1 });
    expect(stored()).toEqual([k]);
    expect(await purges()).toEqual([]);
  });

  it('runs once at a time', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    put(key(2, 'upload.pdf'));
    const [a, b] = await Promise.all([purgeOrphans('manager', { now: later(), env: {} }), purgeOrphans('manager', { now: later(), env: {} })]);
    expect([a, b].filter((x) => x === 'busy')).toHaveLength(1);
    vi.restoreAllMocks();
  });
});

describe('the Server Action and the journal', () => {
  const pastGrace = () => {
    const at = later();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at);
  };

  it('is reserved to a records manager with access to Administration', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    put(key(2, 'upload.pdf'));
    pastGrace();
    // An approver, even once given Administration: stored names may carry drafts' IDs (D-14).
    await db().insert(s.rolePermissions).values({ role: 'validateur', perm: 'admin', granted: true });
    const keys = [key(2, 'upload.pdf')];
    actAs('head');
    expect(await purgeOrphanFiles(keys)).toEqual({ ok: false, error: DICT.fr.forbidden });
    actAs('writer');
    expect(await purgeOrphanFiles(keys)).toEqual({ ok: false, error: DICT.fr.forbidden });
    expect(stored()).toEqual([key(2, 'upload.pdf')]);
    actAs('manager');
    // What a page sends back is checked: a list of names, no longer than the one a page shows.
    for (const bad of [undefined, 'x', [], [42], Array.from({ length: MAX_PER_RUN + 1 }, (_, i) => key(i, 'upload.pdf'))]) {
      expect(await purgeOrphanFiles(bad as string[])).toEqual({ ok: false, error: DICT.fr.error });
    }
    expect(stored()).toEqual([key(2, 'upload.pdf')]);
    expect(await purgeOrphanFiles(keys)).toEqual({ ok: true, message: 'Fichiers orphelins supprimés : 1 (1 o).' });
    expect(stored()).toEqual([]);
    vi.restoreAllMocks();
  });

  it('shows the removed names to records managers only', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    put(key(3, 'PRO-QUA-0007_A.2.docx'), 'orphan-22');
    await purgeOrphans('manager', { now: later(), env: {} });
    const [entry] = await purges();
    const as = (seesAll: boolean) => auditDetailL({ t: DICT.fr, lang: 'fr', seesAll } as Ctx, entry);
    expect(as(true)).toBe(`Fichiers : 1 (9 o) · ${key(3, 'PRO-QUA-0007_A.2.docx')}`);
    expect(as(false)).toBe('Fichiers : 1 (9 o)');
    vi.restoreAllMocks();
  });
});
