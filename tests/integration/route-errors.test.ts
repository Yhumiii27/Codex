import { readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, HEAD } from '@/app/api/documents/[id]/file/route';
import { POST } from '@/app/api/import/route';
import { FILES_DIR, schema as s } from '@/db';
import { addDoc, fixClock, setupDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs } from '../support/session';

// The answers of the import and file routes that are not a success, by their handlers (point 57 of
// docs/reste-a-faire.md): POST /api/import refuses without its token (401), a body it cannot read (400), a type it does
// not take (415), a file too large (413) or of a format not admitted (415), metadata that do not hold (400), a replay or
// a legacy reference that is a Codex ID (409), and says 500 with the request's identifier on an unexpected failure; GET
// and HEAD /api/documents/[id]/file answer 404 for what the user may not have or what does not exist, and for a file
// the store lacks, 502 when the store cannot be reached; a download and a view are journaled. Files are written in a
// throwaway FILES_DIR (never .data/).

vi.mock('@/db', async (importOriginal) => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb(), FILES_DIR: await mkdtemp(join(tmpdir(), 'codex-route-errors-')) };
});
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
// importDocument as it is, unless a test makes it fail (the route's last resort, 500).
const failImport = vi.hoisted(() => ({ on: false }));
vi.mock('@/lib/importer', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/importer')>();
  return { ...real, importDocument: (...a: Parameters<typeof real.importDocument>) => (failImport.on ? Promise.reject(new Error('base injoignable')) : real.importDocument(...a)) };
});

const db = setupDb();
fixClock();

const TOKEN = 'test-token';
beforeEach(() => {
  vi.stubEnv('CODEX_IMPORT_TOKEN', TOKEN);
  vi.stubEnv('CODEX_IMPORT_SECRET', '');
  vi.stubEnv('CODEX_STORAGE', 'local');
  vi.stubEnv('CODEX_RATE_LIMIT', 'off');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  for (const f of readdirSync(FILES_DIR)) rmSync(path.join(FILES_DIR, f), { force: true });
  failImport.on = false;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(() => {
  rmSync(FILES_DIR, { recursive: true, force: true });
});

const META = { legacyRef: 'OLD-1', title: 'Procédure importée', typeCode: 'PRO', department: 'QUA', ownerId: 'owner', revision: 'C', inForceAt: '2025-03-12' };
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

/** A multipart body: `parts` in order, each a field (string) or a file. */
function multipart(parts: [string, string | { name: string; type?: string; bytes: Buffer }][]) {
  const b = 'codex-boundary';
  const chunks = parts.map(([name, v]) => (typeof v === 'string'
    ? Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${v}\r\n`)
    : Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${name}"; filename="${v.name}"\r\n${v.type ? `Content-Type: ${v.type}\r\n` : ''}\r\n`), v.bytes, Buffer.from('\r\n')])));
  return { body: Buffer.concat([...chunks, Buffer.from(`--${b}--\r\n`)]), type: `multipart/form-data; boundary=${b}` };
}

async function post(body: BodyInit | null, type: string, auth: string | null = `Bearer ${TOKEN}`) {
  const headers: Record<string, string> = { 'Content-Type': type };
  if (auth) headers.Authorization = auth;
  const res = await POST(new Request('http://codex.test/api/import', { method: 'POST', headers, body }));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}
const postJson = (meta: unknown, auth?: string | null) => post(JSON.stringify(meta), 'application/json', auth);

describe('POST /api/import, what it refuses', () => {
  it('401 without the token, or with another one', async () => {
    for (const auth of [null, 'Bearer nope', `Basic ${TOKEN}`]) {
      const r = await postJson(META, auth);
      expect(r.status, String(auth)).toBe(401);
    }
    expect(await db().select().from(s.documents)).toHaveLength(0);
  });

  it('415 for a body neither JSON nor multipart, 400 for one it cannot read', async () => {
    expect((await post('legacyRef=OLD-1', 'application/x-www-form-urlencoded')).body).toEqual({ error: 'unsupported_media_type' });
    expect((await post('legacyRef=OLD-1', 'text/plain')).status).toBe(415);
    expect(await post('{"legacyRef":', 'application/json')).toMatchObject({ status: 400, body: { error: 'invalid_json' } });
    expect(await post('not a multipart body', 'multipart/form-data; boundary=x')).toMatchObject({ status: 400, body: { error: 'invalid_body' } });
    const noMeta = multipart([['file', { name: 'a.pdf', type: 'application/pdf', bytes: PDF }]]);
    expect(await post(noMeta.body, noMeta.type)).toMatchObject({ status: 400, body: { error: 'meta_required' } });
    const badMeta = multipart([['meta', '{oops']]);
    expect(await post(badMeta.body, badMeta.type)).toMatchObject({ status: 400, body: { error: 'invalid_json', part: 'meta' } });
    const textFile = multipart([['meta', JSON.stringify(META)], ['file', 'not a file']]);
    expect(await post(textFile.body, textFile.type)).toMatchObject({ status: 400, body: { error: 'file_not_a_file' } });
    expect(await db().select().from(s.documents)).toHaveLength(0);
  });

  it('400 for metadata that do not hold, with what is wrong', async () => {
    const r = await postJson({ ...META, typeCode: 'NOPE', department: '' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('validation');
    expect(r.body.issues.length).toBeGreaterThan(0);
  });

  it('413 for a file over the limit, 415 for a format not admitted, and nothing is stored', async () => {
    vi.stubEnv('CODEX_MAX_FILE_MB', '1');
    const big = multipart([['meta', JSON.stringify(META)], ['file', { name: 'gros.pdf', type: 'application/pdf', bytes: Buffer.concat([PDF, Buffer.alloc(1024 * 1024 + 10, 0x20)]) }]]);
    expect(await post(big.body, big.type)).toMatchObject({ status: 413, body: { error: 'too_large', maxBytes: 1024 * 1024 } });
    // A body over the file plus its margin is cut off while it is read.
    const huge = multipart([['meta', JSON.stringify(META)], ['file', { name: 'gros.pdf', type: 'application/pdf', bytes: Buffer.alloc(2 * 1024 * 1024 + 10, 0x20) }]]);
    expect((await post(huge.body, huge.type)).status).toBe(413);
    vi.unstubAllEnvs();
    vi.stubEnv('CODEX_IMPORT_TOKEN', TOKEN);
    const exe = multipart([['meta', JSON.stringify(META)], ['file', { name: 'outil.exe', type: 'application/octet-stream', bytes: Buffer.from('MZ\x90\x00binary') }]]);
    const r = await post(exe.body, exe.type);
    expect(r.status).toBe(415);
    expect(r.body).toMatchObject({ error: 'file_format' });
    expect(Array.isArray(r.body.allowed)).toBe(true);
    expect(await db().select().from(s.documents)).toHaveLength(0);
  });

  it('409 for a replay of an imported reference, and for a reference that is a Codex ID', async () => {
    const first = await postJson(META);
    expect(first.status).toBe(201);
    expect(first.headers.get('location')).toBe(first.body.href);
    expect(await postJson(META)).toMatchObject({ status: 409, body: { error: 'duplicate', id: first.body.id } });
    expect(await postJson({ ...META, legacyRef: first.body.id })).toMatchObject({ status: 409, body: { error: 'ref_is_codex_id', id: first.body.id } });
    expect(await db().select().from(s.documents)).toHaveLength(1);
  });

  it('500 with the request identifier on an unexpected failure, the cause kept for the technical log only', async () => {
    failImport.on = true;
    const r = await postJson(META);
    expect(r.status).toBe(500);
    expect(r.body.error).toBe('internal');
    expect(JSON.stringify(r.body)).not.toContain('base injoignable');
  });
});

// ── The file route ───────────────────────────────────────────────────────

/** A document whose working versions each get a stored file (or the key given), the last one in force by default. */
async function docWithFile(id: string, opts: { revisions?: Parameters<typeof addDoc>[1]['revisions']; key?: (n: number) => string; storage?: string; write?: boolean } = {}) {
  await addDoc(db(), { id, revisions: opts.revisions });
  const versions = await db().select().from(s.workingVersions).where(eq(s.workingVersions.docId, id));
  for (const v of versions) {
    const key = opts.key?.(v.n) ?? `00000000-0000-4000-8000-${String(v.id).padStart(12, '0')}-${id}_v${v.n}.pdf`;
    if (opts.write !== false) writeFileSync(path.join(FILES_DIR, key), PDF);
    await db().update(s.workingVersions).set({ storage: opts.storage ?? 'local', fileKey: key, fileName: 'fichier.pdf', mime: 'application/pdf', size: PDF.length }).where(eq(s.workingVersions.id, v.id));
  }
  return versions;
}

async function fetchFile(id: string, { who = 'manager', query = '', method = 'GET' }: { who?: Person; query?: string; method?: 'GET' | 'HEAD' } = {}) {
  actAs(who);
  const req = new Request(`http://codex.test/api/documents/${encodeURIComponent(id)}/file${query}`, { method });
  const res = await (method === 'GET' ? GET : HEAD)(req, { params: Promise.resolve({ id }) });
  await res.arrayBuffer();
  return res;
}
const journal = async (id: string) => (await db().select().from(s.auditLog).where(eq(s.auditLog.docId, id))).map((a) => [a.action, a.userId, a.detail]);

describe('GET and HEAD /api/documents/[id]/file, what they refuse', () => {
  it('404 for a document that does not exist, and for one the user may not read, alike', async () => {
    await docWithFile('PRO-QUA-0001', { revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
    for (const method of ['GET', 'HEAD'] as const) {
      const none = await fetchFile('PRO-QUA-9999', { method });
      const hidden = await fetchFile('PRO-QUA-0001', { who: 'writer2', method });
      expect([none.status, hidden.status], method).toEqual([404, 404]);
      expect(hidden.headers.get('etag')).toBeNull();
    }
    expect((await fetchFile('PRO-QUA-0001', { who: 'owner' })).status).toBe(200);
  });

  it('404 for a version that is not a number, of another document, or that the reader may not have (D-14)', async () => {
    const [a1, a2] = await docWithFile('PRO-QUA-0001', { revisions: [{ letter: 'A', status: 'in_force', versions: ['owner', 'owner'] }] });
    const [other] = await docWithFile('PRO-QUA-0002');
    for (const v of ['abc', '0', '-1', '1.5', String(2 ** 31), String(other.id)]) expect((await fetchFile('PRO-QUA-0001', { query: `?v=${v}` })).status, v).toBe(404);
    // Outside the drafting circle, only the final file of the revision in force: A.1 is a working version.
    expect((await fetchFile('PRO-QUA-0001', { who: 'writer2', query: `?v=${a1.id}` })).status).toBe(404);
    expect((await fetchFile('PRO-QUA-0001', { who: 'writer2', query: `?v=${a2.id}` })).status).toBe(200);
    expect((await fetchFile('PRO-QUA-0001', { query: `?v=${a1.id}` })).status).toBe(200);
    // A preview of another kind than a PDF rendering, or of a PDF (nothing to convert).
    expect((await fetchFile('PRO-QUA-0001', { query: '?preview=png' })).status).toBe(404);
    expect((await fetchFile('PRO-QUA-0001', { query: '?preview=pdf' })).status).toBe(404);
  });

  it('404 « File missing » when the store lacks the file, 502 when the store cannot be reached', async () => {
    await docWithFile('PRO-QUA-0001', { write: false });
    const missing = await fetchFile('PRO-QUA-0001');
    expect(missing.status).toBe(404);
    // A key the local store cannot open for another reason than its absence (a link that loops).
    const loop = '00000000-0000-4000-8000-000000000777-boucle.pdf';
    symlinkSync(loop, path.join(FILES_DIR, loop));
    await docWithFile('PRO-QUA-0002', { key: () => loop, write: false });
    const local = await fetchFile('PRO-QUA-0002');
    expect([local.status, local.headers.get('retry-after')]).toEqual([502, '30']);
    // SharePoint without its settings: out of reach, whatever the request.
    await docWithFile('PRO-QUA-0003', { storage: 'sharepoint', key: () => '01ABCDEF', write: false });
    expect((await fetchFile('PRO-QUA-0003')).status).toBe(502);
    expect((await fetchFile('PRO-QUA-0003', { query: '?download=1' })).status).toBe(502);
    // Nothing is journaled for a file that was not sent.
    for (const id of ['PRO-QUA-0001', 'PRO-QUA-0002', 'PRO-QUA-0003']) expect((await journal(id)).filter(([a]) => a === 'download' || a === 'view'), id).toEqual([]);
  });

  it('journals a download, and a view of the preview, by whom and of which file', async () => {
    await docWithFile('PRO-QUA-0001');
    expect((await fetchFile('PRO-QUA-0001', { who: 'writer2', query: '?download=1' })).status).toBe(200);
    expect((await fetchFile('PRO-QUA-0001', { who: 'writer2' })).status).toBe(200);
    const lines = await journal('PRO-QUA-0001');
    expect(lines.filter(([a]) => a === 'download')).toEqual([['download', 'writer2', expect.stringContaining('A')]]);
    expect(lines.filter(([a]) => a === 'view').map(([a, u]) => [a, u])).toEqual([['view', 'writer2']]);
    // A HEAD is no download.
    await fetchFile('PRO-QUA-0001', { who: 'writer2', query: '?download=1', method: 'HEAD' });
    expect((await journal('PRO-QUA-0001')).filter(([a]) => a === 'download')).toHaveLength(1);
    const [entry] = await db().select().from(s.auditLog).where(and(eq(s.auditLog.docId, 'PRO-QUA-0001'), eq(s.auditLog.action, 'download')));
    expect(entry.revisionId).not.toBeNull();
  });
});
