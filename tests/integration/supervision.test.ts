import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as healthGET, HEAD as healthHEAD } from '@/app/api/health/route';
import { POST as importPOST } from '@/app/api/import/route';
import { POST as vigiePOST } from '@/app/api/integrations/vigie/route';
import { GET as registryGET } from '@/app/api/registry/route';
import { FILES_DIR } from '@/db';
import { inspect } from 'node:util';
import * as actions from '@/lib/actions';
import { addComment, decideStep, requestValidation, saveSearch } from '@/lib/actions';
import { limitWrite, resetRateLimits } from '@/lib/ratelimit';
import { probeStore, resetStores } from '@/lib/storage';
import { addDoc, baseOf, setupDb } from '../support/db';
import { actAs } from '../support/session';

// Supervision (point 49 of docs/reste-a-faire.md): GET /api/health answers 200 or 503 from the database and the active
// store, without saying why; the technical log (lib/log.ts) has one line per API request and per Server Action, with
// the request's identifier, and a line for each refused integration token, never the token.

const state = vi.hoisted(() => ({ dbDown: false }));
vi.mock('@/db', async (importOriginal) => {
  const { mkdtempSync: mk } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return {
    ...(await importOriginal<typeof import('@/db')>()),
    FILES_DIR: mk(join(tmpdir(), 'codex-health-')),
    getDb: async () => {
      if (state.dbDown) throw Object.assign(new Error('could not open /secret/path/pglite'), { code: 'EACCES' });
      return (await import('../support/db')).currentDb();
    },
  };
});
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();

afterAll(() => rmSync(FILES_DIR, { recursive: true, force: true }));

/** The JSON lines written to the console while the test runs. */
let lines: { level: string; entry: Record<string, unknown> }[] = [];
beforeEach(() => {
  lines = [];
  resetRateLimits();
  vi.stubEnv('CODEX_LOG_FORMAT', 'json');
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((l: unknown) => void lines.push({ level, entry: JSON.parse(String(l)) }));
  }
});
afterEach(() => {
  state.dbDown = false;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const req = (p: string, init: RequestInit = {}) => new Request(`http://codex.test${p}`, init);
const version = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).version;

describe('GET /api/health', () => {
  it('answers 200 with the version and each check, not cached, and logs nothing above debug', async () => {
    const res = await healthGET(req('/api/health'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-request-id')).toBeTruthy();
    const body = await res.json();
    expect(body).toMatchObject({ status: 'ok', version, checks: { database: { ok: true }, storage: { ok: true } } });
    expect(Object.keys(body).sort()).toEqual(['checks', 'status', 'time', 'version']);
    // Nothing of where the data lives.
    expect(JSON.stringify(body)).not.toContain(FILES_DIR);
    expect(lines.filter((l) => l.level !== 'debug')).toEqual([]);
  });

  it('answers 503 when the database cannot be reached, says which check failed, and logs why', async () => {
    state.dbDown = true;
    const res = await healthGET(req('/api/health'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'fail', checks: { database: { ok: false }, storage: { ok: true } } });
    expect(JSON.stringify(body)).not.toMatch(/secret|EACCES|pglite/);
    const failed = lines.find((l) => l.entry.msg === 'database check failed')!;
    expect(failed.entry).toMatchObject({ scope: 'health', err: { code: 'EACCES' }, requestId: res.headers.get('x-request-id') });
    expect(lines.find((l) => l.entry.msg === 'request')).toMatchObject({ level: 'error', entry: { route: '/api/health', status: 503 } });
  });

  it('answers 503 when the file store cannot be used', async () => {
    rmSync(FILES_DIR, { recursive: true, force: true });
    writeFileSync(FILES_DIR, 'not a folder');
    try {
      const res = await healthGET(req('/api/health'));
      expect(res.status).toBe(503);
      expect((await res.json()).checks).toMatchObject({ database: { ok: true }, storage: { ok: false } });
    } finally {
      rmSync(FILES_DIR, { force: true });
      mkdirSync(FILES_DIR);
    }
  });

  it('HEAD answers the same status, without a body', async () => {
    expect((await healthHEAD(req('/api/health', { method: 'HEAD' }))).status).toBe(200);
    state.dbDown = true;
    const res = await healthHEAD(req('/api/health', { method: 'HEAD' }));
    expect([res.status, await res.text()]).toEqual([503, '']);
  });
});

describe('SharePoint store check', () => {
  beforeEach(() => {
    resetStores();
    vi.stubEnv('CODEX_STORAGE', 'sharepoint');
    for (const [k, v] of Object.entries({ CODEX_SP_TENANT_ID: 't', CODEX_SP_CLIENT_ID: 'c', CODEX_SP_CLIENT_SECRET: 's', CODEX_SP_DRIVE_ID: 'b!d' })) vi.stubEnv(k, v);
  });
  afterAll(resetStores);

  it('asks Graph for the drive, and holds the answer a minute', async () => {
    const drive = { status: 200 };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('login.microsoftonline.com')) return Response.json({ access_token: 'at', expires_in: 3600 });
      return new Response(null, { status: drive.status });
    });
    const driveCalls = () => fetchSpy.mock.calls.filter(([u]) => String(u).includes('/drives/b!d?')).length;
    const t0 = 1_900_000_000_000;
    expect(await probeStore(t0)).toEqual({ store: 'sharepoint', cached: false });
    expect(await probeStore(t0 + 30_000)).toEqual({ store: 'sharepoint', cached: true });
    expect(driveCalls()).toBe(1);
    drive.status = 401;
    await expect(probeStore(t0 + 61_000)).rejects.toThrow('SharePoint drive: 401');
    // The token refused: asked again once, refused again (tests/integration/sharepoint-store.test.ts).
    expect(driveCalls()).toBe(3);
    // Failed: said again within the minute without asking Graph.
    await expect(probeStore(t0 + 62_000)).rejects.toThrow();
    expect(driveCalls()).toBe(3);
  });

  it('makes one call to Entra ID and one to Graph for checks asked at once, success or failure', async () => {
    const calls = { login: 0, drive: 0 };
    const drive = { status: 200 };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const login = String(input).includes('login.microsoftonline.com');
      calls[login ? 'login' : 'drive'] += 1;
      await new Promise((r) => setTimeout(r, 30));
      return login ? Response.json({ access_token: 'at', expires_in: 3600 }) : new Response(null, { status: drive.status });
    });
    const t0 = 1_950_000_000_000;
    const burst = await Promise.all(Array.from({ length: 50 }, () => probeStore(t0)));
    expect(calls).toEqual({ login: 1, drive: 1 });
    expect(burst.filter((r) => !r.cached)).toHaveLength(1);
    // The minute over, a burst while the library fails: one call, every check told it failed.
    drive.status = 503;
    const failed = await Promise.allSettled(Array.from({ length: 20 }, () => probeStore(t0 + 61_000)));
    expect(failed.every((r) => r.status === 'rejected')).toBe(true);
    expect(calls).toEqual({ login: 1, drive: 2 });
  });
});

describe('the technical log of the API', () => {
  it('logs each request with its route, status, duration and identifier, sent back to the client', async () => {
    const res = await registryGET(req('/api/registry', { headers: { 'x-request-id': 'keystone-42' } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBe('keystone-42');
    const [line] = lines;
    expect(line).toMatchObject({ level: 'info', entry: { scope: 'http', msg: 'request', requestId: 'keystone-42', method: 'GET', route: '/api/registry', status: 200 } });
    expect(line.entry.durationMs).toEqual(expect.any(Number));
  });

  it('logs a refused integration token with the route, the address and why, never the token', async () => {
    vi.stubEnv('CODEX_IMPORT_TOKEN', 'the-right-token-0123456789abcdefghij');
    const send = (auth?: string) => importPOST(req('/api/import', {
      method: 'POST', headers: { 'x-forwarded-for': '10.1.2.3', 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) }, body: '{}',
    }));
    expect((await send('Bearer guess-0001')).status).toBe(401);
    vi.stubEnv('CODEX_TRUST_PROXY', '1');
    expect((await send()).status).toBe(401);
    const refused = lines.filter((l) => l.entry.msg === 'integration token refused').map((l) => [l.level, l.entry.route, l.entry.client, l.entry.forwardedFor, l.entry.reason, l.entry.status]);
    expect(refused).toEqual([
      // Without a trusted proxy, X-Forwarded-For may be the client's own writing: not given as its address.
      ['warn', '/api/import', undefined, '10.1.2.3', 'invalid', 401],
      ['warn', '/api/import', '10.1.2.3', undefined, 'missing', 401],
    ]);
    expect(lines.filter((l) => l.entry.msg === 'integration token refused')[0].entry.clientTrusted).toBe(false);
    const text = JSON.stringify(lines);
    expect(text).not.toMatch(/guess-000|the-right-token/);
  });

  it('logs a call to a disabled endpoint as information, not as an error', async () => {
    // No VIGIE_WEBHOOK_TOKEN nor CODEX_IMPORT_TOKEN: the default, which any client may ask for at will.
    for (const call of [
      () => vigiePOST(req('/api/integrations/vigie', { method: 'POST', headers: { Authorization: 'Bearer guess-0002' }, body: '{}' })),
      () => importPOST(req('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })),
    ]) {
      const res = await call();
      expect([res.status, await res.json()]).toEqual([503, { error: 'disabled' }]);
    }
    expect(lines.map((l) => [l.level, l.entry.scope, l.entry.reason ?? l.entry.status])).toEqual([
      ['info', 'auth', 'disabled'], ['info', 'http', 503], ['info', 'auth', 'disabled'], ['info', 'http', 503],
    ]);
  });

  it('logs every request of every API route, with its pattern and the identifier sent back', async () => {
    // Every route.ts under src/app/api, every method it exports: a route added without withRequestLog fails here.
    const root = path.join(process.cwd(), 'src/app/api');
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) => path.basename(f) === 'route.ts').sort();
    expect(files.length).toBeGreaterThanOrEqual(8);
    vi.stubEnv('CODEX_LOG_LEVEL', 'debug'); // the health route logs a success at debug level
    actAs('writer');
    for (const file of files) {
      const pattern = `/api/${path.dirname(file).split(path.sep).join('/')}`;
      const mod = (await import(path.join(root, file))) as Record<string, unknown>;
      const methods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].filter((m) => typeof mod[m] === 'function');
      expect(methods.length, pattern).toBeGreaterThan(0);
      for (const method of methods) {
        lines = [];
        const url = pattern.replace('[id]', 'PRO-QUA-0404');
        const handler = mod[method] as (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
        const res = await handler(req(url, { method, headers: { 'x-request-id': `all-${method}` } }), { params: Promise.resolve({ id: 'PRO-QUA-0404' }) });
        expect(res.headers.get('x-request-id'), `${method} ${pattern}`).toBe(`all-${method}`);
        const http = lines.filter((l) => l.entry.scope === 'http');
        expect(http.map((l) => [l.entry.method, l.entry.route, l.entry.status, l.entry.requestId]), `${method} ${pattern}`).toEqual([[method, pattern, res.status, `all-${method}`]]);
      }
    }
  });

  it('answers an internal error of the integration endpoints with the request\'s identifier, which finds its cause', async () => {
    vi.stubEnv('CODEX_IMPORT_TOKEN', 'the-right-token-0123456789abcdefghij');
    vi.stubEnv('VIGIE_WEBHOOK_TOKEN', 'the-vigie-token-0123456789abcdefghij');
    state.dbDown = true;
    const meta = { legacyRef: 'OLD-1', title: 'Titre confidentiel', typeCode: 'PRO', department: 'QUA', ownerId: 'owner' };
    for (const [route, call] of [
      ['import', () => importPOST(req('/api/import', { method: 'POST', headers: { Authorization: 'Bearer the-right-token-0123456789abcdefghij', 'Content-Type': 'application/json' }, body: JSON.stringify(meta) }))],
      ['vigie', () => vigiePOST(req('/api/integrations/vigie', { method: 'POST', headers: { Authorization: 'Bearer the-vigie-token-0123456789abcdefghij' }, body: JSON.stringify({ requestId: 'ECR-2026-001', accepted: false }) }))],
    ] as const) {
      lines = [];
      const res = await call();
      const body = await res.json();
      expect([res.status, body], route).toEqual([500, { error: 'internal', requestId: res.headers.get('x-request-id') }]);
      const cause = lines.find((l) => l.level === 'error' && l.entry.scope === route)!;
      expect(cause.entry, route).toMatchObject({ requestId: body.requestId, err: { code: 'EACCES' } });
      expect(lines.find((l) => l.entry.scope === 'http')).toMatchObject({ level: 'error', entry: { status: 500, requestId: body.requestId } });
    }
  });
});

describe('the technical log of the Server Actions', () => {
  it('logs each write action with its outcome and duration, not what it was given', async () => {
    actAs('manager');
    expect((await saveSearch('Mes procédures confidentielles', { q: 'projet secret' }, 'personal', null)).ok).toBe(true);
    actAs('writer');
    expect((await addComment('WF-0000-404', 'commentaire privé')).ok).toBe(false);
    const actions = lines.filter((l) => l.entry.scope === 'action').map((l) => [l.level, l.entry.action, l.entry.outcome]);
    expect(actions).toEqual([['info', 'saveSearch', 'ok'], ['info', 'addComment', 'refused']]);
    expect(lines.every((l) => typeof l.entry.requestId === 'string')).toBe(true);
    expect(JSON.stringify(lines)).not.toMatch(/secret|privé|confidentielles/);
  });

  it('logs a write whose query fails without any value it was given, and hands Next.js the error without them', async () => {
    // A confidential document in its circuit: head holds step 1. PostgreSQL refuses the NUL character in a text.
    await addDoc(db(), { id: 'PRO-QUA-0001', conf: 'confidentiel', revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'draft', modifierId: 'writer', changeRef: 'ECO-2026-010', versions: ['writer'] }] });
    actAs('writer');
    expect(await requestValidation('PRO-QUA-0001', null, await baseOf(db(), 'PRO-QUA-0001'))).toMatchObject({ ok: true });
    lines = [];
    actAs('head');
    const comment = await addComment('W-1', 'Rachat confidentiel de ACME prévu le 3 mars\u0000').catch((e: unknown) => e);
    const reason = await decideStep('W-1', false, 1, 'Motif confidentiel : licenciement de Dupont\u0000').catch((e: unknown) => e);
    const failed = lines.filter((l) => l.entry.msg === 'action failed');
    expect(failed.map((l) => [l.level, l.entry.action])).toEqual([['error', 'addComment'], ['error', 'decideStep']]);
    expect(failed[0].entry.err).toMatchObject({ message: expect.stringMatching(/^Failed query: insert into "workflow_comments"/), cause: { code: '22P05' } });
    expect(JSON.stringify(lines)).not.toMatch(/Rachat|ACME|licenciement|Dupont|params/);
    // What Next.js prints of the error thrown (util.inspect: own properties and causes).
    for (const thrown of [comment, reason]) {
      expect(thrown).toBeInstanceOf(Error);
      expect(inspect(thrown, { depth: 5 })).not.toMatch(/Rachat|ACME|licenciement|Dupont/);
    }
  });

  it('logs every action that writes under its own name', async () => {
    // Every export of lib/actions.ts but the two that only set cookies: an action added without traceAction fails here.
    const all = actions as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const writes = Object.keys(all).filter((k) => typeof all[k] === 'function' && k !== 'setLang' && k !== 'simulateUser');
    expect(writes.length).toBeGreaterThanOrEqual(29);
    // Refused by the write budget before any argument is read: one call each, without arguments.
    vi.stubEnv('CODEX_RATE_WRITES', '1/1h');
    actAs('manager');
    expect(limitWrite('manager')).toBe(0);
    for (const name of writes) {
      lines = [];
      await all[name]();
      const traced = lines.filter((l) => l.entry.scope === 'action' && l.entry.msg === 'action');
      expect(traced.map((l) => [l.entry.action, l.entry.outcome]), name).toEqual([[name, 'refused']]);
      expect(typeof traced[0].entry.requestId, name).toBe('string');
    }
  });

  it('logs a write refused by the rate limit with the user, at warn level', async () => {
    vi.stubEnv('CODEX_RATE_WRITES', '1/1m');
    actAs('writer');
    await addComment('WF-0000-404', 'a');
    await addComment('WF-0000-404', 'b');
    expect(lines.find((l) => l.entry.msg === 'write rate limited')).toMatchObject({ level: 'warn', entry: { user: 'writer', retryAfter: expect.any(Number) } });
  });
});
