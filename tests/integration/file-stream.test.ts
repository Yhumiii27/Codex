import { rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { GET, HEAD } from '@/app/api/documents/[id]/file/route';
import { FILES_DIR, schema as s } from '@/db';
import type { Conf } from '@/db/schema';
import { addDoc, fixClock, getRevision, setupDb, type RevSpec } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs } from '../support/session';

// The file route streams the stored file (point 46 of docs/reste-a-faire.md): byte ranges (206, 416), validators (ETag,
// Last-Modified, 304) and HEAD, after RFC 9110, with the access rules, D-14, the _OBSOLETE / _ARCHIVE suffixes and the
// download journal unchanged. lib/ranges.ts has its own unit tests.

vi.mock('@/db', async (importOriginal) => {
  const { mkdtempSync: mk } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { ...(await importOriginal<typeof import('@/db')>()), FILES_DIR: mk(join(tmpdir(), 'codex-stream-')), getDb: async () => (await import('../support/db')).currentDb() };
});
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));

const db = setupDb();
fixClock();

afterAll(() => {
  rmSync(FILES_DIR, { recursive: true, force: true });
});

/** Responses of the test; those whose body was not read are cancelled, which closes the file they hold open. */
const answered: Response[] = [];
afterEach(async () => {
  for (const res of answered.splice(0)) if (res.body && !res.bodyUsed && !res.body.locked) await res.body.cancel();
});

/** 3 MB of bytes that are not all alike, so that a range taken at the wrong offset shows. */
const BIG = Buffer.from(Array.from({ length: 3 * 1024 * 1024 }, (_, i) => (i * 7 + (i >> 11)) & 0xff));
/** A small PDF: served inline. */
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

/**
 * A document whose working versions get a stored file each (`bytes`), the last one the file of the revision in force by
 * default. Returns its ID.
 */
async function docWithFile(id: string, bytes: Buffer, opts: { conf?: Conf; state?: 'active' | 'obsolete' | 'archived'; revisions?: RevSpec[]; name?: string; mime?: string } = {}) {
  await addDoc(db(), { id, conf: opts.conf, state: opts.state, revisions: opts.revisions });
  const versions = await db().select().from(s.workingVersions).where(eq(s.workingVersions.docId, id));
  for (const v of versions) {
    const key = `${'0'.repeat(8)}-0000-4000-8000-${String(v.id).padStart(12, '0')}-${id}_v${v.n}`;
    writeFileSync(path.join(FILES_DIR, key), bytes);
    // Stored before the frozen clock (fixClock), as it would be.
    utimesSync(path.join(FILES_DIR, key), new Date('2026-09-05T10:00:00Z'), new Date('2026-09-05T10:00:00Z'));
    await db().update(s.workingVersions).set({ storage: 'local', fileKey: key, fileName: opts.name ?? 'fichier.pdf', mime: opts.mime ?? 'application/pdf', size: bytes.length }).where(eq(s.workingVersions.id, v.id));
  }
  return id;
}

const ctxOf = (id: string) => ({ params: Promise.resolve({ id }) });

/** GET (or HEAD) of the file route as `who`, with request headers. */
async function fetchFile(id: string, headers: Record<string, string> = {}, { who = 'manager', query = '', method = 'GET' }: { who?: Person; query?: string; method?: 'GET' | 'HEAD' } = {}) {
  actAs(who);
  const req = new Request(`http://codex.test/api/documents/${id}/file${query}`, { method, headers });
  const res = await (method === 'GET' ? GET(req, ctxOf(id)) : HEAD(req, ctxOf(id)));
  answered.push(res);
  return res;
}

const bytesOf = async (res: Response) => Buffer.from(await res.arrayBuffer());
const downloads = async (id: string) => (await db().select().from(s.auditLog).where(eq(s.auditLog.docId, id))).filter((a) => a.action === 'download');

describe('the whole file', () => {
  it('is streamed with its length, Accept-Ranges and validators', async () => {
    const id = await docWithFile('PRO-QUA-0001', BIG);
    const res = await fetchFile(id);
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(ReadableStream);
    expect(res.headers.get('content-length')).toBe(String(BIG.length));
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('etag')).toMatch(/^"[\w-]{32}"$/);
    expect(new Date(res.headers.get('last-modified')!).getTime()).not.toBeNaN();
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe(`inline; filename*=UTF-8''${id}_A.pdf`);
    expect((await bytesOf(res)).equals(BIG)).toBe(true);
  });

  it('is cut short by the client without reading the rest', async () => {
    const id = await docWithFile('PRO-QUA-0002', BIG);
    const res = await fetchFile(id);
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(first.value!.length).toBeLessThan(BIG.length);
    await reader.cancel();
  });

  it('keeps the same ETag from one request to the next, and changes it with the name it is served under', async () => {
    const id = await docWithFile('PRO-QUA-0003', PDF);
    const tag = (await fetchFile(id)).headers.get('etag');
    expect((await fetchFile(id)).headers.get('etag')).toBe(tag);
    // Withdrawn: same bytes, served as …_OBSOLETE.pdf.
    await db().update(s.documents).set({ state: 'obsolete' }).where(eq(s.documents.id, id));
    const res = await fetchFile(id);
    expect(res.headers.get('content-disposition')).toBe(`inline; filename*=UTF-8''${id}_A_OBSOLETE.pdf`);
    expect(res.headers.get('etag')).not.toBe(tag);
  });
});

describe('byte ranges', () => {
  it('answers one range with 206 and Content-Range', async () => {
    const id = await docWithFile('PRO-QUA-0010', BIG);
    const res = await fetchFile(id, { Range: 'bytes=1000000-1000099' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 1000000-1000099/${BIG.length}`);
    expect(res.headers.get('content-length')).toBe('100');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-disposition')).toBe(`inline; filename*=UTF-8''${id}_A.pdf`);
    expect((await bytesOf(res)).equals(BIG.subarray(1000000, 1000100))).toBe(true);
  });

  it('reads an open range to the end, a suffix, and clamps an end beyond the file', async () => {
    const id = await docWithFile('PRO-QUA-0011', BIG);
    const size = BIG.length;
    const open = await fetchFile(id, { Range: `bytes=${size - 10}-` });
    expect([open.status, open.headers.get('content-range')]).toEqual([206, `bytes ${size - 10}-${size - 1}/${size}`]);
    expect((await bytesOf(open)).equals(BIG.subarray(size - 10))).toBe(true);
    const suffix = await fetchFile(id, { Range: 'bytes=-5' });
    expect([suffix.status, suffix.headers.get('content-range')]).toEqual([206, `bytes ${size - 5}-${size - 1}/${size}`]);
    expect((await bytesOf(suffix)).equals(BIG.subarray(size - 5))).toBe(true);
    const beyond = await fetchFile(id, { Range: `bytes=0-${size * 2}` });
    expect([beyond.status, beyond.headers.get('content-length')]).toEqual([206, String(size)]);
  });

  it('answers 416 with the size for a range it cannot satisfy or that is malformed', async () => {
    const id = await docWithFile('PRO-QUA-0012', PDF);
    for (const range of [`bytes=${PDF.length}-`, 'bytes=50-10', 'bytes=-0', 'bytes=abc', 'bytes=']) {
      const res = await fetchFile(id, { Range: range });
      expect(res.status, range).toBe(416);
      expect(res.headers.get('content-range'), range).toBe(`bytes */${PDF.length}`);
      expect(res.headers.get('content-disposition'), range).toBeNull();
      expect(res.headers.get('cache-control'), range).toBe('private, no-store');
    }
  });

  it('sends the whole file for another unit or several ranges', async () => {
    const id = await docWithFile('PRO-QUA-0013', PDF);
    for (const range of ['items=0-1', 'bytes=0-1, 4-5']) {
      const res = await fetchFile(id, { Range: range });
      expect(res.status, range).toBe(200);
      expect((await bytesOf(res)).equals(PDF), range).toBe(true);
    }
  });

  it('applies the range only while If-Range still names the file', async () => {
    const id = await docWithFile('PRO-QUA-0014', PDF);
    const first = await fetchFile(id);
    const tag = first.headers.get('etag')!;
    expect((await fetchFile(id, { Range: 'bytes=0-3', 'If-Range': tag })).status).toBe(206);
    expect((await fetchFile(id, { Range: 'bytes=0-3', 'If-Range': first.headers.get('last-modified')! })).status).toBe(206);
    const changed = await fetchFile(id, { Range: 'bytes=0-3', 'If-Range': '"another"' });
    expect(changed.status).toBe(200);
    expect((await bytesOf(changed)).equals(PDF)).toBe(true);
  });

  it('serves the stand-in PDF of a demo record by range too', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0015' });
    const whole = await fetchFile('PRO-QUA-0015');
    const bytes = await bytesOf(whole);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const part = await fetchFile('PRO-QUA-0015', { Range: 'bytes=0-7' });
    expect(part.status).toBe(206);
    expect((await bytesOf(part)).equals(bytes.subarray(0, 8))).toBe(true);
    // Built again at each request, the same bytes: the same tag.
    expect((await fetchFile('PRO-QUA-0015')).headers.get('etag')).toBe(whole.headers.get('etag'));
  });
});

describe('conditional requests', () => {
  it('answers 304 to the ETag of the copy the browser kept, without a body', async () => {
    const id = await docWithFile('PRO-QUA-0020', PDF);
    const first = await fetchFile(id);
    expect(first.headers.get('cache-control')).toBe('private, no-cache, no-transform');
    const tag = first.headers.get('etag')!;
    const again = await fetchFile(id, { 'If-None-Match': tag });
    expect(again.status).toBe(304);
    expect(again.body).toBeNull();
    expect(again.headers.get('etag')).toBe(tag);
    expect(again.headers.get('content-length')).toBeNull();
    expect((await fetchFile(id, { 'If-None-Match': `W/${tag}, "x"` })).status).toBe(304);
    expect((await fetchFile(id, { 'If-None-Match': '"x"' })).status).toBe(200);
  });

  it('answers 304 to If-Modified-Since only without If-None-Match', async () => {
    const id = await docWithFile('PRO-QUA-0021', PDF);
    const since = (await fetchFile(id)).headers.get('last-modified')!;
    expect((await fetchFile(id, { 'If-Modified-Since': since })).status).toBe(304);
    expect((await fetchFile(id, { 'If-Modified-Since': since, 'If-None-Match': '"x"' })).status).toBe(200);
    expect((await fetchFile(id, { 'If-Modified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT' })).status).toBe(200);
  });

  it('checks access before anything: a 304 or a range is never given to who may not have the file', async () => {
    // A draft (revision A being drafted): its drafting circle only (D-14).
    const id = await docWithFile('PRO-QUA-0022', PDF, { revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
    const tag = (await fetchFile(id, {}, { who: 'owner' })).headers.get('etag')!;
    for (const headers of [{ 'If-None-Match': tag }, { Range: 'bytes=0-3' }, { Range: 'bytes=999999-' }] as Record<string, string>[]) {
      const res = await fetchFile(id, headers, { who: 'writer2' });
      expect(res.status, JSON.stringify(headers)).toBe(404);
      expect(res.headers.get('etag')).toBeNull();
      expect(res.headers.get('content-range')).toBeNull();
      expect((await fetchFile(id, headers, { who: 'writer2', method: 'HEAD' })).status).toBe(404);
    }
  });

  it('never lets the browser keep a draft or a confidential file, and always sends it', async () => {
    const draft = await docWithFile('PRO-QUA-0023', PDF, { revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'draft', versions: ['owner'] }] });
    const working = await fetchFile(draft, {}, { who: 'owner' });
    expect(working.headers.get('content-disposition')).toBe(`inline; filename*=UTF-8''${draft}_A.pdf`);
    expect(working.headers.get('cache-control')).toBe('private, no-cache, no-transform');
    // The working version B.1, which only the drafting circle gets.
    const [b1] = await db().select().from(s.workingVersions).where(eq(s.workingVersions.revisionId, (await getRevision(db(), draft, 'B')).id));
    const wip = await fetchFile(draft, {}, { who: 'owner', query: `?v=${b1.id}` });
    expect(wip.headers.get('content-disposition')).toBe(`inline; filename*=UTF-8''${draft}_B.1.pdf`);
    expect(wip.headers.get('cache-control')).toBe('private, no-store, no-transform');
    expect((await fetchFile(draft, { 'If-None-Match': wip.headers.get('etag')! }, { who: 'owner', query: `?v=${b1.id}` })).status).toBe(200);

    const secret = await docWithFile('PRO-QUA-0024', PDF, { conf: 'confidentiel' });
    const res = await fetchFile(secret);
    expect(res.headers.get('cache-control')).toBe('private, no-store, no-transform');
    expect((await fetchFile(secret, { 'If-None-Match': res.headers.get('etag')! })).status).toBe(200);
    // Ranges still apply.
    expect((await fetchFile(secret, { Range: 'bytes=0-3' })).status).toBe(206);
  });
});

describe('downloads', () => {
  it('journals a transfer from the first byte, not a resumed one, a 416 or a HEAD', async () => {
    const id = await docWithFile('PRO-QUA-0030', BIG, { state: 'archived' });
    const whole = await fetchFile(id, {}, { query: '?download=1' });
    expect(whole.status).toBe(200);
    expect(whole.headers.get('content-disposition')).toBe(`attachment; filename*=UTF-8''${id}_A_ARCHIVE.pdf`);
    expect(whole.headers.get('cache-control')).toBe('private, no-store, no-transform');
    await whole.arrayBuffer();
    expect(await downloads(id)).toHaveLength(1);

    const resumed = await fetchFile(id, { Range: 'bytes=2000000-', 'If-Range': whole.headers.get('etag')! }, { query: '?download=1' });
    expect(resumed.status).toBe(206);
    expect(resumed.headers.get('content-disposition')).toBe(`attachment; filename*=UTF-8''${id}_A_ARCHIVE.pdf`);
    expect((await bytesOf(resumed)).equals(BIG.subarray(2000000))).toBe(true);
    expect(await downloads(id)).toHaveLength(1);

    expect((await fetchFile(id, { Range: 'bytes=0-99' }, { query: '?download=1' })).status).toBe(206);
    expect(await downloads(id)).toHaveLength(2);
    expect((await fetchFile(id, { Range: `bytes=${BIG.length}-` }, { query: '?download=1' })).status).toBe(416);
    expect((await fetchFile(id, {}, { query: '?download=1', method: 'HEAD' })).status).toBe(200);
    expect(await downloads(id)).toHaveLength(2);
  });

  it('sends the file again to a download that brings an ETag, and journals it', async () => {
    const id = await docWithFile('PRO-QUA-0031', PDF);
    const tag = (await fetchFile(id)).headers.get('etag')!;
    const res = await fetchFile(id, { 'If-None-Match': tag }, { query: '?download=1' });
    expect(res.status).toBe(200);
    expect((await bytesOf(res)).equals(PDF)).toBe(true);
    expect(await downloads(id)).toHaveLength(1);
  });
});

describe('HEAD', () => {
  it('gives the headers of GET without a body, ignores Range and answers 304', async () => {
    const id = await docWithFile('PRO-QUA-0040', BIG);
    const get = await fetchFile(id);
    const head = await fetchFile(id, {}, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
    for (const h of ['content-length', 'content-type', 'content-disposition', 'etag', 'last-modified', 'accept-ranges', 'cache-control']) {
      expect(head.headers.get(h), h).toBe(get.headers.get(h));
    }
    const ranged = await fetchFile(id, { Range: 'bytes=0-9' }, { method: 'HEAD' });
    expect([ranged.status, ranged.headers.get('content-length'), ranged.headers.get('content-range')]).toEqual([200, String(BIG.length), null]);
    expect((await fetchFile(id, { 'If-None-Match': get.headers.get('etag')! }, { method: 'HEAD' })).status).toBe(304);
  });

  it('says a missing file is missing, as GET does', async () => {
    const id = await docWithFile('PRO-QUA-0041', PDF);
    const [v] = await db().select().from(s.workingVersions).where(eq(s.workingVersions.docId, id));
    unlinkSync(path.join(FILES_DIR, v.fileKey!));
    const get = await fetchFile(id);
    expect([get.status, await get.text()]).toEqual([404, 'File missing']);
    expect((await fetchFile(id, {}, { method: 'HEAD' })).status).toBe(404);
  });
});
