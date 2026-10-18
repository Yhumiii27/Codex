import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as fileGET, HEAD as fileHEAD } from '@/app/api/documents/[id]/file/route';
import { GET as exportGET } from '@/app/api/export/full/route';
import { FILES_DIR, schema as s } from '@/db';
import { entryBuffer, verifyExport, zipEntries } from '@/lib/export-core.mjs';
import { orphanReport, purgeOrphans } from '@/lib/orphans';
import { provisionalReport, renameProvisional } from '@/lib/provisional';
import { checkStorage, type StorageCheck } from '@/lib/storage-check';
import {
  fileColumns, FileNotFoundError, listStoredFiles, nameStoredFile, probeStore, readStored, renameDocFiles, renameStoredFile, resetStores, retryAfterSeconds, stageFile,
  type StagedFile,
} from '@/lib/storage';
import { addDoc, setupDb } from '../support/db';
import { fakeGraph, type FakeGraph } from '../support/fake-graph';
import { actAs } from '../support/session';

// The SharePoint store of lib/storage.ts tried without a tenant (Lot 10, step 3), against the fake Graph of
// tests/support/fake-graph.ts: upload to _staging, naming in the document's folder, renaming after a reclassification,
// the file route with a byte range, the listing of _staging and the provisional names taken up again, the full export,
// the probe and its cache, and what the store does when Graph throttles (429, 503) or refuses its token (401).
// SharePoint is never enabled outside these tests: CODEX_STORAGE is stubbed here only, its default stays local (O-01).
// Local files go to a throwaway FILES_DIR, never .data/.

vi.mock('@/db', async (importOriginal) => {
  const { mkdtempSync: mk } = await import('node:fs');
  const { tmpdir: td } = await import('node:os');
  const { join } = await import('node:path');
  return { ...(await importOriginal<typeof import('@/db')>()), FILES_DIR: mk(join(td(), 'codex-sharepoint-')), getDb: async () => (await import('../support/db')).currentDb() };
});
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
const scratch = mkdtempSync(path.join(tmpdir(), 'codex-sharepoint-export-'));

let g: FakeGraph;
beforeEach(() => {
  resetStores();
  g = fakeGraph({ pageSize: 2 });
  vi.stubEnv('CODEX_STORAGE', 'sharepoint');
  for (const [k, v] of Object.entries(g.env)) vi.stubEnv(k, v);
  for (const level of ['info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => {
  expect(g.unexpected).toEqual([]);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetStores();
});
afterAll(() => {
  rmSync(FILES_DIR, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

const HOUR = 3_600_000;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const pdf = (text: string) => Buffer.from(`%PDF-1.7\n% ${text}\n${'x'.repeat(300)}\n%%EOF\n`);
const origin = { userId: 'owner', entry: 'create' as const };
const stage = (bytes: Buffer, name = 'Procédure achats.pdf', mime = 'application/pdf') => stageFile(bytes, name, mime, origin);

/** Document `id` with revision A (status `status`), its working version A.1 recorded with the staged file `f`. */
async function recorded(id: string, f: StagedFile, status: 'draft' | 'in_force' = 'in_force') {
  await addDoc(db(), { id, revisions: [{ letter: 'A', status, versions: ['owner'] }] });
  await db().update(s.workingVersions).set(fileColumns(f)).where(and(eq(s.workingVersions.docId, id), eq(s.workingVersions.n, 1)));
}

describe('upload and naming', () => {
  it('stages a file in _staging without ever replacing one, then names it {ID}_{label}.{ext} in the folder of its ID', async () => {
    const bytes = pdf('A.1');
    const f = await stage(bytes);
    expect(f).toMatchObject({ storage: 'sharepoint', fileName: 'Procédure achats.pdf', mime: 'application/pdf', ext: '.pdf', size: bytes.length, sha256: sha(bytes) });
    expect(g.files()).toEqual([expect.stringMatching(/^_staging\/[0-9a-f-]{36}-upload\.pdf$/)]);
    expect(g.items.get(f.fileKey)!.bytes.equals(bytes)).toBe(true);
    const [put] = g.callsTo('PUT', /\/content/);
    expect(new URL(put.url).searchParams.get('@microsoft.graph.conflictBehavior')).toBe('fail');
    expect(put.auth).toBe('Bearer fake-token-1');

    await nameStoredFile(f, 'PRO-QUA-0001', 'A.1');
    // The driveItem keeps its id: the record's key stays valid.
    expect(g.files()).toEqual(['PRO-QUA-0001/PRO-QUA-0001_A.1.pdf']);
    expect(g.at('PRO-QUA-0001/PRO-QUA-0001_A.1.pdf')!.id).toBe(f.fileKey);
    expect((await readStored('sharepoint', f.fileKey)).equals(bytes)).toBe(true);

    // A second version: the folder is there already (409, tolerated).
    const f2 = await stage(pdf('A.2'));
    await nameStoredFile(f2, 'PRO-QUA-0001', 'A.2');
    expect(g.callsTo('POST', /\/root\/children$/).map((c) => c.status)).toEqual([201, 409]);
    expect(g.files()).toEqual(['PRO-QUA-0001/PRO-QUA-0001_A.1.pdf', 'PRO-QUA-0001/PRO-QUA-0001_A.2.pdf']);
    // One token for every call.
    expect(g.tokens).toBe(1);
  });

  it('leaves a file under its provisional name rather than replace another one that has its final name', async () => {
    const first = await stage(pdf('first'));
    await nameStoredFile(first, 'PRO-QUA-0001', 'A.1');
    const second = await stage(pdf('second'));
    await nameStoredFile(second, 'PRO-QUA-0001', 'A.1');
    expect(g.at('PRO-QUA-0001/PRO-QUA-0001_A.1.pdf')!.id).toBe(first.fileKey);
    expect(g.pathOf(g.items.get(second.fileKey)!)).toMatch(/^_staging\//);
    await expect(renameStoredFile(second, 'PRO-QUA-0001', 'A.1')).rejects.toThrow('SharePoint rename failed: 409');
    // Naming the same file again (a rename that stopped half-way, point 36) is no conflict.
    expect(await renameStoredFile(first, 'PRO-QUA-0001', 'A.1')).toBe(first.fileKey);
  });

  it('moves every file of a document to the folder of its new ID after a reclassification, with the extension of its name', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0001', revisions: [{ letter: 'A', status: 'draft', versions: ['owner', 'writer'] }] });
    const a1 = await stage(pdf('A.1'));
    const a2 = await stage(Buffer.from('date;mesure\n2026-10-01;12\n'), 'Relevé de contrôle.csv', 'application/octet-stream');
    await nameStoredFile(a1, 'PRO-QUA-0001', 'A.1');
    await nameStoredFile(a2, 'PRO-QUA-0001', 'A.2');
    for (const [n, f] of [[1, a1], [2, a2]] as const) {
      await db().update(s.workingVersions).set(fileColumns(f)).where(and(eq(s.workingVersions.docId, 'PRO-QUA-0001'), eq(s.workingVersions.n, n)));
    }
    // A generic type on record (an import): the extension comes from the file's name (the key, an item id, has none).
    await db().update(s.workingVersions).set({ mime: 'application/octet-stream' }).where(and(eq(s.workingVersions.docId, 'PRO-QUA-0001'), eq(s.workingVersions.n, 2)));
    // What updateMetadata does: the ID changes in the database (cascading), then the files follow.
    await db().update(s.documents).set({ id: 'INS-QUA-0001', aliases: ['PRO-QUA-0001'] }).where(eq(s.documents.id, 'PRO-QUA-0001'));
    await renameDocFiles('INS-QUA-0001');
    expect(g.files()).toEqual(['INS-QUA-0001/INS-QUA-0001_A.1.pdf', 'INS-QUA-0001/INS-QUA-0001_A.2.csv']);
    // Same items, same keys: the records need no change.
    expect(g.at('INS-QUA-0001/INS-QUA-0001_A.2.csv')!.id).toBe(a2.fileKey);
    expect((await readStored('sharepoint', a2.fileKey)).toString()).toContain('2026-10-01;12');
  });
});

describe('the file route', () => {
  const ctxOf = (id: string) => ({ params: Promise.resolve({ id }) });
  const get = (id: string, headers: Record<string, string> = {}) => {
    actAs('manager');
    return fileGET(new Request(`http://codex.test/api/documents/${id}/file`, { headers }), ctxOf(id));
  };

  it('serves a byte range from SharePoint: the Range follows the redirect to the download URL, the bearer token does not', async () => {
    const bytes = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 7) & 0xff));
    bytes.write('%PDF-1.7\n', 0, 'latin1');
    const f = await stage(bytes);
    await nameStoredFile(f, 'PRO-QUA-0001', 'A.1');
    await recorded('PRO-QUA-0001', f);
    g.calls.length = 0;

    const res = await get('PRO-QUA-0001', { Range: 'bytes=100-1099' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 100-1099/${bytes.length}`);
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes.subarray(100, 1100))).toBe(true);
    const [content, dl] = g.calls;
    expect(content).toMatchObject({ method: 'GET', url: expect.stringContaining(`/items/${f.fileKey}/content`), auth: 'Bearer fake-token-1', range: 'bytes=100-1099', status: 302 });
    expect(dl).toMatchObject({ url: expect.stringMatching(/^https:\/\/download\.fake-sharepoint\.test\//), auth: null, range: 'bytes=100-1099', status: 206 });

    // The whole file, checked against its fingerprint on the way.
    const whole = await get('PRO-QUA-0001');
    expect(whole.status).toBe(200);
    expect(Buffer.from(await whole.arrayBuffer()).equals(bytes)).toBe(true);

    // HEAD answers from the record: no call to Graph.
    g.calls.length = 0;
    actAs('manager');
    const head = await fileHEAD(new Request('http://codex.test/api/documents/PRO-QUA-0001/file', { method: 'HEAD' }), ctxOf('PRO-QUA-0001'));
    expect([head.status, head.headers.get('content-length')]).toEqual([200, String(bytes.length)]);
    expect(g.calls).toEqual([]);
  });

  it('answers 404 for a file SharePoint no longer has, 502 when Graph stays unavailable', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = await stage(pdf('A.1'));
    await recorded('PRO-QUA-0001', f);
    g.fail(/\/content$/, 503, { retryAfter: '1', times: 3 });
    const pending = get('PRO-QUA-0001');
    // The route reads the database before Graph: on a PostgreSQL server that takes real time, so the waits between
    // attempts are scheduled later. Move the clock a second at a time, letting real I/O run, until the answer comes.
    let settled = false;
    void pending.finally(() => (settled = true));
    for (let i = 0; i < 100 && !settled; i++) {
      await vi.advanceTimersByTimeAsync(1_000);
      await new Promise((r) => setImmediate(r));
    }
    expect((await pending).status).toBe(502);
    g.items.delete(f.fileKey);
    const res = await get('PRO-QUA-0001');
    expect([res.status, await res.text()]).toEqual([404, 'File missing']);
  });
});

describe('listing _staging', () => {
  it('lists the files of _staging, page after page, without its folders', async () => {
    expect(await listStoredFiles('sharepoint')).toEqual([]); // no _staging yet: 404
    const t = '2026-10-01T08:00:00.000Z';
    const seeded = [1, 2, 3, 4, 5].map((n) => g.seed(`_staging/${n}-upload.pdf`, `staged ${n}`, t));
    g.seed('_staging/sub/x.pdf', 'in a sub-folder');
    g.seed('PRO-QUA-0001/PRO-QUA-0001_A.1.pdf', 'named');
    const listed = await listStoredFiles('sharepoint');
    expect(listed.map((f) => f.key).sort()).toEqual(seeded.map((i) => i.id).sort());
    expect(listed[0]).toMatchObject({ size: 8, touched: Date.parse(t) });
    // Six children (five files, a folder), two per page: three pages, the last two through @odata.nextLink.
    expect(g.callsTo('GET', /\/children/).map((c) => new URL(c.url).searchParams.get('$skiptoken'))).toEqual([null, null, '2', '4']);
  });

  it('gives a file left under its provisional name its final name, journaled; the orphan check lists and never removes', async () => {
    const named = await stage(pdf('A.1'));
    await recorded('PRO-QUA-0001', named, 'draft');
    const orphan = await stage(pdf('nobody'));
    const now = Date.now() + 25 * HOUR;

    const report = await provisionalReport({ now, env: {} });
    expect(report.sharepoint).toMatchObject({ due: [{ key: named.fileKey, docId: 'PRO-QUA-0001', name: 'PRO-QUA-0001_A.1.pdf' }], recent: 0, missing: 0 });
    const run = await renameProvisional('manager', { now, env: {} });
    expect(run).toMatchObject({ renamed: [{ store: 'sharepoint', from: named.fileKey, to: named.fileKey, doc: 'PRO-QUA-0001', label: 'A.1' }], failed: 0 });
    expect(g.at('PRO-QUA-0001/PRO-QUA-0001_A.1.pdf')?.id).toBe(named.fileKey);
    const [entry] = await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'files_renamed'));
    expect(entry).toMatchObject({ userId: 'manager', targetKind: 'storage', targetId: 'sharepoint' });

    const orphans = await orphanReport({ now, env: {} });
    expect(orphans.sharepoint).toMatchObject({ orphans: [{ key: orphan.fileKey }], recent: 0 });
    expect(await purgeOrphans('manager', { now, env: {} })).toMatchObject({ removed: [] });
    expect(g.callsTo('DELETE', /graph\.microsoft\.com/)).toEqual([]);
    expect(g.items.has(orphan.fileKey)).toBe(true);
  });
});

describe('the full export', () => {
  it('reads the files kept by SharePoint through Graph', async () => {
    const bytes = pdf('in force');
    const f = await stage(bytes);
    await nameStoredFile(f, 'PRO-QUA-0001', 'A.1');
    await recorded('PRO-QUA-0001', f);
    actAs('manager');
    const res = await exportGET(new Request('http://codex.test/api/export/full'));
    expect(res.status).toBe(200);
    const file = path.join(scratch, 'export.zip');
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    const fh = await open(file, 'r');
    try {
      const manifest = await verifyExport(fh);
      const entry = (await zipEntries(fh)).find((e) => e.name === 'files/PRO-QUA-0001/PRO-QUA-0001_A.1.pdf')!;
      expect((await entryBuffer(fh, entry)).equals(bytes)).toBe(true);
      expect(manifest.files).toMatchObject({ count: 1, missing: [], skipped: [], altered: [] });
    } finally {
      await fh.close();
    }
  });
});

describe('the probe', () => {
  it('asks Graph for the drive once a minute at most, with one token', async () => {
    const t0 = 1_900_000_000_000;
    expect(await probeStore(t0)).toEqual({ store: 'sharepoint', cached: false });
    expect(await probeStore(t0 + 59_000)).toEqual({ store: 'sharepoint', cached: true });
    expect(await probeStore(t0 + 61_000)).toEqual({ store: 'sharepoint', cached: false });
    expect(g.callsTo('GET', /\/drives\/[^/]+\?/).map((c) => c.status)).toEqual([200, 200]);
    expect(g.tokens).toBe(1);
  });

  it('fails on a drive the application cannot reach', async () => {
    vi.stubEnv('CODEX_SP_DRIVE_ID', 'b!another-drive');
    await expect(probeStore(1_900_000_000_000)).rejects.toThrow('SharePoint drive: 404');
  });

  it('asks a new token when Graph refuses the one it holds, rather than fail until it expires', async () => {
    const t0 = 1_900_000_000_000;
    await probeStore(t0);
    g.revokeTokens();
    expect(await probeStore(t0 + 61_000)).toEqual({ store: 'sharepoint', cached: false });
    expect(g.tokens).toBe(2);
  });
});

describe('throttling and refused tokens', () => {
  it('waits what Retry-After says before trying again, after a 429 or a 503', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    g.fail(/^PUT /, 429, { retryAfter: '3' });
    let done = false;
    const pending = stage(pdf('A.1')).then((f) => ((done = true), f));
    await vi.advanceTimersByTimeAsync(2_900);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(true);
    const f = await pending;
    expect(g.callsTo('PUT', /\/content/).map((c) => c.status)).toEqual([429, 201]);

    g.fail(/\/content$/, 503, { retryAfter: '1' });
    const read = readStored('sharepoint', f.fileKey);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await read).length).toBe(f.size);
  });

  it('tries again at once after Retry-After: 0', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    g.fail(/^PUT /, 429, { retryAfter: '0' });
    let done = false;
    const pending = stage(pdf('A.1')).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(10);
    expect(done).toBe(true);
    await pending;
  });

  it('backs off without Retry-After, and gives up after three attempts, waiting at most 10 s each', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    g.fail(/^PUT /, 503, { times: 1 });
    const first = stage(pdf('A.1'));
    await vi.advanceTimersByTimeAsync(2_000); // 2 s after the first attempt
    await first;
    g.fail(/^PUT /, 429, { retryAfter: '3600', times: 5 });
    const failing = stage(pdf('A.2')).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(String(await failing)).toContain('SharePoint upload failed: 429');
    // 1 + (3 failed) attempts with the earlier 503; the 1 h asked capped at 10 s each.
    expect(g.callsTo('PUT', /\/content/).map((c) => c.status)).toEqual([503, 201, 429, 429, 429]);
  });

  it('releases the body of each throttled answer it does not read', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    g.fail(/^PUT /, 429, { retryAfter: '1', times: 2 });
    const pending = stage(pdf('A.1'));
    await vi.advanceTimersByTimeAsync(2_000);
    await pending;
    expect(g.throttled).toHaveLength(2);
    expect(g.throttled.every((t) => t.released)).toBe(true);
  });

  it('asks a new token once when Graph refuses the one it holds (401), then gives up', async () => {
    const f = await stage(pdf('A.1'));
    g.revokeTokens();
    expect((await readStored('sharepoint', f.fileKey)).length).toBe(f.size);
    expect(g.tokens).toBe(2);
    // Refused again and again: one new token, one more attempt, then the error.
    g.fail(/\/content$/, 401, { times: 5 });
    await expect(readStored('sharepoint', f.fileKey)).rejects.toThrow('SharePoint download failed: 401');
    expect(g.tokens).toBe(3);
    expect(g.callsTo('GET', /\/content$/).slice(-2).map((c) => c.status)).toEqual([401, 401]);
  });

  it('says so when Entra ID refuses the application', async () => {
    vi.stubEnv('CODEX_SP_CLIENT_SECRET', 'wrong');
    await expect(stage(pdf('A.1'))).rejects.toThrow('SharePoint auth failed: 401');
    expect(g.items.size).toBe(0);
  });

  it('keeps its token until a minute before it expires', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-18T08:00:00Z'));
    const f = await stage(pdf('A.1'));
    vi.setSystemTime(new Date('2026-10-18T08:58:00Z'));
    await readStored('sharepoint', f.fileKey);
    expect(g.tokens).toBe(1);
    vi.setSystemTime(new Date('2026-10-18T08:59:30Z'));
    await readStored('sharepoint', f.fileKey);
    expect(g.tokens).toBe(2);
  });

  it('forgets the active store\'s token on resetStores (tests)', async () => {
    await stage(pdf('A.1'));
    resetStores();
    await stage(pdf('A.2'));
    expect(g.tokens).toBe(2);
  });

  it('throws FileNotFoundError for an item Graph does not have', async () => {
    await expect(readStored('sharepoint', '01ITEMGONE')).rejects.toBeInstanceOf(FileNotFoundError);
  });
});

describe('Retry-After', () => {
  it('reads seconds, 0 included, or a date; nothing else', () => {
    const now = Date.parse('2026-10-18T08:00:00Z');
    expect(retryAfterSeconds('0', now)).toBe(0);
    expect(retryAfterSeconds(' 120 ', now)).toBe(120);
    expect(retryAfterSeconds('Sun, 18 Oct 2026 08:00:05 GMT', now)).toBe(5);
    expect(retryAfterSeconds('Sun, 18 Oct 2026 07:00:00 GMT', now)).toBe(0);
    expect(retryAfterSeconds('soon', now)).toBeNull();
    expect(retryAfterSeconds('-3', now)).toBeNull();
    expect(retryAfterSeconds(null, now)).toBeNull();
  });
});

describe('the storage check (npm run storage:check)', () => {
  const steps = (r: StorageCheck) => r.steps.map((x) => [x.step, x.ok]);

  it('uploads to _staging, names, reads whole and by range, then removes the test file', async () => {
    const r = await checkStorage();
    expect(r).toMatchObject({ store: 'sharepoint', ok: true, leftover: [] });
    expect(steps(r)).toEqual([['config', true], ['probe', true], ['put', true], ['rename', true], ['read', true], ['range', true], ['remove', true]]);
    // Nothing left but the folders: _staging, and the check's own, empty.
    expect(g.files()).toEqual([]);
    expect([...g.items.values()].map((i) => [i.parent, i.name, i.folder]).sort()).toEqual([['', '_codex-check', true], ['', '_staging', true]]);
    const [put] = g.callsTo('PUT', /\/content/);
    expect(put.url).toMatch(/\/root:\/_staging\/[0-9a-f-]{36}-storage-check\.bin:\/content\?@microsoft\.graph\.conflictBehavior=fail$/);
    expect(g.callsTo('GET', /download\.fake-sharepoint\.test/).map((c) => [c.range, c.auth, c.status])).toEqual([[null, null, 200], ['bytes=1000-66535', null, 206]]);
    expect(g.callsTo('DELETE', /\/items\//).map((c) => c.status)).toEqual([204]);
    expect(g.tokens).toBe(1);
  });

  it('stops at the step that fails, says what to look at, and removes what it stored', async () => {
    g.fail(/^PATCH /, 403);
    const r = await checkStorage();
    expect(r.ok).toBe(false);
    expect(steps(r).at(-1)).toEqual(['rename', false]);
    expect(r.steps.at(-1)!.detail).toContain('« write »');
    expect(g.files()).toEqual([]);
    expect(r.leftover).toEqual([]);
  });

  it('names the variable to check when the library or the application is refused', async () => {
    vi.stubEnv('CODEX_SP_DRIVE_ID', 'b!another-drive');
    const drive = await checkStorage();
    expect(steps(drive)).toEqual([['config', true], ['probe', false]]);
    expect(drive.steps[1].detail).toContain('CODEX_SP_DRIVE_ID');
    resetStores();
    vi.stubEnv('CODEX_SP_DRIVE_ID', g.driveId);
    vi.stubEnv('CODEX_SP_CLIENT_SECRET', 'wrong');
    expect((await checkStorage()).steps[1].detail).toContain('CODEX_SP_CLIENT_SECRET');
    vi.stubEnv('CODEX_SP_CLIENT_SECRET', '');
    const missing = await checkStorage();
    expect(steps(missing)).toEqual([['config', false]]);
    expect(missing.steps[0].detail).toContain('CODEX_SP_CLIENT_SECRET');
    expect(g.items.size).toBe(0);
  });

  it('tries the local store the same way, in its folder, and leaves nothing there', async () => {
    vi.stubEnv('CODEX_STORAGE', '');
    const r = await checkStorage();
    expect(r).toMatchObject({ store: 'local', ok: true, leftover: [] });
    expect(readdirSync(FILES_DIR)).toEqual([]);
    expect(g.calls).toEqual([]);
  });

  it('runs as a command, without database, and says which step failed', { timeout: 60_000 }, async () => {
    const data = mkdtempSync(path.join(tmpdir(), 'codex-storage-check-'));
    try {
      const run = (env: Record<string, string>) => new Promise<{ code: number; stdout: string }>((resolve) => {
        const childEnv: NodeJS.ProcessEnv = { ...process.env, CODEX_DATA_DIR: data, CODEX_STORAGE: '', CODEX_SP_TENANT_ID: '', CODEX_SP_CLIENT_ID: '', CODEX_SP_CLIENT_SECRET: '', CODEX_SP_DRIVE_ID: '', ...env };
        execFile(process.execPath, [path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'), '--conditions=react-server', path.join(process.cwd(), 'scripts', 'codex-storage-check.mts')], { env: childEnv, timeout: 50_000 }, (err, stdout) => {
          resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout });
        });
      });
      const missing = await run({});
      expect(missing.code).toBe(1);
      expect(missing.stdout).toMatch(/ÉCHEC\s+Accès au stockage .*n'existe pas/);
      mkdirSync(path.join(data, 'files'));
      const done = await run({});
      expect([done.code, done.stdout]).toEqual([0, expect.stringContaining('Le stockage local fonctionne.')]);
      expect(readdirSync(path.join(data, 'files'))).toEqual([]);
      const sp = await run({ CODEX_STORAGE: 'sharepoint', CODEX_SP_DRIVE_ID: 'b!x' });
      expect(sp.code).toBe(1);
      expect(sp.stdout).toMatch(/ÉCHEC\s+Configuration .*CODEX_SP_TENANT_ID/);
      expect(existsSync(path.join(data, 'pglite'))).toBe(false);
    } finally {
      rmSync(data, { recursive: true, force: true });
    }
  });
});
