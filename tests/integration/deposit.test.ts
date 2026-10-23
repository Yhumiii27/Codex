import { createHash } from 'node:crypto';
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/documents/route';
import { FILES_DIR, schema as s } from '@/db';
import { resetRateLimits } from '@/lib/ratelimit';
import { signRequest } from '@/lib/server-auth';
import { fixClock, setupDb } from '../support/db';

// Deposit of a document by another application of the group (POST /api/documents, docs/api.md; Arche's request CX-03 in
// REQUESTS.md): a new document in draft A.1 with its file, which a circuit approves as any other draft (no revision
// approved outright: docs/decisions.md), idempotent by its source reference, the file's SHA-256 checked when given.

vi.mock('@/db', async (importOriginal) => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { ...(await importOriginal<typeof import('@/db')>()), FILES_DIR: mkdtempSync(join(tmpdir(), 'codex-deposit-')), getDb: async () => (await import('../support/db')).currentDb() };
});

const db = setupDb();
fixClock('2026-10-23T08:00:00Z');

const TOKEN = 'D3p0sit-t0ken-0f-th1rty-tw0-v4r1ed-ch4rs';
const SECRET = 'D3p0sit-s3cret-0f-th1rty-tw0-v4r1ed-ch4rs';
const REF = 'arche:dossier/CPX-APM-2026-01/business_case/v2';
const META = { sourceRef: REF, title: 'Business Case — Cadrage, v2', typeCode: 'PRO', department: 'QUA', ownerId: 'owner', conf: 'interne' };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const OTHER_PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Lang (fr) >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

beforeEach(() => {
  resetRateLimits();
  vi.stubEnv('CODEX_DOCUMENTS_TOKEN', TOKEN);
  vi.stubEnv('CODEX_DOCUMENTS_SECRET', '');
  vi.stubEnv('CODEX_STORAGE', 'local');
  vi.stubEnv('CODEX_CLAMD', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const f of readdirSync(FILES_DIR)) rmSync(path.join(FILES_DIR, f), { force: true });
});
afterAll(() => rmSync(FILES_DIR, { recursive: true, force: true }));

type Body = { meta: unknown; file?: { name: string; bytes: Buffer } };

function request(body: Body, query = '', headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}` }, sign?: string): Request {
  let bytes: Buffer;
  let type: string;
  if (!body.file) {
    bytes = Buffer.from(JSON.stringify(body.meta));
    type = 'application/json';
  } else {
    const b = 'codex-deposit-boundary';
    bytes = Buffer.concat([
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n${JSON.stringify(body.meta)}\r\n`),
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${body.file.name}"\r\nContent-Type: application/pdf\r\n\r\n`),
      body.file.bytes,
      Buffer.from(`\r\n--${b}--\r\n`),
    ]);
    type = `multipart/form-data; boundary=${b}`;
  }
  const signed = sign ? signRequest(sign, new Uint8Array(bytes)) : {};
  return new Request(`http://codex.test/api/documents${query}`, { method: 'POST', headers: { 'Content-Type': type, ...headers, ...signed }, body: new Uint8Array(bytes) });
}

async function send(body: Body, query = '', headers?: Record<string, string>, sign?: string) {
  const res = await POST(request(body, query, headers, sign));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, location: res.headers.get('location') };
}

const documents = () => db().select().from(s.documents);
/** The files in the store, without the prefix that makes each stored name unique (lib/storage.ts). */
const stored = () => readdirSync(FILES_DIR).map((f) => f.replace(/^[0-9a-f-]{36}-/, ''));
const withFile = (meta: Record<string, unknown> = META, bytes = PDF): Body => ({ meta, file: { name: 'business-case.pdf', bytes } });

describe('POST /api/documents: authentication', () => {
  it('is disabled (503) without CODEX_DOCUMENTS_TOKEN nor CODEX_DOCUMENTS_SECRET, and refuses a wrong token (401)', async () => {
    vi.stubEnv('CODEX_DOCUMENTS_TOKEN', '');
    expect((await send(withFile())).status).toBe(503);
    vi.stubEnv('CODEX_DOCUMENTS_TOKEN', TOKEN);
    expect((await send(withFile(), '', { Authorization: 'Bearer wrong-token-of-thirty-two-characters' })).status).toBe(401);
    expect(await documents()).toHaveLength(0);
  });

  it('does not take the import token: each endpoint has its own credentials', async () => {
    vi.stubEnv('CODEX_IMPORT_TOKEN', 'Imp0rt-t0ken-0f-th1rty-tw0-v4r1ed-ch4rs');
    expect((await send(withFile(), '', { Authorization: 'Bearer Imp0rt-t0ken-0f-th1rty-tw0-v4r1ed-ch4rs' })).status).toBe(401);
  });

  it('checks the signature with CODEX_DOCUMENTS_SECRET', async () => {
    vi.stubEnv('CODEX_DOCUMENTS_SECRET', SECRET);
    expect((await send(withFile())).body).toMatchObject({ error: 'unauthorized', reason: 'signature_missing' });
    const res = await send(withFile(), '', { Authorization: `Bearer ${TOKEN}` }, SECRET);
    expect(res.status).toBe(201);
  });
});

describe('POST /api/documents: the document it creates', () => {
  it('creates a draft A.1 carrying the file, the source reference recorded but not as an alias, journaled as an upload', async () => {
    const res = await send(withFile({ ...META, sha256: sha(PDF) }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 'PRO-QUA-0001', revision: 'A', version: 'A.1', status: 'draft', file: true, href: '/documents/PRO-QUA-0001' });
    expect(res.location).toBe('/documents/PRO-QUA-0001');
    const [d] = await documents();
    expect(d).toMatchObject({ id: 'PRO-QUA-0001', legacyRef: REF, aliases: [], status: 'draft', ownerId: 'owner', conf: 'interne' });
    const [rev] = await db().select().from(s.revisions).where(eq(s.revisions.docId, d.id));
    expect(rev).toMatchObject({ letter: 'A', status: 'draft', approvedAt: null, inForceAt: null });
    const [wv] = await db().select().from(s.workingVersions).where(eq(s.workingVersions.docId, d.id));
    expect(wv).toMatchObject({ n: 1, sha256: sha(PDF), comment: { fr: `Déposé par arche (${REF})`, en: `Filed by arche (${REF})` } });
    const journal = await db().select().from(s.auditLog).where(eq(s.auditLog.docId, d.id));
    expect(journal.map((e) => [e.userId, e.action, e.detail])).toEqual([['codex', 'upload', `A.1 · ${REF}`]]);
    expect(stored()).toEqual(['PRO-QUA-0001_A.1.pdf']);
  });

  it('takes the owner by matricule, the number the tools of the group share', async () => {
    await db().update(s.users).set({ matricule: 'EMP-0042' }).where(eq(s.users.id, 'writer'));
    const rest: Partial<typeof META> = { ...META };
    delete rest.ownerId;
    const res = await send(withFile({ ...rest, ownerMatricule: 'EMP-0042' }));
    expect(res.status).toBe(201);
    expect((await documents())[0].ownerId).toBe('writer');
    const unknown = await send(withFile({ ...rest, sourceRef: `${REF}-b`, ownerMatricule: 'EMP-9999' }));
    expect(unknown.status).toBe(400);
    expect(unknown.body.issues.map((i: { field: string; code: string }) => `${i.field}:${i.code}`)).toContain('ownerMatricule:unknown_user');
    const both = await send(withFile({ ...META, sourceRef: `${REF}-c`, ownerMatricule: 'EMP-0042' }));
    expect(both.body.issues.map((i: { field: string; code: string }) => `${i.field}:${i.code}`)).toContain('ownerId:owner_ambiguous');
  });

  it('refuses what only a migration may set: a revision letter, a status, dates, a legacy reference', async () => {
    const res = await send(withFile({ ...META, status: 'in_force', revision: 'C', inForceAt: '2026-01-01', issuedAt: '2026-01-01', legacyRef: 'X-1' }));
    expect(res.status).toBe(400);
    expect(res.body.issues.filter((i: { code: string }) => i.code === 'not_allowed').map((i: { field: string }) => i.field).sort())
      .toEqual(['inForceAt', 'issuedAt', 'legacyRef', 'revision', 'status']);
    expect(await documents()).toHaveLength(0);
    expect(readdirSync(FILES_DIR)).toEqual([]);
  });

  it('needs a source reference <application>:<reference>', async () => {
    const rest: Partial<typeof META> = { ...META };
    delete rest.sourceRef;
    const missing = await send(withFile(rest));
    expect(missing.body.issues).toEqual([expect.objectContaining({ field: 'sourceRef', code: 'required' })]);
    for (const bad of ['dossier-sans-application', 'Arche:x', 'arche: x', 'arche:x\ny', `arche:${'x'.repeat(200)}`]) {
      const res = await send(withFile({ ...META, sourceRef: bad }));
      expect(res.status, bad).toBe(400);
      expect(res.body.issues, bad).toEqual([expect.objectContaining({ field: 'sourceRef', code: 'invalid_source_ref' })]);
    }
    expect(await documents()).toHaveLength(0);
  });

  it('applies the rules of the register, as the import and the creation dialog do', async () => {
    const res = await send(withFile({ ...META, typeCode: 'NOPE', department: 'ZZZ' }));
    expect(res.status).toBe(400);
    expect(res.body.issues.map((i: { field: string; code: string }) => `${i.field}:${i.code}`)).toEqual(['typeCode:unknown_type', 'department:unknown_department']);
  });
});

describe('POST /api/documents: idempotence and file fingerprint', () => {
  it('answers the document it already made when the same deposit comes again (200), and creates nothing', async () => {
    const first = await send(withFile());
    const again = await send(withFile());
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ id: first.body.id, href: first.body.href, replayed: true });
    expect(await documents()).toHaveLength(1);
    expect(readdirSync(FILES_DIR)).toHaveLength(1);
  });

  it('refuses another file under a source reference already used (409 source_ref_reused)', async () => {
    const first = await send(withFile());
    const other = await send(withFile(META, OTHER_PDF));
    expect(other.status).toBe(409);
    expect(other.body).toEqual({ error: 'source_ref_reused', id: first.body.id });
    expect(await documents()).toHaveLength(1);
    expect(stored()).toEqual(['PRO-QUA-0001_A.1.pdf']);
  });

  it('refuses a file whose SHA-256 is not the one given (422), before storing anything', async () => {
    const res = await send(withFile({ ...META, sha256: sha(OTHER_PDF) }));
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: 'sha256_mismatch', expected: sha(OTHER_PDF), actual: sha(PDF) });
    expect((await send({ meta: { ...META, sha256: sha(PDF) } })).body.issues[0]).toMatchObject({ field: 'sha256', code: 'file_required' });
    expect((await send(withFile({ ...META, sha256: 'abc' }))).status).toBe(400);
    expect(await documents()).toHaveLength(0);
    expect(readdirSync(FILES_DIR)).toEqual([]);
  });

  it('simulates with ?dryRun=1: the ID it would get, nothing written', async () => {
    const res = await send(withFile(), '?dryRun=1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dryRun: true, id: 'PRO-QUA-0001', warnings: [] });
    expect(await documents()).toHaveLength(0);
    expect(readdirSync(FILES_DIR)).toEqual([]);
  });
});
