import { createHash } from 'node:crypto';
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as DEPOSIT } from '@/app/api/documents/route';
import { POST as DESTROY } from '@/app/api/documents/[id]/destroy/route';
import { GET as FILE, HEAD as FILE_HEAD } from '@/app/api/documents/[id]/file/route';
import { FILES_DIR, schema as s } from '@/db';
import { readableSql, type Viewer } from '@/lib/access';
import { resetRateLimits } from '@/lib/ratelimit';
import { signRequest, routeSigned } from '@/lib/server-auth';
import { fixClock, setupDb } from '../support/db';

// Records of the personnel file filed by Cursus (request « lot 16 » in REQUESTS.md; docs/api.md; lib/records.ts, D-32):
// filed in force without circuit with Cursus's own token, read back as filed, destroyed with a coded reason leaving a
// trace without content; the highly confidential ones hidden from everyone but the HR readers, records managers included.

vi.mock('@/db', async (importOriginal) => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { ...(await importOriginal<typeof import('@/db')>()), FILES_DIR: mkdtempSync(join(tmpdir(), 'codex-cursus-')), getDb: async () => (await import('../support/db')).currentDb() };
});

const db = setupDb();
fixClock('2026-11-26T08:00:00Z');

const CURSUS = 'Cursu5-t0ken-0f-th1rty-tw0-v4r1ed-ch4rs';
const CURSUS_SECRET = 'Cursu5-s3cret-0f-th1rty-tw0-v4r1ed-ch4rs';
const DOCS = 'D3p0sit-t0ken-0f-th1rty-tw0-v4r1ed-ch4rs';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const REF = 'cursus:piece/1042';
const META = { sourceRef: REF, title: 'Attestation de formation — EMP-0042 — 2026-11', category: 'training_certificate', subjectMatricule: 'EMP-0042', sha256: sha(PDF) };

beforeEach(async () => {
  resetRateLimits();
  vi.stubEnv('CODEX_CURSUS_TOKEN', CURSUS);
  vi.stubEnv('CODEX_CURSUS_SECRET', '');
  vi.stubEnv('CODEX_DOCUMENTS_TOKEN', DOCS);
  vi.stubEnv('CODEX_DOCUMENTS_SECRET', '');
  vi.stubEnv('CODEX_STORAGE', 'local');
  vi.stubEnv('CODEX_CLAMD', '');
  // What the register adds on a real database (the fixtures are emptied before each test); Cursus's account is created
  // by its first deposit.
  await db().insert(s.departments).values({ code: 'RHU', labelFr: 'RH', labelEn: 'HR', sort: 9 });
  await db().insert(s.families).values({ key: 'support', labelFr: 'support', labelEn: 'support', grp: 'DI', sort: 9 });
  await db().insert(s.docTypes).values({
    code: 'DPE', labelFr: 'DPE', labelEn: 'DPE', family: 'support', origins: ['interne'], attachments: ['none'], subtypes: [], circuit: [],
    retentionYears: 5, retentionTrigger: 'employee_departure', retentionDisposition: 'destroy', confAllowed: ['confidentiel', 'tres_confidentiel'], confDefault: 'confidentiel', sort: 9,
  });
  await db().insert(s.functions).values({ key: 'lecteur_dossier_personnel', labelFr: 'Lecteur', labelEn: 'Reader', scope: 'global', sort: 9 });
  await db().insert(s.functionHolders).values({ functionKey: 'lecteur_dossier_personnel', scopeValue: null, userId: 'writer2' });
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const f of readdirSync(FILES_DIR)) rmSync(path.join(FILES_DIR, f), { force: true });
});
afterAll(() => rmSync(FILES_DIR, { recursive: true, force: true }));

function depositRequest(meta: unknown, token = CURSUS, bytes: Buffer | null = PDF, sign?: string): Request {
  const b = 'codex-cursus-boundary';
  const body = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n${JSON.stringify(meta)}\r\n`),
    ...(bytes ? [Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="piece.pdf"\r\nContent-Type: application/pdf\r\n\r\n`), bytes, Buffer.from('\r\n')] : []),
    Buffer.from(`--${b}--\r\n`),
  ]);
  const signed = sign ? signRequest(sign, new Uint8Array(body)) : {};
  return new Request('http://codex.test/api/documents', { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${b}`, Authorization: `Bearer ${token}`, ...signed }, body: new Uint8Array(body) });
}

async function deposit(meta: unknown, token = CURSUS, bytes: Buffer | null = PDF, sign?: string) {
  const res = await DEPOSIT(depositRequest(meta, token, bytes, sign));
  return { status: res.status, body: await res.json() };
}

const codes = (body: { issues?: { field: string; code: string }[] }) => (body.issues ?? []).map((i) => `${i.field}:${i.code}`);

async function readFile(id: string, headers: Record<string, string> = { Authorization: `Bearer ${CURSUS}` }) {
  return FILE(new Request(`http://codex.test/api/documents/${id}/file`, { headers }), { params: Promise.resolve({ id }) });
}

async function destroy(id: string, body: unknown, headers: Record<string, string> = { Authorization: `Bearer ${CURSUS}` }) {
  const res = await DESTROY(new Request(`http://codex.test/api/documents/${id}/destroy`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
  return { status: res.status, body: await res.json() };
}

const journal = (id: string) => db().select().from(s.auditLog).where(eq(s.auditLog.docId, id));

describe('POST /api/documents with Cursus\'s token: a record of the personnel file', () => {
  it('files it in force at once, without circuit, owned by Cursus, its category setting confidentiality and retention', async () => {
    const res = await deposit(META);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 'DPE-RHU-0001', revision: 'A', status: 'in_force', file: true });
    const [d] = await db().select().from(s.documents);
    expect(d).toMatchObject({
      typeCode: 'DPE', department: 'RHU', ownerId: 'cursus', conf: 'confidentiel', subtype: 'Attestation de formation', subjectMatricule: 'EMP-0042',
      legacyRef: REF, status: 'in_force', revInForce: 'A', revWorking: null, retentionYears: 5, retentionTrigger: 'employee_departure', retentionOverride: false,
    });
    expect(await db().select().from(s.workflows)).toEqual([]);
    expect((await journal(d.id)).map((e) => [e.userId, e.action, e.detail])).toEqual([['cursus', 'upload', `A · ${REF}`]]);
    expect(readdirSync(FILES_DIR).map((f) => f.replace(/^[0-9a-f-]{36}-/, ''))).toEqual(['DPE-RHU-0001_A.pdf']);
  });

  it('takes a highly confidential category with its own retention, and a date of end Cursus computes', async () => {
    const res = await deposit({ ...META, sourceRef: 'cursus:piece/77', category: 'expense_health', expiresAt: '2036-12-31', title: 'Justificatif de note de frais — EMP-0042 — 2026-11' });
    expect(res.status).toBe(201);
    const [d] = await db().select().from(s.documents);
    expect(d).toMatchObject({ conf: 'tres_confidentiel', retentionYears: 0, retentionTrigger: 'expiry', retentionOverride: true, expiresAt: '2036-12-31' });
  });

  it('refuses what Codex sets itself, and needs a category, a matricule, the file and its SHA-256', async () => {
    const bad = await deposit({ ...META, ownerId: 'owner', conf: 'tres_confidentiel', department: 'QUA', subtype: 'x', category: 'nope', subjectMatricule: 'emp42' });
    expect(bad.status).toBe(400);
    expect(codes(bad.body)).toEqual(expect.arrayContaining(['ownerId:record_owner', 'subtype:record_field', 'category:invalid_value', 'department:record_department', 'subjectMatricule:invalid_matricule']));
    const rest: Record<string, unknown> = { ...META };
    delete rest.sha256;
    expect((await deposit(rest)).body.issues[0]).toMatchObject({ field: 'sha256', code: 'required' });
    expect(codes((await deposit(META, CURSUS, null)).body)).toContain('sha256:file_required');
    expect(codes((await deposit({ ...META, category: undefined, subjectMatricule: undefined })).body)).toEqual(expect.arrayContaining(['category:category_required', 'subjectMatricule:required']));
    expect(codes((await deposit({ ...META, sourceRef: 'arche:x/1' })).body)).toContain('sourceRef:source_ref_app');
    expect(codes((await deposit({ ...META, typeCode: 'PRO' })).body)).toContain('typeCode:record_type_required');
    expect(await db().select().from(s.documents)).toEqual([]);
  });

  it('keeps records and Cursus\'s prefix away from the other applications\' token', async () => {
    const other = await deposit({ ...META, title: 'x', typeCode: 'PRO', department: 'QUA', ownerId: 'owner', conf: 'interne', category: undefined, subjectMatricule: undefined }, DOCS);
    expect(codes(other.body)).toContain('sourceRef:source_ref_app');
    const record = await deposit({ sourceRef: 'arche:x/2', title: 'x', typeCode: 'DPE', department: 'RHU', ownerId: 'owner', conf: 'confidentiel', subjectMatricule: 'EMP-0042' }, DOCS);
    expect(codes(record.body)).toEqual(expect.arrayContaining(['typeCode:record_type_app', 'subjectMatricule:record_only']));
  });

  it('is replayable by its source reference, and checks Cursus\'s signature when its secret is set', async () => {
    const first = await deposit(META);
    const again = await deposit(META);
    expect(again).toEqual({ status: 200, body: { id: first.body.id, href: first.body.href, replayed: true } });
    vi.stubEnv('CODEX_CURSUS_SECRET', CURSUS_SECRET);
    expect((await deposit({ ...META, sourceRef: 'cursus:piece/2' })).body).toMatchObject({ error: 'unauthorized', reason: 'signature_missing' });
    expect((await deposit({ ...META, sourceRef: 'cursus:piece/2' }, CURSUS, PDF, CURSUS_SECRET)).status).toBe(201);
  });
});

describe('GET /api/documents/{id}/file with Cursus\'s token', () => {
  it('serves the file exactly as filed, with its fingerprint, and journals the read', async () => {
    const { body } = await deposit(META);
    const res = await readFile(body.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-codex-sha256')).toBe(sha(PDF));
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PDF);
    expect((await journal(body.id)).map((e) => [e.userId, e.action, e.detail])).toContainEqual(['cursus', 'download', `A · ${REF}`]);
    const head = await FILE_HEAD(new Request(`http://codex.test/api/documents/${body.id}/file`, { method: 'HEAD', headers: { Authorization: `Bearer ${CURSUS}` } }), { params: Promise.resolve({ id: body.id }) });
    expect(head.status).toBe(200);
  });

  it('refuses a wrong token, and answers 404 for a document not filed by Cursus', async () => {
    const { body } = await deposit(META);
    expect((await readFile(body.id, { Authorization: 'Bearer wrong-token-of-thirty-two-characters' })).status).toBe(401);
    expect((await readFile(body.id, { Authorization: `Bearer ${DOCS}` })).status).toBe(401);
    const arche = await DEPOSIT(new Request('http://codex.test/api/documents', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DOCS}` },
      body: JSON.stringify({ sourceRef: 'arche:x/9', title: 'x', typeCode: 'PRO', department: 'QUA', ownerId: 'owner', conf: 'interne' }),
    }));
    expect((await readFile((await arche.json()).id)).status).toBe(404);
  });

  it('is signed over the method and the path when Cursus\'s secret is set', async () => {
    const { body } = await deposit(META);
    vi.stubEnv('CODEX_CURSUS_SECRET', CURSUS_SECRET);
    expect((await readFile(body.id)).status).toBe(401);
    const signed = signRequest(CURSUS_SECRET, routeSigned('GET', `/api/documents/${body.id}/file`));
    expect((await readFile(body.id, { Authorization: `Bearer ${CURSUS}`, ...signed })).status).toBe(200);
  });
});

describe('POST /api/documents/{id}/destroy', () => {
  it('destroys the record, its revisions, versions and file, keeping a trace without content', async () => {
    const { body } = await deposit(META);
    expect((await destroy(body.id, { reason: 'oops' })).status).toBe(400);
    const res = await destroy(body.id, { reason: 'retrait' });
    expect(res).toMatchObject({ status: 200, body: { id: body.id, destroyed: true, reason: 'retrait' } });
    expect(await db().select().from(s.documents)).toEqual([]);
    expect(await db().select().from(s.revisions)).toEqual([]);
    expect(await db().select().from(s.workingVersions)).toEqual([]);
    expect(readdirSync(FILES_DIR)).toEqual([]);
    const [trace] = await db().select().from(s.destroyedDocuments);
    expect(trace).toMatchObject({ id: body.id, typeCode: 'DPE', subtype: 'Attestation de formation', sourceRef: REF, app: 'cursus', reason: 'retrait', filedAt: '2026-11-26' });
    expect((await journal(body.id)).map((e) => [e.action, e.detail])).toEqual([['upload', `A · ${REF}`], ['destroy', `retrait · ${REF}`]]);
    // Sent again: the trace; the same reference filed again: 410; its file: gone.
    expect((await destroy(body.id, { reason: 'retrait' })).body).toMatchObject({ destroyed: true, alreadyDestroyed: true });
    expect(await deposit(META)).toEqual({ status: 410, body: { error: 'destroyed', id: body.id } });
    expect((await readFile(body.id)).status).toBe(404);
  });

  it('is refused under legal hold, and for a document Cursus did not file', async () => {
    const { body } = await deposit({ ...META, legalHold: true });
    expect(await destroy(body.id, { reason: 'conservation' })).toEqual({ status: 409, body: { error: 'legal_hold', id: body.id } });
    expect((await destroy('PRO-QUA-0001', { reason: 'effacement' })).status).toBe(404);
    expect((await destroy(body.id, { reason: 'retrait' }, { Authorization: `Bearer ${DOCS}` })).status).toBe(401);
    expect(await db().select().from(s.documents)).toHaveLength(1);
  });
});

describe('highly confidential records: read by the HR readers only (D-32)', () => {
  const viewer = (id: string, seesAll = false): Viewer => ({
    user: { id, name: id, initials: 'XX', role: 'collaborateur', title: null, department: 'RHU', site: null, isSystem: false, matricule: null, clavisPersonId: null },
    seesAll, can: (p) => p === 'read',
  });
  it('hides them from records managers and the HR department, shows them to the holders of the HR readers\' function', async () => {
    await deposit({ ...META, category: 'absence', title: 'Justificatif d’absence — EMP-0042 — 2026-11' });
    await deposit({ ...META, sourceRef: 'cursus:piece/2' });
    const readable = async (v: Viewer) => (await db().select({ id: s.documents.id }).from(s.documents).where(sql`${readableSql(v)}`).orderBy(s.documents.id)).map((r) => r.id);
    expect(await readable(viewer('manager', true))).toEqual(['DPE-RHU-0002']);
    expect(await readable(viewer('owner'))).toEqual(['DPE-RHU-0002']);
    expect(await readable(viewer('writer2'))).toEqual(['DPE-RHU-0001', 'DPE-RHU-0002']);
  });
});
