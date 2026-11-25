import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/client-errors/route';
import { resetRateLimits } from '@/lib/ratelimit';
import { fixClock, setupDb } from '../support/db';
import { actAs } from '../support/session';

// POST /api/client-errors (lib/client-errors.ts, point 49 of docs/reste-a-faire.md): an error of the browser, written to
// the technical log under the reference its error screen shows; nothing but the report's five fields, cut.

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

setupDb();
fixClock();

let logs: Record<string, unknown>[] = [];
beforeEach(() => {
  resetRateLimits();
  logs = [];
  vi.stubEnv('CODEX_LOG_FORMAT', 'json');
  for (const level of ['info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation((l: unknown) => void logs.push(JSON.parse(String(l))));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const send = (body: string) => POST(new Request('http://codex.test/api/client-errors', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } }));
const REPORT = { ref: 'nav-0123456789abcdef', name: 'TypeError', message: 'x is undefined', path: '/documents/PRO-QUA-0001?q=secret', frames: ['at f (http://codex.test/a.js:1:2)'], cookie: 'never' };

describe('POST /api/client-errors', () => {
  it('writes the report to the technical log under its reference, and answers 204', async () => {
    actAs('owner');
    const res = await send(JSON.stringify(REPORT));
    expect(res.status).toBe(204);
    const entry = logs.find((l) => l.scope === 'client');
    expect(entry).toMatchObject({ level: 'warn', msg: 'browser error', ref: REPORT.ref, user: 'owner', path: '/documents/PRO-QUA-0001' });
    expect(JSON.stringify(entry)).not.toContain('secret');
    expect(JSON.stringify(entry)).not.toContain('never');
  });

  it('400 for what is not a report, 413 beyond 8 kB; nothing logged under `client`', async () => {
    actAs('owner');
    expect((await send('not json')).status).toBe(400);
    expect((await send(JSON.stringify({ ...REPORT, ref: 'made-up' }))).status).toBe(400);
    expect((await send(JSON.stringify({ ...REPORT, message: 'm'.repeat(9000) }))).status).toBe(413);
    expect(logs.filter((l) => l.scope === 'client')).toEqual([]);
  });

  it('beyond CODEX_RATE_CLIENT_ERRORS, 429 and nothing more logged', async () => {
    vi.stubEnv('CODEX_RATE_CLIENT_ERRORS', '1/1m');
    actAs('owner');
    expect((await send(JSON.stringify(REPORT))).status).toBe(204);
    expect((await send(JSON.stringify(REPORT))).status).toBe(429);
    expect(logs.filter((l) => l.scope === 'client').length).toBe(1);
  });
});
