import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, HEAD } from '@/app/api/documents/[id]/file/route';
import { FILES_DIR, schema as s } from '@/db';
import { previewPlan, RETRY_MS } from '@/lib/office-preview';
import { simplePdf } from '@/lib/pdf';
import { countPdfPages } from '@/lib/storage';
import { addDoc, fixClock, setClock, setupDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { docx } from '../support/office';
import { actAs } from '../support/session';

// PDF preview of Office files (point 15 of docs/reste-a-faire.md, src/lib/office-preview.ts): converted by the service
// configured, the first time the file route is asked for it (?preview=pdf), under the file's own rights (D-14), then
// kept and served again without converting; a failure is recorded and not tried again for an hour; without a service,
// a stand-in. LibreOffice is not needed: a fake soffice (a shell script acting as soffice --convert-to pdf) and a fake
// Gotenberg (an HTTP server) stand in for them, as the fake clamd does for the virus scan. With CODEX_TEST_SOFFICE set to
// the path of a real soffice, the last test converts a real file.

vi.mock('@/db', async (importOriginal) => {
  const { mkdtempSync: mk } = await import('node:fs');
  const { tmpdir: td } = await import('node:os');
  const { join } = await import('node:path');
  return { ...(await importOriginal<typeof import('@/db')>()), FILES_DIR: mk(join(td(), 'codex-preview-')), getDb: async () => (await import('../support/db')).currentDb() };
});
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));

const db = setupDb();
fixClock('2026-10-15T08:00:00Z');

/** The fake soffice's folder: the script, its mode (ok, fail, slow, garbage, none), what it was called with. */
const fake = mkdtempSync(path.join(tmpdir(), 'codex-fake-soffice-'));
const SOFFICE = path.join(fake, 'soffice');
/** What the converters give: a PDF of several pages. */
const RENDER = simplePdf(Array.from({ length: 90 }, (_, i) => ({ text: `Ligne ${i + 1} du rendu` })));
const PAGES = countPdfPages(RENDER, 'application/pdf')!;

let gotenberg: Server;
let gotenbergUrl = '';
const gotenbergState = { mode: 'ok' as 'ok' | 'error' | 'slow', calls: 0, bodies: [] as string[] };

beforeAll(async () => {
  writeFileSync(SOFFICE, `#!/bin/sh
dir=$(dirname "$0")
mode=$(cat "$dir/mode")
echo $$ > "$dir/pid"
env > "$dir/env"
echo "$@" >> "$dir/calls"
out=""; prev=""
for a in "$@"; do if [ "$prev" = "--outdir" ]; then out="$a"; fi; prev="$a"; done
case "$mode" in
  fail) echo "erreur simulée" >&2; exit 1;;
  slow) sleep 30; exit 0;;
  garbage) mkdir -p "$out"; echo "pas un pdf" > "$out/source.pdf"; exit 0;;
  none) exit 0;;
esac
mkdir -p "$out"; cp "$dir/render.pdf" "$out/source.pdf"
`);
  chmodSync(SOFFICE, 0o755);
  writeFileSync(path.join(fake, 'render.pdf'), RENDER);
  gotenberg = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      gotenbergState.calls++;
      gotenbergState.bodies.push(`${req.method} ${req.url} ${req.headers['content-type']}\n${Buffer.concat(chunks).toString('latin1')}`);
      if (gotenbergState.mode === 'error') {
        res.writeHead(500).end('LibreOffice failed');
        return;
      }
      const send = () => res.writeHead(200, { 'Content-Type': 'application/pdf' }).end(RENDER);
      if (gotenbergState.mode === 'slow') setTimeout(send, 8000);
      else send();
    });
  });
  await new Promise<void>((resolve) => gotenberg.listen(0, '127.0.0.1', resolve));
  const addr = gotenberg.address();
  gotenbergUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
afterAll(async () => {
  gotenberg.closeAllConnections();
  await new Promise((resolve) => gotenberg.close(resolve));
  rmSync(fake, { recursive: true, force: true });
  rmSync(FILES_DIR, { recursive: true, force: true });
});
beforeEach(() => {
  writeFileSync(path.join(fake, 'mode'), 'ok');
  rmSync(path.join(fake, 'calls'), { force: true });
  Object.assign(gotenbergState, { mode: 'ok', calls: 0, bodies: [] });
  vi.stubEnv('CODEX_PREVIEW_SOFFICE', SOFFICE);
  vi.stubEnv('CODEX_TEST_SECRET', 'ne-doit-pas-sortir');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const ID = 'PRO-QUA-0001';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const sofficeCalls = () => (existsSync(path.join(fake, 'calls')) ? readFileSync(path.join(fake, 'calls'), 'utf8').trim().split('\n').length : 0);

/** PRO-QUA-0001: A in force (a Word file), B being drafted (B.1, a Word file). Returns the working version ids. */
async function setup() {
  await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'draft', versions: ['owner'] }] });
  const out: Record<string, number> = {};
  for (const v of await db().select({ id: s.workingVersions.id, letter: s.revisions.letter }).from(s.workingVersions).innerJoin(s.revisions, eq(s.revisions.id, s.workingVersions.revisionId)).where(eq(s.workingVersions.docId, ID))) {
    const bytes = docx([`Révision ${v.letter}`]);
    const key = `00000000-0000-4000-8000-${String(v.id).padStart(12, '0')}-${ID}_${v.letter}.1.docx`;
    writeFileSync(path.join(FILES_DIR, key), bytes);
    await db().update(s.workingVersions).set({ storage: 'local', fileKey: key, fileName: `procedure-${v.letter}.docx`, mime: DOCX, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }).where(eq(s.workingVersions.id, v.id));
    out[v.letter] = v.id;
  }
  return out;
}

async function preview(vid: number, { who = 'owner', method = 'GET', query = 'preview=pdf' }: { who?: Person; method?: 'GET' | 'HEAD'; query?: string } = {}) {
  actAs(who);
  const req = new Request(`http://codex.test/api/documents/${ID}/file?v=${vid}&${query}`, { method });
  return (method === 'GET' ? GET : HEAD)(req, { params: Promise.resolve({ id: ID }) });
}
const bytesOf = async (res: Response) => Buffer.from(await res.arrayBuffer());
const rowOf = async (vid: number) => (await db().select().from(s.versionPreviews).where(eq(s.versionPreviews.workingVersionId, vid)))[0] ?? null;
/** A stand-in: a one-page PDF made here, never kept by the browser. */
async function expectStandIn(res: Response) {
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('application/pdf');
  expect(res.headers.get('cache-control')).toBe('private, no-store, no-transform');
  const body = await bytesOf(res);
  expect(body.equals(RENDER)).toBe(false);
  expect(countPdfPages(body, 'application/pdf')).toBe(1);
}

describe('LibreOffice (CODEX_PREVIEW_SOFFICE)', () => {
  it('converts on the first request, keeps the rendering with its page count, and serves it again without converting', async () => {
    const { A } = await setup();
    expect(PAGES).toBeGreaterThan(1);
    expect(await previewPlan({ id: A, fileKey: 'k', size: 10 }, '.docx')).toEqual({ kind: 'render', pages: null });
    const res = await preview(A);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe(`inline; filename*=UTF-8''${ID}_A_APERCU.pdf`);
    expect((await bytesOf(res)).equals(RENDER)).toBe(true);
    expect(sofficeCalls()).toBe(1);
    const row = await rowOf(A);
    expect(row).toMatchObject({ status: 'ready', pages: PAGES, size: RENDER.length, converter: 'soffice', error: null, sha256: createHash('sha256').update(RENDER).digest('hex') });
    expect(row.fileKey).toMatch(new RegExp(`^[0-9a-f-]{36}-${ID}_A\\.apercu\\.pdf$`));
    expect(readFileSync(path.join(FILES_DIR, row.fileKey!)).equals(RENDER)).toBe(true);
    expect(await previewPlan({ id: A, fileKey: 'k', size: 10 }, '.docx')).toEqual({ kind: 'render', pages: PAGES });
    // Again: from the store, conditional like the file it renders.
    const again = await preview(A);
    expect((await bytesOf(again)).equals(RENDER)).toBe(true);
    expect(sofficeCalls()).toBe(1);
    expect(again.headers.get('etag')).toBe(res.headers.get('etag'));
    // Viewed, as the file would be: "A · DOCX → PDF".
    const views = await db().select().from(s.auditLog).where(and(eq(s.auditLog.docId, ID), eq(s.auditLog.action, 'view')));
    expect(views.map((v) => v.detail)).toEqual(['A · DOCX → PDF']);
  });

  it('runs LibreOffice with an environment of its own (no variable of Codex) and its own profile', async () => {
    const { A } = await setup();
    await bytesOf(await preview(A));
    const env = readFileSync(path.join(fake, 'env'), 'utf8');
    expect(env).not.toContain('CODEX_');
    expect(env).not.toContain('ne-doit-pas-sortir');
    expect(readFileSync(path.join(fake, 'calls'), 'utf8')).toMatch(/-env:UserInstallation=file:\/\/\S+\/profile --headless .*--convert-to pdf --outdir \S+\/out \S+\/source\.docx/);
  });

  it('serves the rendering under the rights of the file: outside the drafting circle, only the revision in force (D-14)', async () => {
    const { A, B } = await setup();
    expect((await preview(B, { who: 'auditor' })).status).toBe(404);
    expect(sofficeCalls()).toBe(0);
    expect(await rowOf(B)).toBeNull();
    expect((await preview(A, { who: 'auditor' })).status).toBe(200);
    expect((await preview(B, { who: 'owner' })).status).toBe(200);
    expect(sofficeCalls()).toBe(2);
  });

  it('answers 404 for a file that is not converted, or an unknown kind of preview', async () => {
    const { A } = await setup();
    await db().update(s.workingVersions).set({ fileName: 'scan.pdf', mime: 'application/pdf' }).where(eq(s.workingVersions.id, A));
    expect((await preview(A)).status).toBe(404);
    expect((await preview(A, { query: 'preview=png' })).status).toBe(404);
    expect(sofficeCalls()).toBe(0);
  });

  it('a failed conversion gives the stand-in, is recorded, and is not tried again for an hour', async () => {
    const { A } = await setup();
    writeFileSync(path.join(fake, 'mode'), 'fail');
    await expectStandIn(await preview(A));
    expect(await rowOf(A)).toMatchObject({ status: 'failed', fileKey: null, error: 'failed' });
    expect(await previewPlan({ id: A, fileKey: 'k', size: 10 }, '.docx')).toEqual({ kind: 'failed', reason: 'failed' });
    writeFileSync(path.join(fake, 'mode'), 'ok');
    await expectStandIn(await preview(A));
    expect(sofficeCalls()).toBe(1);
    setClock(new Date(Date.parse('2026-10-15T08:00:00Z') + RETRY_MS + 60_000).toISOString());
    expect((await bytesOf(await preview(A))).equals(RENDER)).toBe(true);
    expect(sofficeCalls()).toBe(2);
    expect(await rowOf(A)).toMatchObject({ status: 'ready', error: null });
  });

  it('what is not a PDF, or nothing at all, is a failure', async () => {
    const { A, B } = await setup();
    writeFileSync(path.join(fake, 'mode'), 'garbage');
    await expectStandIn(await preview(A));
    expect(await rowOf(A)).toMatchObject({ status: 'failed', error: 'invalid' });
    writeFileSync(path.join(fake, 'mode'), 'none');
    await expectStandIn(await preview(B));
    expect(await rowOf(B)).toMatchObject({ status: 'failed', error: 'failed' });
  });

  it('a conversion beyond CODEX_PREVIEW_TIMEOUT_S is stopped, LibreOffice killed', async () => {
    const { A } = await setup();
    vi.stubEnv('CODEX_PREVIEW_TIMEOUT_S', '5');
    writeFileSync(path.join(fake, 'mode'), 'slow');
    const started = Date.now();
    await expectStandIn(await preview(A));
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(await rowOf(A)).toMatchObject({ status: 'failed', error: 'timeout' });
    const pid = Number(readFileSync(path.join(fake, 'pid'), 'utf8'));
    await new Promise((r) => setTimeout(r, 200));
    expect(() => process.kill(pid, 0)).toThrow();
  }, 30_000);

  it('a file beyond CODEX_PREVIEW_MAX_MB is not converted', async () => {
    const { A } = await setup();
    vi.stubEnv('CODEX_PREVIEW_MAX_MB', '1');
    await db().update(s.workingVersions).set({ size: 2 * 1024 * 1024 }).where(eq(s.workingVersions.id, A));
    await expectStandIn(await preview(A));
    expect(sofficeCalls()).toBe(0);
    expect(await previewPlan({ id: A, fileKey: 'k', size: 2 * 1024 * 1024 }, '.docx')).toEqual({ kind: 'failed', reason: 'too_large' });
  });

  it('a rendering missing from the store is made again; an altered one is cut short and forgotten', async () => {
    const { A } = await setup();
    await bytesOf(await preview(A));
    const first = (await rowOf(A)).fileKey!;
    rmSync(path.join(FILES_DIR, first));
    expect((await bytesOf(await preview(A))).equals(RENDER)).toBe(true);
    expect(sofficeCalls()).toBe(2);
    const second = (await rowOf(A)).fileKey!;
    expect(second).not.toBe(first);
    writeFileSync(path.join(FILES_DIR, second), Buffer.concat([RENDER.subarray(0, -10), Buffer.from('0123456789')]));
    await expect(bytesOf(await preview(A))).rejects.toThrow();
    expect(await rowOf(A)).toBeNull();
    expect(existsSync(path.join(FILES_DIR, second))).toBe(false);
  });

  it('a source file altered since its upload is not converted', async () => {
    const { A } = await setup();
    await db().update(s.workingVersions).set({ sha256: 'c'.repeat(64) }).where(eq(s.workingVersions.id, A));
    await expectStandIn(await preview(A));
    expect(sofficeCalls()).toBe(0);
    expect(await rowOf(A)).toBeNull();
  });

  it('HEAD never starts a conversion', async () => {
    const { A } = await setup();
    const head = await preview(A, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('cache-control')).toBe('private, no-store, no-transform');
    expect(sofficeCalls()).toBe(0);
    await bytesOf(await preview(A));
    expect((await preview(A, { method: 'HEAD' })).headers.get('content-length')).toBe(String(RENDER.length));
  });

  it('two requests at once make one conversion', async () => {
    const { A } = await setup();
    const [r1, r2] = await Promise.all([preview(A), preview(A)]);
    expect((await bytesOf(r1)).equals(RENDER)).toBe(true);
    expect((await bytesOf(r2)).equals(RENDER)).toBe(true);
    expect(sofficeCalls()).toBe(1);
  });
});

describe('Gotenberg (CODEX_PREVIEW_GOTENBERG_URL)', () => {
  beforeEach(() => {
    vi.stubEnv('CODEX_PREVIEW_SOFFICE', '');
  });

  it('posts the file to /forms/libreoffice/convert and keeps the PDF it answers', async () => {
    const { A } = await setup();
    vi.stubEnv('CODEX_PREVIEW_GOTENBERG_URL', `${gotenbergUrl}/`);
    expect((await bytesOf(await preview(A))).equals(RENDER)).toBe(true);
    expect(gotenbergState.calls).toBe(1);
    expect(gotenbergState.bodies[0]).toMatch(/^POST \/forms\/libreoffice\/convert multipart\/form-data; boundary=/);
    expect(gotenbergState.bodies[0]).toContain('name="files"; filename="source.docx"');
    expect(await rowOf(A)).toMatchObject({ status: 'ready', converter: 'gotenberg', pages: PAGES });
  });

  it('an error of the service, or no answer in time, is a failure', async () => {
    const { A, B } = await setup();
    vi.stubEnv('CODEX_PREVIEW_GOTENBERG_URL', gotenbergUrl);
    gotenbergState.mode = 'error';
    await expectStandIn(await preview(A));
    expect(await rowOf(A)).toMatchObject({ status: 'failed', error: 'failed', converter: 'gotenberg' });
    gotenbergState.mode = 'slow';
    vi.stubEnv('CODEX_PREVIEW_TIMEOUT_S', '5');
    await expectStandIn(await preview(B));
    expect(await rowOf(B)).toMatchObject({ status: 'failed', error: 'timeout' });
  }, 30_000);
});

describe('without a conversion service', () => {
  it('nothing is converted: the record keeps « Aperçu indisponible », the route a stand-in', async () => {
    const { A } = await setup();
    vi.stubEnv('CODEX_PREVIEW_SOFFICE', '');
    expect(await previewPlan({ id: A, fileKey: 'k', size: 10 }, '.docx')).toBeNull();
    await expectStandIn(await preview(A));
    expect(await rowOf(A)).toBeNull();
    // Both named: none is used.
    vi.stubEnv('CODEX_PREVIEW_SOFFICE', SOFFICE);
    vi.stubEnv('CODEX_PREVIEW_GOTENBERG_URL', gotenbergUrl);
    await expectStandIn(await preview(A));
    expect(sofficeCalls() + gotenbergState.calls).toBe(0);
  });
});

describe.skipIf(!process.env.CODEX_TEST_SOFFICE)('a real LibreOffice (CODEX_TEST_SOFFICE)', () => {
  it('converts a Word file to a PDF of its pages', async () => {
    const { A } = await setup();
    vi.stubEnv('CODEX_PREVIEW_SOFFICE', process.env.CODEX_TEST_SOFFICE!);
    const pdf = await bytesOf(await preview(A));
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(await rowOf(A)).toMatchObject({ status: 'ready', pages: 1 });
  }, 120_000);
});
