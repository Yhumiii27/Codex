import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as approvalGET } from '@/app/api/documents/[id]/approval/route';
import { GET as fileGET, HEAD as fileHEAD } from '@/app/api/documents/[id]/file/route';
import { GET as auditExport, HEAD as auditExportHEAD } from '@/app/api/export/audit/route';
import { GET as searchExport, HEAD as searchExportHEAD } from '@/app/api/export/search/route';
import { POST as importPOST } from '@/app/api/import/route';
import { POST as vigiePOST } from '@/app/api/integrations/vigie/route';
import { GET as registryGET } from '@/app/api/registry/route';
import { schema as s } from '@/db';
import * as actions from '@/lib/actions';
import { saveSearch } from '@/lib/actions';
import { COOKIE_LANG } from '@/lib/context';
import { DICT } from '@/lib/i18n';
import { limitWrite } from '@/lib/ratelimit';
import { addDoc, fixClock, setClock, setupDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs, cookieStore } from '../support/session';

// Rate limiting through the real route handlers and Server Actions (src/lib/ratelimit.ts, point 24 of
// docs/reste-a-faire.md): beyond its budget, a client gets 429 with Retry-After and the request does nothing (no
// import, no file read, no export journaled, no write). Budgets are set low through the environment.

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock('2026-10-15T08:00:00Z');

const TOKEN = 'test-token';
beforeEach(() => {
  vi.stubEnv('CODEX_IMPORT_TOKEN', TOKEN);
  vi.stubEnv('VIGIE_WEBHOOK_TOKEN', TOKEN);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const BASE = 'http://codex.test';
const api = (path: string, ip: string, init: RequestInit & { token?: string } = {}) => {
  const { token = TOKEN, ...rest } = init;
  return new Request(`${BASE}${path}`, { method: 'POST', ...rest, headers: { 'x-forwarded-for': ip, 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...rest.headers } });
};
const META = { legacyRef: 'GED1/RL/1', title: 'Procédure', typeCode: 'PRO', department: 'QUA', ownerId: 'owner', revision: 'A', inForceAt: '2026-01-05' };

async function expect429(res: Response) {
  expect(res.status).toBe(429);
  const wait = Number(res.headers.get('retry-after'));
  expect(wait).toBeGreaterThan(0);
  return wait;
}

describe('integration endpoints, per client address', () => {
  it('POST /api/import: beyond CODEX_RATE_IMPORT, 429 in JSON and nothing imported; another address goes on', async () => {
    vi.stubEnv('CODEX_RATE_IMPORT', '2/1m');
    const send = (ip: string, ref: string) => importPOST(api('/api/import', ip, { body: JSON.stringify({ ...META, legacyRef: ref }) }));
    expect((await send('10.0.0.1', 'GED1/RL/1')).status).toBe(201);
    expect((await send('10.0.0.1', 'GED1/RL/2')).status).toBe(201);
    const refused = await send('10.0.0.1', 'GED1/RL/3');
    const wait = await expect429(refused);
    expect(wait).toBe(30);
    expect(await refused.json()).toEqual({ error: 'rate_limited', retryAfter: 30 });
    expect((await db().select().from(s.documents)).length).toBe(2);
    expect((await send('10.0.0.2', 'GED1/RL/3')).status).toBe(201);
    // 30 s later, one more import is allowed.
    setClock('2026-10-15T08:00:30Z');
    expect((await send('10.0.0.1', 'GED1/RL/4')).status).toBe(201);
  });

  it('refused tokens: beyond CODEX_RATE_TOKEN_FAILURES, wrong tokens get 429; without a trusted proxy the right one always goes through', async () => {
    vi.stubEnv('CODEX_RATE_TOKEN_FAILURES', '3/15m');
    const send = (ip: string, token: string, ref = 'GED1/RL/1') => importPOST(api('/api/import', ip, { token, body: JSON.stringify({ ...META, legacyRef: ref }) }));
    for (let i = 0; i < 3; i++) expect((await send('10.0.0.1', `guess-${i}`)).status).toBe(401);
    const refused = await send('10.0.0.1', 'guess-3');
    expect(await expect429(refused)).toBe(300);
    expect(await refused.json()).toEqual({ error: 'rate_limited', retryAfter: 300 });
    // The webhook shares the budget of refused tokens.
    expect((await vigiePOST(api('/api/integrations/vigie', '10.0.0.1', { token: 'nope', body: '{}' }))).status).toBe(429);
    // X-Forwarded-For may have been written by the client: it must not hold back the holder of the right token.
    expect((await send('10.0.0.1', TOKEN)).status).toBe(201);
    expect((await vigiePOST(api('/api/integrations/vigie', '10.0.0.1', { body: JSON.stringify({ requestId: 'ECR-X', accepted: true }) }))).status).toBe(404);
  });

  it('a forged address does not block the right token sent over another connection (CODEX_RATE_TOKEN_FAILURES at its default)', async () => {
    // A third party, without the token, sends wrong ones under the address the server itself gives the real client.
    for (let i = 0; i < 25; i++) await vigiePOST(api('/api/integrations/vigie', '127.0.0.1', { token: `wrong-${i}`, body: '{}' }));
    expect((await vigiePOST(api('/api/integrations/vigie', '127.0.0.1', { token: 'wrong', body: '{}' }))).status).toBe(429);
    // The real client, from that address, with the right token: its decision is read.
    expect((await vigiePOST(api('/api/integrations/vigie', '127.0.0.1', { body: JSON.stringify({ requestId: 'ECR-X', accepted: true }) }))).status).toBe(404);
    expect((await importPOST(api('/api/import', '127.0.0.1', { body: JSON.stringify(META) }))).status).toBe(201);
  });

  it('behind a trusted proxy (CODEX_TRUST_PROXY), an address out of tries waits even with the right token, which is not compared', async () => {
    vi.stubEnv('CODEX_TRUST_PROXY', '1');
    vi.stubEnv('CODEX_RATE_TOKEN_FAILURES', '3/15m');
    const send = (ip: string, token: string) => importPOST(api('/api/import', ip, { token, body: JSON.stringify(META) }));
    for (let i = 0; i < 3; i++) expect((await send('10.0.0.1', `guess-${i}`)).status).toBe(401);
    expect(await expect429(await send('10.0.0.1', TOKEN))).toBe(300);
    expect((await vigiePOST(api('/api/integrations/vigie', '10.0.0.1', { body: '{}' }))).status).toBe(429);
    // Another address is not held back.
    expect((await send('10.0.0.2', TOKEN)).status).toBe(201);
    // One refused token is forgotten every 5 minutes.
    setClock('2026-10-15T08:05:00Z');
    expect((await send('10.0.0.1', TOKEN)).status).toBe(409);
  });

  it('requests without the right token do not spend the import and Vigie budgets of the one holding it', async () => {
    vi.stubEnv('CODEX_RATE_IMPORT', '1/1m');
    vi.stubEnv('CODEX_RATE_VIGIE', '1/1m');
    for (let i = 0; i < 5; i++) {
      expect((await importPOST(api('/api/import', '10.0.0.1', { token: 'wrong', body: JSON.stringify(META) }))).status).toBe(401);
      expect((await vigiePOST(api('/api/integrations/vigie', '10.0.0.1', { token: 'wrong', body: '{}' }))).status).toBe(401);
    }
    expect((await importPOST(api('/api/import', '10.0.0.1', { body: JSON.stringify(META) }))).status).toBe(201);
    expect((await vigiePOST(api('/api/integrations/vigie', '10.0.0.1', { body: JSON.stringify({ requestId: 'ECR-X', accepted: true }) }))).status).toBe(404);
    await expect429(await importPOST(api('/api/import', '10.0.0.1', { body: JSON.stringify({ ...META, legacyRef: 'GED1/RL/2' }) })));
  });

  it('POST /api/import: a body sent in chunks beyond the size allowed is cut off with 413', async () => {
    vi.stubEnv('CODEX_MAX_FILE_MB', '0.001');
    let sent = 0;
    const chunk = new Uint8Array(64 * 1024).fill(0x20);
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        // 64 MB if read to the end; the route stops after a little more than 1 MB.
        if (sent >= 1024) return c.close();
        sent++;
        c.enqueue(chunk);
      },
    });
    const res = await importPOST(new Request(`${BASE}/api/import`, { method: 'POST', body, duplex: 'half', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } } as RequestInit));
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(40);
  });

  it('POST /api/import: a multipart body sent in chunks beyond the size allowed is cut off early with 413, nothing imported', async () => {
    vi.stubEnv('CODEX_MAX_FILE_MB', '0.001');
    const enc = new TextEncoder();
    const head = enc.encode([
      '--b0undary', 'Content-Disposition: form-data; name="meta"', '', JSON.stringify(META),
      '--b0undary', 'Content-Disposition: form-data; name="file"; filename="plan.pdf"', 'Content-Type: application/pdf', '', '',
    ].join('\r\n'));
    const chunk = new Uint8Array(64 * 1024).fill(0x25);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        // 64 MB of file if read to the end, never closed by a boundary: the route must stop on its own.
        if (sent === 0) c.enqueue(head);
        else if (sent > 1024) return c.close();
        else c.enqueue(chunk);
        sent++;
      },
    });
    const res = await importPOST(new Request(`${BASE}/api/import`, {
      method: 'POST', body, duplex: 'half', headers: { 'Content-Type': 'multipart/form-data; boundary=b0undary', Authorization: `Bearer ${TOKEN}` },
    } as RequestInit));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: 'too_large' });
    expect(sent).toBeLessThan(40);
    expect((await db().select().from(s.documents)).length).toBe(0);
  });

  it('POST /api/integrations/vigie and GET /api/registry: their own budgets (the registry’s behind a trusted proxy only)', async () => {
    vi.stubEnv('CODEX_RATE_VIGIE', '1/1m');
    vi.stubEnv('CODEX_RATE_REGISTRY', '1/1m');
    expect((await vigiePOST(api('/api/integrations/vigie', '10.0.0.1', { body: JSON.stringify({ requestId: 'ECR-X', accepted: true }) }))).status).toBe(404);
    expect(await expect429(await vigiePOST(api('/api/integrations/vigie', '10.0.0.1', { body: JSON.stringify({ requestId: 'ECR-X', accepted: true }) })))).toBe(60);
    const registry = () => registryGET(new Request(`${BASE}/api/registry`, { headers: { 'x-forwarded-for': '10.0.0.1' } }));
    // Without a trusted proxy the address may be forged: no one could spend Keystone's budget, so there is none.
    for (let i = 0; i < 3; i++) expect((await registry()).status).toBe(200);
    vi.stubEnv('CODEX_TRUST_PROXY', '1');
    expect((await registry()).status).toBe(200);
    const refused = await registry();
    await expect429(refused);
    expect(await refused.json()).toMatchObject({ error: 'rate_limited' });
  });
});

describe('browser endpoints, per user as resolved from the session', () => {
  const ID = 'PRO-QUA-0001';
  const browser = (path: string, method = 'GET', ip = '10.0.0.1') => new Request(`${BASE}${path}`, { method, headers: { 'x-forwarded-for': ip } });
  /** The session of the next requests: the cookie codex-user (any value, as a client may send) and the language. */
  const as = async (who: string, lang: 'fr' | 'en' = 'fr') => {
    actAs(who as Person);
    (await cookieStore()).set(COOKIE_LANG, lang);
  };
  const params = { params: Promise.resolve({ id: ID }) };
  const journaled = async (action: 'download' | 'export') => (await db().select().from(s.auditLog).where(eq(s.auditLog.action, action))).map((a) => a.userId);

  it('file and approval record: one budget (CODEX_RATE_FILES); 429 in the reader’s language, HEAD included', async () => {
    await addDoc(db(), { id: ID });
    vi.stubEnv('CODEX_RATE_FILES', '3/1m');
    await as('auditor');
    const file = `/api/documents/${ID}/file`;
    expect((await fileGET(browser(file), params)).status).toBe(200);
    expect((await fileHEAD(browser(file, 'HEAD'), params)).status).toBe(200);
    // Revision A was never approved through a circuit here: no record, but the request counts.
    expect((await approvalGET(browser(`/api/documents/${ID}/approval?rev=Z`), params)).status).toBe(404);
    const refused = await fileGET(browser(`${file}?download=1`), params);
    await expect429(refused);
    expect(await refused.text()).toBe(DICT.fr.rate_limited.replace('{n}', '20'));
    await as('auditor', 'en');
    expect(await expect429(await fileHEAD(browser(file, 'HEAD'), params))).toBe(20);
    expect(await approvalGET(browser(`/api/documents/${ID}/approval?rev=A`), params).then((r) => r.text())).toBe(DICT.en.rate_limited.replace('{n}', '20'));
    // From another address, still the same user's budget.
    await expect429(await fileGET(browser(file, 'GET', '10.0.0.2'), params));
    // The refused download is not journaled; another user from the same address has their own budget.
    expect(await journaled('download')).toEqual([]);
    await as('owner');
    expect((await fileGET(browser(`${file}?download=1`), params)).status).toBe(200);
    expect(await journaled('download')).toEqual(['owner']);
  });

  it('CSV exports (CODEX_RATE_EXPORTS): a refused export runs no search and journals nothing, HEAD included', async () => {
    vi.stubEnv('CODEX_RATE_EXPORTS', '1/1m');
    await as('manager');
    expect((await searchExport(browser('/api/export/search'))).status).toBe(200);
    expect(await journaled('export')).toEqual(['manager']);
    await expect429(await searchExport(browser('/api/export/search')));
    await expect429(await searchExportHEAD(browser('/api/export/search', 'HEAD')));
    await expect429(await auditExport(browser('/api/export/audit')));
    await expect429(await auditExportHEAD(browser('/api/export/audit', 'HEAD')));
    expect(await journaled('export')).toEqual(['manager']);
  });

  it('invented user cookies from one address are the default user: one budget, not one each', async () => {
    await addDoc(db(), { id: ID });
    vi.stubEnv('CODEX_RATE_EXPORTS', '2/1m');
    vi.stubEnv('CODEX_RATE_FILES', '2/1m');
    const exports: number[] = [];
    const files: number[] = [];
    for (let i = 0; i < 6; i++) {
      await as(`z${i}`);
      exports.push((await searchExport(browser('/api/export/search'))).status);
      files.push((await fileGET(browser(`/api/documents/${ID}/file`), params)).status);
    }
    expect(exports).toEqual([200, 200, 429, 429, 429, 429]);
    expect(files).toEqual([200, 200, 429, 429, 429, 429]);
    const who = await journaled('export');
    expect(who).toHaveLength(2);
    expect(new Set(who).size).toBe(1);
  });

  it('behind a trusted proxy (CODEX_TRUST_PROXY), an address also caps every user it carries', async () => {
    vi.stubEnv('CODEX_RATE_EXPORTS', '2/1m');
    const exportAs = async (who: Person, ip: string) => {
      await as(who);
      return (await searchExport(browser('/api/export/search', 'GET', ip))).status;
    };
    // Without one, the address may be forged: it holds back no one.
    expect([await exportAs('manager', '10.0.0.1'), await exportAs('owner', '10.0.0.1'), await exportAs('writer', '10.0.0.1')]).toEqual([200, 200, 200]);
    vi.stubEnv('CODEX_TRUST_PROXY', '1');
    expect([await exportAs('head', '10.0.0.5'), await exportAs('quality', '10.0.0.5'), await exportAs('auditor', '10.0.0.5')]).toEqual([200, 200, 429]);
    expect(await exportAs('auditor', '10.0.0.6')).toBe(200);
  });
});

describe('Server Actions that write (CODEX_RATE_WRITES), per simulated user', () => {
  it('beyond the budget, the action is refused with the wait to show, and writes nothing', async () => {
    vi.stubEnv('CODEX_RATE_WRITES', '2/1m');
    const save = (who: 'writer' | 'owner', label: string) => {
      actAs(who);
      return saveSearch(label, { q: '', facets: { type: ['PRO'] } }, 'personal', null);
    };
    expect(await save('writer', 'Une')).toMatchObject({ ok: true });
    expect(await save('writer', 'Deux')).toMatchObject({ ok: true });
    expect(await save('writer', 'Trois')).toEqual({ ok: false, error: DICT.fr.rate_limited.replace('{n}', '30') });
    expect((await db().select().from(s.savedSearches)).map((x) => x.label).sort()).toEqual(['Deux', 'Une']);
    expect(await save('owner', 'Trois')).toMatchObject({ ok: true });
  });

  it('every action that writes counts against the budget, before any check of its own', async () => {
    // The exports of lib/actions.ts that write: all of them but the language and the simulated user, which only set
    // cookies. A new action must be added here, and so must its call to throttled().
    const WRITES = [
      'createDocument', 'addWorkingVersion', 'updateMeta', 'setReaders', 'recordReview', 'requestValidation', 'decideStep',
      'recallValidation', 'delegateStep', 'addComment', 'requestChange', 'simulateVigieDecision', 'graftChange', 'addDocLink',
      'removeDocLink', 'archiveDocuments', 'holdDocuments', 'releaseHold', 'restoreArchived', 'saveSearch', 'deleteSavedSearch',
      'togglePermission', 'addOrgValue', 'setDepartmentFeatured', 'addFunctionHolder', 'removeFunctionHolder', 'updateType',
      'purgeOrphanFiles',
    ];
    const all = actions as unknown as Record<string, unknown>;
    const exported = Object.keys(all).filter((k) => typeof all[k] === 'function');
    expect(exported.filter((k) => k !== 'setLang' && k !== 'simulateUser').sort()).toEqual([...WRITES].sort());
    vi.stubEnv('CODEX_RATE_WRITES', '1/1h');
    actAs('manager');
    expect(limitWrite('manager')).toBe(0);
    const refused = { ok: false, error: DICT.fr.rate_limited.replace('{n}', '3600') };
    // Placeholder arguments: the budget is checked before they are read.
    for (const name of WRITES) expect(await (all[name] as (...args: unknown[]) => Promise<unknown>)(), name).toEqual(refused);
    // The two that only set cookies stay free.
    expect(await actions.simulateUser('owner', 'collaborateur')).toMatchObject({ ok: true });
  });

  it('CODEX_RATE_LIMIT=off lifts every limit', async () => {
    vi.stubEnv('CODEX_RATE_WRITES', '1/1m');
    vi.stubEnv('CODEX_RATE_LIMIT', 'off');
    actAs('writer');
    for (let i = 0; i < 5; i++) expect(await saveSearch(`R${i}`, { q: '', facets: { type: ['PRO'] } }, 'personal', null)).toMatchObject({ ok: true });
  });
});
