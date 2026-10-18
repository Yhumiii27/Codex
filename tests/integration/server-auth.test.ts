import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as importPOST } from '@/app/api/import/route';
import { POST as vigiePOST } from '@/app/api/integrations/vigie/route';
import { GET as registryGET } from '@/app/api/registry/route';
import { schema as s } from '@/db';
import { resetRateLimits } from '@/lib/ratelimit';
import { signRequest } from '@/lib/server-auth';
import { submitChange } from '@/lib/vigie';
import { addDoc, fixClock, getChange, setClock, setupDb } from '../support/db';

// Authentication between servers through the real route handlers (point 23 of docs/reste-a-faire.md; contract:
// docs/api.md, « Authentification ») : HMAC signature of the Vigie webhook and of the import, with a window and a
// replay check; two values accepted during a rotation; the registry open by default, closed by CODEX_REGISTRY_TOKEN.

// The signed multipart import stores its file for real: in a throwaway FILES_DIR, never in .data/ (absent in the CI).
vi.mock('@/db', async (importOriginal) => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { ...(await importOriginal<typeof import('@/db')>()), FILES_DIR: mkdtempSync(join(tmpdir(), 'codex-server-auth-')), getDb: async () => (await import('../support/db')).currentDb() };
});

const db = setupDb();
fixClock('2026-10-18T08:00:00Z');

const TOKEN = 'T0ken-0f-th1rty-tw0-v4r1ed-ch4racters';
const NEXT_TOKEN = 'N3xt-t0ken-0f-th1rty-tw0-v4r1ed-chars';
const SECRET = 'S3cret-0f-th1rty-tw0-v4r1ed-ch4racters';
const NEXT_SECRET = 'N3xt-s3cret-0f-th1rty-tw0-v4r1ed-char';
const BASE = 'http://codex.test';
const ID = 'PRO-QUA-0001';

let warnings: Record<string, unknown>[] = [];
beforeEach(() => {
  resetRateLimits();
  warnings = [];
  vi.stubEnv('CODEX_LOG_FORMAT', 'json');
  vi.spyOn(console, 'warn').mockImplementation((l: unknown) => void warnings.push(JSON.parse(String(l))));
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const ask = () => db().transaction((tx) => submitChange(tx, { kind: 'modification', docId: ID, requesterId: 'writer', reason: 'r', description: '' }));

/** A decision sent to the webhook, raw body `body`, with these headers. */
async function vigie(body: string, headers: Record<string, string>) {
  const res = await vigiePOST(new Request(`${BASE}/api/integrations/vigie`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('POST /api/integrations/vigie, signed', () => {
  beforeEach(() => vi.stubEnv('VIGIE_WEBHOOK_SECRET', SECRET));

  it('applies a decision signed with the secret, without a token when none is set', async () => {
    await addDoc(db(), { id: ID });
    const requestId = await ask();
    const body = JSON.stringify({ requestId, accepted: false });
    expect(await vigie(body, signRequest(SECRET, body))).toMatchObject({ status: 200, body: { status: 'rejected' } });
    expect((await getChange(db(), requestId)).status).toBe('rejected');
  });

  it('refuses the same signed request sent again (replay), then accepts it signed anew', async () => {
    await addDoc(db(), { id: ID });
    const requestId = await ask();
    const body = JSON.stringify({ requestId, accepted: false });
    const signed = signRequest(SECRET, body);
    expect((await vigie(body, signed)).status).toBe(200);
    expect(await vigie(body, signed)).toEqual({ status: 401, body: { error: 'unauthorized', reason: 'signature_replayed' } });
    setClock('2026-10-18T08:00:01Z');
    expect(await vigie(body, signRequest(SECRET, body))).toMatchObject({ status: 200, body: { alreadyApplied: true } });
  });

  it('refuses, and changes nothing for, a signature that is missing, wrong, expired or over another body', async () => {
    await addDoc(db(), { id: ID });
    const requestId = await ask();
    const body = JSON.stringify({ requestId, accepted: true });
    const refused = (reason: string) => ({ status: 401, body: { error: 'unauthorized', reason } });
    expect(await vigie(body, {})).toEqual(refused('signature_missing'));
    expect(await vigie(body, signRequest('An0ther-s3cret-0f-th1rty-tw0-chars!!', body))).toEqual(refused('signature_invalid'));
    expect(await vigie(body, signRequest(SECRET, body, Date.now() - 301_000))).toEqual(refused('signature_expired'));
    expect(await vigie(body, signRequest(SECRET, JSON.stringify({ requestId, accepted: false })))).toEqual(refused('signature_invalid'));
    expect((await getChange(db(), requestId)).status).toBe('submitted');
    // Each refusal in the technical log, without the signature sent.
    expect(warnings.map((w) => w.reason)).toEqual(['signature_missing', 'signature_invalid', 'signature_expired', 'signature_invalid']);
    expect(warnings[0]).toMatchObject({ scope: 'auth', variable: 'VIGIE_WEBHOOK_SECRET', status: 401 });
    expect(JSON.stringify(warnings)).not.toContain(SECRET);
  });

  it('accepts the secret of a rotation (_NEXT) beside the current one', async () => {
    vi.stubEnv('VIGIE_WEBHOOK_SECRET_NEXT', NEXT_SECRET);
    await addDoc(db(), { id: ID });
    const requestId = await ask();
    const body = JSON.stringify({ requestId, accepted: false });
    expect((await vigie(body, signRequest(NEXT_SECRET, body))).status).toBe(200);
  });

  it('requires both the token and the signature when both are set', async () => {
    vi.stubEnv('VIGIE_WEBHOOK_TOKEN', TOKEN);
    await addDoc(db(), { id: ID });
    const requestId = await ask();
    const body = JSON.stringify({ requestId, accepted: false });
    expect((await vigie(body, signRequest(SECRET, body))).status).toBe(401);
    expect(await vigie(body, { Authorization: `Bearer ${TOKEN}` })).toMatchObject({ status: 401, body: { reason: 'signature_missing' } });
    expect((await vigie(body, { Authorization: `Bearer ${TOKEN}`, ...signRequest(SECRET, body) })).status).toBe(200);
  });
});

describe('POST /api/integrations/vigie, token only', () => {
  it('stays as before with a token alone, and accepts the token of a rotation', async () => {
    vi.stubEnv('VIGIE_WEBHOOK_TOKEN', TOKEN);
    vi.stubEnv('VIGIE_WEBHOOK_TOKEN_NEXT', NEXT_TOKEN);
    await addDoc(db(), { id: ID });
    const requestId = await ask();
    const body = JSON.stringify({ requestId, accepted: false });
    expect((await vigie(body, { Authorization: `Bearer ${NEXT_TOKEN}` })).status).toBe(200);
    expect((await vigie(body, { Authorization: `Bearer ${TOKEN}` })).status).toBe(200);
    expect((await vigie(body, { Authorization: 'Bearer wrong' })).status).toBe(401);
  });

  it('is disabled (503) with neither token nor secret', async () => {
    expect((await vigie('{}', {})).status).toBe(503);
  });
});

describe('POST /api/import, signed', () => {
  const META = { legacyRef: 'GED1/RL/1', title: 'Procédure', typeCode: 'PRO', department: 'QUA', ownerId: 'owner', revision: 'A', inForceAt: '2026-01-05' };
  const send = (body: string | FormData, headers: Record<string, string>) => importPOST(new Request(`${BASE}/api/import`, { method: 'POST', headers, body }));

  it('imports a JSON body signed with CODEX_IMPORT_SECRET, and refuses the same body unsigned', async () => {
    vi.stubEnv('CODEX_IMPORT_SECRET', SECRET);
    const body = JSON.stringify(META);
    expect((await send(body, { 'Content-Type': 'application/json' })).status).toBe(401);
    expect(await db().select().from(s.documents)).toHaveLength(0);
    const res = await send(body, { 'Content-Type': 'application/json', ...signRequest(SECRET, body) });
    expect(res.status).toBe(201);
    expect(await db().select().from(s.documents)).toHaveLength(1);
  });

  it('checks the signature over the raw multipart body, file included', async () => {
    vi.stubEnv('CODEX_IMPORT_SECRET', SECRET);
    const fd = new FormData();
    fd.set('meta', JSON.stringify(META));
    fd.set('file', new Blob(['%PDF-1.4 contenu'], { type: 'application/pdf' }), 'procedure.pdf');
    // The raw bytes the client sends, with their boundary.
    const framed = new Request(`${BASE}/x`, { method: 'POST', body: fd });
    const ctype = framed.headers.get('content-type')!;
    const raw = new Uint8Array(await framed.arrayBuffer());
    const altered = raw.slice();
    altered[altered.length - 60] ^= 1;
    const post = (bytes: Uint8Array, signedOver: Uint8Array) =>
      importPOST(new Request(`${BASE}/api/import`, { method: 'POST', headers: { 'Content-Type': ctype, ...signRequest(SECRET, signedOver) }, body: bytes.slice().buffer }));
    expect((await post(altered, raw)).status).toBe(401);
    const res = await post(raw, raw);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ file: true });
  });
});

describe('GET /api/registry', () => {
  const get = (headers: Record<string, string> = {}) => registryGET(new Request(`${BASE}/api/registry`, { headers }));

  it('is open by default, cacheable by any cache, as Keystone reads it today', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, must-revalidate');
  });

  it('asks for CODEX_REGISTRY_TOKEN (or its _NEXT) once set, revalidation included, and is then kept by no shared cache', async () => {
    vi.stubEnv('CODEX_REGISTRY_TOKEN', TOKEN);
    vi.stubEnv('CODEX_REGISTRY_TOKEN_NEXT', NEXT_TOKEN);
    const open = await get();
    expect(open.status).toBe(401);
    expect(open.headers.get('www-authenticate')).toBe('Bearer realm="codex"');
    const res = await get({ Authorization: `Bearer ${TOKEN}` });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=60, must-revalidate');
    expect((await get({ Authorization: `Bearer ${NEXT_TOKEN}` })).status).toBe(200);
    expect((await get({ 'If-None-Match': res.headers.get('etag')! })).status).toBe(401);
    expect((await get({ Authorization: `Bearer ${TOKEN}`, 'If-None-Match': res.headers.get('etag')! })).status).toBe(304);
  });
});
