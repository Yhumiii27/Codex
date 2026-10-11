import { readdir, rm } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET, HEAD } from '@/app/api/documents/[id]/file/route';
import { POST } from '@/app/api/import/route';
import { FILES_DIR, schema as s } from '@/db';
import { previewKind } from '@/lib/filetypes';
import { normalizeMime } from '@/lib/storage';
import { fixClock, setupDb } from '../support/db';
import { actAs } from '../support/session';

// Type of a file sent without a usable one (src/lib/storage.ts normalizeMime), from POST /api/import to the file route:
// a multipart part without Content-Type arrives as text/plain, which only a known text extension keeps. Any other file
// takes the type of its extension, else application/pdf for bytes starting with %PDF-, else application/octet-stream:
// it is then served as a download, under its own extension, and the document preview offers the download.

// The routes read the database through getDb(), and the local store writes under FILES_DIR: a throwaway directory.
vi.mock('@/db', async (importOriginal) => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return {
    ...(await importOriginal<typeof import('@/db')>()),
    getDb: async () => (await import('../support/db')).currentDb(),
    FILES_DIR: await mkdtemp(join(tmpdir(), 'codex-files-')),
  };
});
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));

const db = setupDb();
fixClock();

const TOKEN = 'test-token';
beforeAll(() => {
  vi.stubEnv('CODEX_IMPORT_TOKEN', TOKEN);
  vi.stubEnv('CODEX_STORAGE', 'local');
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(FILES_DIR, { recursive: true, force: true });
});

/** Bytes of a drawing: a DWG header followed by bytes that are not text. */
const DWG = Buffer.from([0x41, 0x43, 0x31, 0x30, 0x33, 0x32, 0x00, 0x00, 0x00, 0x00, 0x00, 0x06, 0x01, 0x00, 0xff, 0xfe, 0x80, 0x0a]);

/**
 * Imports one in-force procedure (revision C) whose file part carries no Content-Type, as a migration tool may send it,
 * unless `type` is given. Returns the new document's ID.
 */
async function importFile(legacyRef: string, name: string, bytes: Buffer, type?: string): Promise<string> {
  const b = 'codex-test-boundary';
  const meta = { legacyRef, title: `Doc ${legacyRef}`, typeCode: 'PRO', department: 'QUA', ownerId: 'owner', revision: 'C', inForceAt: '2025-03-12' };
  const body = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n${JSON.stringify(meta)}\r\n`),
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n${type ? `Content-Type: ${type}\r\n` : ''}\r\n`),
    bytes,
    Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  const res = await POST(new Request('http://codex.test/api/import', { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': `multipart/form-data; boundary=${b}` }, body }));
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

const versionOf = async (id: string) => (await db().select().from(s.workingVersions).where(eq(s.workingVersions.docId, id)))[0];

/** What the document page previews for a stored version (src/app/documents/[id]/page.tsx, then DocClient's Preview). */
const previewOf = async (id: string) => {
  const v = await versionOf(id);
  return previewKind(normalizeMime(v.mime, v.fileName ?? ''));
};

/** The file of the revision in force, as a records manager. */
async function fetchFile(id: string, query = '') {
  actAs('manager');
  const res = await GET(new Request(`http://codex.test/api/documents/${id}/file${query}`), { params: Promise.resolve({ id }) });
  return { status: res.status, type: res.headers.get('content-type'), disposition: res.headers.get('content-disposition'), body: Buffer.from(await res.arrayBuffer()) };
}

describe('a file sent without a usable type', () => {
  it('stores a drawing of unknown extension as application/octet-stream, under its own extension', async () => {
    const id = await importFile('GED1/PLAN/1', 'plan.dwg', DWG);
    const v = await versionOf(id);
    expect(v).toMatchObject({ mime: 'application/octet-stream', fileName: 'plan.dwg', size: DWG.length, pages: null });
    expect(v.fileKey).toMatch(new RegExp(`^[0-9a-f-]{36}-${id}_C\\.dwg$`));
    expect(await readdir(FILES_DIR)).toContain(v.fileKey);
    expect(await previewOf(id)).toBeNull();
  });

  it('serves it as a download, never inline as text', async () => {
    const id = await importFile('GED1/PLAN/2', 'plan.dwg', DWG);
    const attachment = `attachment; filename*=UTF-8''${id}_C.dwg`;
    expect(await fetchFile(id)).toEqual({ status: 200, type: 'application/octet-stream', disposition: attachment, body: DWG });
    expect(await fetchFile(id, '?download=1')).toMatchObject({ status: 200, type: 'application/octet-stream', disposition: attachment });
    actAs('manager');
    const head = await HEAD(new Request(`http://codex.test/api/documents/${id}/file`, { method: 'HEAD' }), { params: Promise.resolve({ id }) });
    expect([head.headers.get('content-type'), head.headers.get('content-disposition')]).toEqual(['application/octet-stream', attachment]);
  });

  it('serves a file recorded as text/plain before the fix as a download too', async () => {
    const id = await importFile('GED1/PLAN/3', 'plan.dwg', DWG);
    await db().update(s.workingVersions).set({ mime: 'text/plain' }).where(eq(s.workingVersions.docId, id));
    expect(await fetchFile(id)).toMatchObject({ status: 200, type: 'application/octet-stream', disposition: `attachment; filename*=UTF-8''${id}_C.dwg` });
    expect(await previewOf(id)).toBeNull();
  });

  it('gives a file without extension no extension, and serves it as a download', async () => {
    const id = await importFile('GED1/LISEZMOI', 'LISEZMOI', DWG);
    const v = await versionOf(id);
    expect(v).toMatchObject({ mime: 'application/octet-stream', fileName: 'LISEZMOI' });
    expect(v.fileKey).toMatch(new RegExp(`-${id}_C$`));
    expect(await fetchFile(id)).toMatchObject({ status: 200, type: 'application/octet-stream', disposition: `attachment; filename*=UTF-8''${id}_C` });
    expect(await previewOf(id)).toBeNull();
  });

  it('keeps a text file as text/plain, served inline', async () => {
    const text = Buffer.from('Relevé du 12 mars\n');
    const id = await importFile('GED1/NOTES', 'notes.txt', text);
    expect(await versionOf(id)).toMatchObject({ mime: 'text/plain', fileName: 'notes.txt' });
    expect(await fetchFile(id)).toEqual({ status: 200, type: 'text/plain', disposition: `inline; filename*=UTF-8''${id}_C.txt`, body: text });
    expect(await previewOf(id)).toBe('text');
  });

  it('keeps a specific type declared for an unknown extension', async () => {
    const id = await importFile('GED1/PLAN/4', 'plan.dwg', DWG, 'image/vnd.dwg');
    expect(await versionOf(id)).toMatchObject({ mime: 'image/vnd.dwg', fileName: 'plan.dwg' });
    expect(await fetchFile(id)).toMatchObject({ type: 'application/octet-stream', disposition: `attachment; filename*=UTF-8''${id}_C.dwg` });
    // Not an image the route serves inline: the preview offers the download instead of a broken image.
    expect(await previewOf(id)).toBeNull();
  });

  it('recognises a PDF without extension by its signature', async () => {
    const pdf = Buffer.from('%PDF-1.7\n%%EOF\n');
    const id = await importFile('GED1/SCAN', 'scan', pdf);
    expect(await versionOf(id)).toMatchObject({ mime: 'application/pdf', fileName: 'scan' });
    expect(await fetchFile(id)).toMatchObject({ type: 'application/pdf', disposition: `inline; filename*=UTF-8''${id}_C.pdf` });
    expect(await previewOf(id)).toBe('pdf');
  });

  it('takes the type of a known extension before the PDF signature', async () => {
    const pdf = Buffer.from('%PDF-1.7\n%%EOF\n');
    const id = await importFile('GED1/RAPPORT', 'rapport.docx', pdf);
    expect(await versionOf(id)).toMatchObject({ mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileName: 'rapport.docx', pages: null });
    expect(await fetchFile(id)).toMatchObject({ type: 'application/octet-stream', disposition: `attachment; filename*=UTF-8''${id}_C.docx`, body: pdf });
    expect(await previewOf(id)).toBeNull();
  });
});
