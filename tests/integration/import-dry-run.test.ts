import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/import/route';
import { FILES_DIR, schema as s } from '@/db';
import { nextDocId } from '@/lib/codification';
import { resetRateLimits } from '@/lib/ratelimit';
import { signRequest } from '@/lib/server-auth';
import { EICAR, fakeClamd, type FakeClamd } from '../support/clamd';
import { addDoc, fixClock, setClock, setupDb } from '../support/db';

// Simulation of an import (POST /api/import?dryRun=1, docs/api.md « Simulation ») : the same checks as the import —
// token, signature, body, file (format, size, virus scan), metadata, ID — and the same answers when it refuses, but
// 200 {dryRun, id, warnings} instead of 201, with nothing stored: no file in the store (a throwaway FILES_DIR, never
// .data/), no row in any table (the transaction is rolled back, as lib/transfer.ts simulates a transfer), nothing in the
// audit trail, an infected file included. The ID given is the one the import then gets, while nothing changes between.

vi.mock('@/db', async (importOriginal) => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { ...(await importOriginal<typeof import('@/db')>()), FILES_DIR: mkdtempSync(join(tmpdir(), 'codex-dry-run-')), getDb: async () => (await import('../support/db')).currentDb() };
});

const db = setupDb();
fixClock('2026-10-18T08:00:00Z');

const TOKEN = 'T0ken-0f-th1rty-tw0-v4r1ed-ch4racters';
const SECRET = 'S3cret-0f-th1rty-tw0-v4r1ed-ch4racters';
let clamd: FakeClamd;
let logs: Record<string, unknown>[] = [];

beforeAll(async () => {
  clamd = await fakeClamd();
});
beforeEach(() => {
  resetRateLimits();
  logs = [];
  vi.stubEnv('CODEX_IMPORT_TOKEN', TOKEN);
  vi.stubEnv('CODEX_IMPORT_SECRET', '');
  vi.stubEnv('CODEX_STORAGE', 'local');
  vi.stubEnv('CODEX_LOG_FORMAT', 'json');
  for (const level of ['info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation((l: unknown) => void logs.push(JSON.parse(String(l))));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  clamd.mode = 'normal';
  for (const f of readdirSync(FILES_DIR)) rmSync(path.join(FILES_DIR, f), { force: true });
});
afterAll(async () => {
  await clamd.close();
  rmSync(FILES_DIR, { recursive: true, force: true });
});

const META = { legacyRef: 'GED1/Q/12', title: 'Procédure reprise', typeCode: 'PRO', department: 'QUA', ownerId: 'owner', revision: 'C', inForceAt: '2025-03-12' };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

type Body = { meta: unknown; file?: { name: string; type?: string; bytes: Buffer | string } } | { raw: string; type: string };

/** The request as the migration tool sends it: JSON alone, or multipart with the metadata and the file. */
function request(body: Body, query = '', headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}` }, sign?: string): Request {
  let bytes: Buffer;
  let type: string;
  if ('raw' in body) {
    bytes = Buffer.from(body.raw);
    type = body.type;
  } else if (!body.file) {
    bytes = Buffer.from(JSON.stringify(body.meta));
    type = 'application/json';
  } else {
    const b = 'codex-dry-run-boundary';
    const f = body.file;
    bytes = Buffer.concat([
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n${JSON.stringify(body.meta)}\r\n`),
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${f.name}"\r\n${f.type ? `Content-Type: ${f.type}\r\n` : ''}\r\n`),
      Buffer.from(f.bytes),
      Buffer.from(`\r\n--${b}--\r\n`),
    ]);
    type = `multipart/form-data; boundary=${b}`;
  }
  const signed = sign ? signRequest(sign, new Uint8Array(bytes)) : {};
  return new Request(`http://codex.test/api/import${query}`, { method: 'POST', headers: { 'Content-Type': type, ...headers, ...signed }, body: new Uint8Array(bytes) });
}

async function send(body: Body, query = '', headers?: Record<string, string>, sign?: string) {
  const res = await POST(request(body, query, headers, sign));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, retryAfter: res.headers.get('retry-after') };
}
const simulate = (body: Body, headers?: Record<string, string>, sign?: string) => send(body, '?dryRun=1', headers, sign);
const real = (body: Body, headers?: Record<string, string>, sign?: string) => send(body, '', headers, sign);

/** Every row of every table of the database, table by table: what a simulation must leave as it found it. */
async function snapshot(): Promise<Record<string, string>> {
  const tables = await db().execute<{ table_name: string }>(sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`);
  const out: Record<string, string> = {};
  for (const { table_name: t } of tables.rows) {
    const [row] = (await db().execute<{ n: string; digest: string | null }>(sql`select count(*)::text as n, md5(string_agg(x::text, '|' order by x::text)) as digest from ${sql.identifier(t)} x`)).rows;
    out[t] = `${row.n}:${row.digest ?? ''}`;
  }
  return out;
}
const stored = () => readdirSync(FILES_DIR);

describe('POST /api/import?dryRun=1: what it answers', () => {
  it('answers 200 with the ID and the warnings, stores no file and writes no row; the import then gets that ID', async () => {
    const body = { meta: { ...META, subtype: 'Sous-type inconnu', keywords: ['Reprise'], externalRef: 'X-1' }, file: { name: 'procedure.pdf', type: 'application/pdf', bytes: PDF } };
    const before = await snapshot();
    const sim = await simulate(body);
    expect(sim.status).toBe(200);
    expect(sim.body).toEqual({ dryRun: true, id: 'PRO-QUA-0001', warnings: expect.any(Array) });
    expect(sim.body.warnings.map((w: { field: string; code: string }) => `${w.field}:${w.code}`).sort()).toEqual(['externalRef:ignored', 'keywords:term_added', 'subtype:subtype_unlisted']);
    expect(stored()).toEqual([]);
    expect(await snapshot()).toEqual(before);
    // Said in the technical log, never in the audit trail.
    expect(logs).toContainEqual(expect.objectContaining({ scope: 'import', msg: 'import simulated (dry run), nothing written', ref: 'GED1/Q/12', result: 'PRO-QUA-0001' }));

    const imp = await real(body);
    expect(imp.status).toBe(201);
    expect(imp.body).toMatchObject({ id: sim.body.id, file: true, warnings: sim.body.warnings });
    expect(stored()).toHaveLength(1);
  });

  it('gives as ID a legacy reference already in Codex format, as the import does, and a draft without file too', async () => {
    const inFormat = { meta: { ...META, legacyRef: 'PRO-QUA-0042' } };
    expect((await simulate(inFormat)).body).toEqual({ dryRun: true, id: 'PRO-QUA-0042', warnings: [] });
    const draft = { meta: { ...META, legacyRef: 'GED1/Q/13', status: 'draft', inForceAt: undefined } };
    expect((await simulate(draft)).body).toEqual({ dryRun: true, id: 'PRO-QUA-0001', warnings: [] });
    expect(await db().select().from(s.documents)).toEqual([]);
    // The counter of PRO-QUA was not raised past 42 by the simulation: the draft still gets 0001.
    expect((await real(draft)).body).toMatchObject({ id: 'PRO-QUA-0001', status: 'draft', version: null });
    expect((await real(inFormat)).body).toMatchObject({ id: 'PRO-QUA-0042', status: 'in_force' });
  });

  it('warns of a file identical to a file in force, as the import does', async () => {
    const file = { name: 'procedure.pdf', type: 'application/pdf', bytes: PDF };
    expect((await real({ meta: META, file })).status).toBe(201);
    const sim = await simulate({ meta: { ...META, legacyRef: 'GED1/Q/99' }, file });
    expect(sim.body).toMatchObject({ dryRun: true, id: 'PRO-QUA-0002', warnings: [{ field: 'file', code: 'duplicate_file' }] });
    expect(stored()).toHaveLength(1);
  });

  // The ID is not reserved: whatever draws a number in between (a document created in Codex, another import) takes it.
  it('predicts an ID that a document created in between may take: the import then gets the next one', async () => {
    expect((await simulate({ meta: META })).body.id).toBe('PRO-QUA-0001');
    await db().transaction(async (tx) => addDoc(tx as never, { id: await nextDocId(tx, { typeCode: 'PRO', attachment: 'none', department: 'QUA' }) }));
    expect((await real({ meta: META })).body).toMatchObject({ id: 'PRO-QUA-0002' });
  });
});

describe('POST /api/import?dryRun=1: the same refusals as the import', () => {
  it('answers what the import answers, and writes nothing either way', async () => {
    vi.stubEnv('CODEX_MAX_FILE_MB', String(1 / 1024)); // 1 KB
    const cases: [string, Body, Record<string, string>?][] = [
      ['sans jeton', { meta: META }, {}],
      ['jeton faux', { meta: META }, { Authorization: 'Bearer nope' }],
      ['JSON illisible', { raw: '{', type: 'application/json' }],
      ['type de contenu', { raw: 'x', type: 'text/plain' }],
      ['métadonnées invalides', { meta: { ...META, typeCode: 'PID', conf: 'public', department: 'XXX' } }],
      ['format refusé', { meta: META, file: { name: 'outil.exe', bytes: Buffer.from('MZ') } }],
      ['contenu qui n’est pas l’extension', { meta: META, file: { name: 'rapport.pdf', type: 'application/pdf', bytes: 'pas un PDF' } }],
      ['fichier trop gros', { meta: META, file: { name: 'gros.pdf', type: 'application/pdf', bytes: Buffer.concat([PDF, Buffer.alloc(2048, 0x20)]) } }],
    ];
    const before = await snapshot();
    for (const [what, body, headers] of cases) {
      const sim = await simulate(body, headers);
      expect(sim.status, what).not.toBe(200);
      expect(sim, what).toEqual(await real(body, headers));
    }
    expect(stored()).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it('answers 409 for a legacy reference already imported, or one that is a Codex ID', async () => {
    expect((await real({ meta: META })).status).toBe(201);
    expect(await simulate({ meta: META })).toMatchObject({ status: 409, body: { error: 'duplicate', id: 'PRO-QUA-0001' } });
    expect(await simulate({ meta: { ...META, legacyRef: 'PRO-QUA-0001' } })).toMatchObject({ status: 409, body: { error: 'ref_is_codex_id', id: 'PRO-QUA-0001' } });
  });

  it('refuses an infected file with 422 without journaling it; the import journals it', async () => {
    vi.stubEnv('CODEX_CLAMD', clamd.address);
    const body = { meta: META, file: { name: 'note.txt', type: 'text/plain', bytes: EICAR } };
    const before = await snapshot();
    expect(await simulate(body)).toMatchObject({ status: 422, body: { error: 'file_infected', threat: 'Eicar-Test-Signature' } });
    expect(await snapshot()).toEqual(before);
    expect(logs).toContainEqual(expect.objectContaining({ scope: 'storage', msg: 'infected file refused, not journaled (dry run)', ref: 'GED1/Q/12', threat: 'Eicar-Test-Signature' }));
    expect(await real(body)).toMatchObject({ status: 422 });
    expect(await db().select({ action: s.auditLog.action }).from(s.auditLog)).toEqual([{ action: 'file_rejected' }]);
    expect(stored()).toEqual([]);
  });

  it('answers 503 when the virus scan cannot be run, as the import does', async () => {
    vi.stubEnv('CODEX_CLAMD', clamd.address);
    clamd.mode = 'error';
    const body = { meta: META, file: { name: 'procedure.pdf', type: 'application/pdf', bytes: PDF } };
    expect(await simulate(body)).toEqual({ status: 503, body: { error: 'scan_unavailable' }, retryAfter: '60' });
    expect(await real(body)).toEqual({ status: 503, body: { error: 'scan_unavailable' }, retryAfter: '60' });
  });

  it('checks the signature as the import does; a signed simulation is remembered against replays, nothing else', async () => {
    vi.stubEnv('CODEX_IMPORT_TOKEN', '');
    vi.stubEnv('CODEX_IMPORT_SECRET', SECRET);
    expect(await simulate({ meta: META }, {})).toMatchObject({ status: 401, body: { error: 'unauthorized', reason: 'signature_missing' } });
    const before = await snapshot();
    expect((await simulate({ meta: META }, {}, SECRET)).body).toEqual({ dryRun: true, id: 'PRO-QUA-0001', warnings: [] });
    const after = await snapshot();
    expect(Object.keys(after).filter((k) => after[k] !== before[k])).toEqual(['integration_signatures']);
    // The signature covers the timestamp and the body, not the query string: the same signed request sent again without
    // ?dryRun=1 is a replay, refused; an import is signed anew.
    expect(await real({ meta: META }, {}, SECRET)).toMatchObject({ status: 401, body: { reason: 'signature_replayed' } });
    setClock('2026-10-18T08:00:01Z');
    expect((await real({ meta: META }, {}, SECRET)).status).toBe(201);
  });
});

describe('POST /api/import: the query string', () => {
  it('imports for real with dryRun=0 or without it, and refuses any other parameter or value before reading the body', async () => {
    for (const q of ['?dryrun=1', '?dry_run=1', '?dryRun=yes', '?dryRun=1&dryRun=1', '?dryRun=1&x=2']) {
      const res = await send({ meta: META }, q);
      expect(res.status, q).toBe(400);
      expect(res.body.error, q).toBe('invalid_query');
    }
    expect(await db().select().from(s.documents)).toEqual([]);
    expect((await send({ meta: META }, '?dryRun=true')).status).toBe(200);
    expect((await send({ meta: META }, '?dryRun=0')).status).toBe(201);
    expect((await send({ meta: { ...META, legacyRef: 'GED1/Q/2' } }, '?dryRun=false')).status).toBe(201);
    // Unauthenticated, the token is refused first: the query says nothing to whoever lacks it.
    expect((await send({ meta: META }, '?dryrun=1', {})).status).toBe(401);
  });
});
