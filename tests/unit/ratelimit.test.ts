import { afterEach, describe, expect, it, vi } from 'vitest';
import { DICT } from '@/lib/i18n';
import { clientAddress, countTokenFailure, limitReader, limitRequest, limitWrite, MAX_KEYS, parseRule, RATE_LIMITS, ruleFor, take, tokenFailuresExceeded, trustProxy, waitFor } from '@/lib/ratelimit';

// The in-memory rate limiter (src/lib/ratelimit.ts, point 24 of docs/reste-a-faire.md): token buckets per family and
// key, rules from the environment, client keys. Counters are emptied before each test (tests/support/setup.ts).

const T0 = Date.parse('2026-10-15T08:00:00Z');
const perMinute = (limit: number) => ({ limit, windowMs: 60_000 });

describe('parseRule', () => {
  it('reads a number per minute, or a number per duration', () => {
    expect(parseRule('600')).toEqual({ limit: 600, windowMs: 60_000 });
    expect(parseRule('600/1m')).toEqual({ limit: 600, windowMs: 60_000 });
    expect(parseRule(' 20 / 15m ')).toEqual({ limit: 20, windowMs: 900_000 });
    expect(parseRule('5/30s')).toEqual({ limit: 5, windowMs: 30_000 });
    expect(parseRule('1000/h')).toEqual({ limit: 1000, windowMs: 3_600_000 });
    expect(parseRule('2/1H')).toEqual({ limit: 2, windowMs: 3_600_000 });
  });

  it('reads 0 or off as no limit, and anything else as invalid', () => {
    expect(parseRule('0')).toBeNull();
    expect(parseRule('OFF')).toBeNull();
    expect(parseRule('0/1m')).toBeNull();
    for (const bad of [undefined, '', ' ', '-1', '1.5', 'ten', '10/0m', '10/1d', '10/']) expect(parseRule(bad), String(bad)).toBeUndefined();
  });
});

describe('ruleFor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('takes the default of each family, generous for local use', () => {
    expect(ruleFor('import', {})).toEqual({ limit: 600, windowMs: 60_000 });
    expect(ruleFor('vigie', {})).toEqual({ limit: 600, windowMs: 60_000 });
    expect(ruleFor('tokens', {})).toEqual({ limit: 20, windowMs: 900_000 });
    expect(ruleFor('registry', {})).toEqual({ limit: 300, windowMs: 60_000 });
    expect(ruleFor('files', {})).toEqual({ limit: 600, windowMs: 60_000 });
    expect(ruleFor('exports', {})).toEqual({ limit: 30, windowMs: 60_000 });
    expect(ruleFor('writes', {})).toEqual({ limit: 120, windowMs: 60_000 });
  });

  it('follows its variable, and CODEX_RATE_LIMIT=off turns every limit off', () => {
    expect(ruleFor('exports', { CODEX_RATE_EXPORTS: '5/10s' })).toEqual({ limit: 5, windowMs: 10_000 });
    expect(ruleFor('exports', { CODEX_RATE_EXPORTS: '0' })).toBeNull();
    for (const family of Object.keys(RATE_LIMITS) as (keyof typeof RATE_LIMITS)[]) {
      expect(ruleFor(family, { CODEX_RATE_LIMIT: 'off', [RATE_LIMITS[family].env]: '1' }), family).toBeNull();
    }
    expect(ruleFor('files', { CODEX_RATE_LIMIT: 'on' })).toEqual({ limit: 600, windowMs: 60_000 });
  });

  it('keeps the default, with a warning, when the variable is not a limit', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(ruleFor('writes', { CODEX_RATE_WRITES: 'beaucoup' })).toEqual({ limit: 120, windowMs: 60_000 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('CODEX_RATE_WRITES'));
  });
});

describe('take', () => {
  it('lets a key send its limit at once, then refuses with the seconds until a request is regained', () => {
    const rule = perMinute(3);
    expect([take('files', 'a', rule, T0), take('files', 'a', rule, T0), take('files', 'a', rule, T0)]).toEqual([0, 0, 0]);
    // One request back every 20 s.
    expect(take('files', 'a', rule, T0)).toBe(20);
    expect(take('files', 'a', rule, T0 + 15_000)).toBe(5);
    expect(take('files', 'a', rule, T0 + 20_000)).toBe(0);
    expect(take('files', 'a', rule, T0 + 20_000)).toBe(20);
  });

  it('never refills beyond the limit, and does not count a refused request', () => {
    const rule = perMinute(2);
    expect(take('exports', 'k', rule, T0)).toBe(0);
    // An hour of silence is still worth two requests only.
    const later = T0 + 3_600_000;
    expect([take('exports', 'k', rule, later), take('exports', 'k', rule, later), take('exports', 'k', rule, later)]).toEqual([0, 0, 30]);
    // Hammering while refused does not push the wait further.
    for (let i = 0; i < 10; i++) expect(take('exports', 'k', rule, later)).toBe(30);
    expect(take('exports', 'k', rule, later + 30_000)).toBe(0);
  });

  it('counts each family and each key on its own', () => {
    const rule = perMinute(1);
    expect(take('files', 'a', rule, T0)).toBe(0);
    expect(take('files', 'a', rule, T0)).toBeGreaterThan(0);
    expect(take('files', 'b', rule, T0)).toBe(0);
    expect(take('exports', 'a', rule, T0)).toBe(0);
  });

  it('waitFor tells the wait without counting a request', () => {
    const rule = perMinute(1);
    expect(waitFor('tokens', 'x', rule, T0)).toBe(0);
    expect(waitFor('tokens', 'x', rule, T0)).toBe(0);
    take('tokens', 'x', rule, T0);
    expect(waitFor('tokens', 'x', rule, T0)).toBe(60);
    expect(waitFor('tokens', 'x', rule, T0 + 59_500)).toBe(1);
    expect(waitFor('tokens', 'x', rule, T0 + 60_000)).toBe(0);
  });

  it('beyond MAX_KEYS keys, forgets only buckets full again, and refuses a new key while none is', () => {
    const rule = perMinute(2);
    // A bucket in deficit (one request left), the oldest of all.
    take('files', 'penalised', rule, T0);
    for (let i = 0; i < MAX_KEYS - 1; i++) take('files', `k${i}`, rule, T0);
    // Every bucket is still in deficit: the newcomer waits until one is full again (30 s), none is forgotten.
    expect(take('files', 'newcomer', rule, T0)).toBe(30);
    expect(waitFor('files', 'newcomer', rule, T0)).toBe(0);
    take('files', 'penalised', rule, T0);
    expect(take('files', 'penalised', rule, T0), 'still remembered').toBe(30);
    // 30 s later, the other buckets are full again and make room; the penalised one is not (one request regained).
    expect(take('files', 'newcomer', rule, T0 + 30_000)).toBe(0);
    expect(take('files', 'penalised', rule, T0 + 30_000)).toBe(0);
    expect(take('files', 'penalised', rule, T0 + 30_000)).toBe(30);
  });

  it('keeps the keys of each family apart: filling one does not make another forget a refused token', () => {
    const tokens = { limit: 3, windowMs: 900_000 };
    for (let i = 0; i < 3; i++) take('tokens', '10.0.0.1', tokens, T0);
    expect(waitFor('tokens', '10.0.0.1', tokens, T0)).toBe(300);
    const files = perMinute(600);
    for (let i = 0; i < MAX_KEYS; i++) take('files', `user:u${i}`, files, T0);
    expect(take('files', 'user:one-too-many', files, T0), 'files is full').toBeGreaterThan(0);
    expect(waitFor('tokens', '10.0.0.1', tokens, T0)).toBe(300);
    // The other families still take new keys.
    expect(take('tokens', '10.0.0.2', tokens, T0)).toBe(0);
    expect(take('exports', 'user:u0', files, T0)).toBe(0);
  });
});

describe('keys', () => {
  it('the client address is the last X-Forwarded-For entry', () => {
    expect(clientAddress(new Headers({ 'x-forwarded-for': '10.0.0.7' }))).toBe('10.0.0.7');
    expect(clientAddress(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.7 ,' }))).toBe('10.0.0.7');
    expect(clientAddress(new Headers())).toBe('unknown');
  });

  it('the proxy is trusted only when CODEX_TRUST_PROXY says so', () => {
    expect(trustProxy({})).toBe(false);
    expect(trustProxy({ CODEX_TRUST_PROXY: '0' })).toBe(false);
    expect(trustProxy({ CODEX_TRUST_PROXY: '1' })).toBe(true);
    expect(trustProxy({ CODEX_TRUST_PROXY: 'on' })).toBe(true);
  });
});

describe('limitRequest', () => {
  const req = (path: string, headers: Record<string, string> = {}) => new Request(`http://codex.test${path}`, { headers });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('answers an integration endpoint with a JSON 429 and Retry-After, per client address', async () => {
    vi.stubEnv('CODEX_RATE_IMPORT', '2/1m');
    const from = (ip: string) => req('/api/import', { 'x-forwarded-for': ip });
    expect(limitRequest(from('10.0.0.1'), 'import')).toBeNull();
    expect(limitRequest(from('10.0.0.1'), 'import')).toBeNull();
    const res = limitRequest(from('10.0.0.1'), 'import')!;
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ error: 'rate_limited', retryAfter: Number(res.headers.get('retry-after')) });
    expect(limitRequest(from('10.0.0.2'), 'import')).toBeNull();
  });

  it('limits the registry, which has no token, behind a trusted proxy only: elsewhere a forged address could spend another’s budget', () => {
    vi.stubEnv('CODEX_RATE_REGISTRY', '1/1m');
    const from = (ip: string) => req('/api/registry', { 'x-forwarded-for': ip });
    for (let i = 0; i < 5; i++) expect(limitRequest(from('10.0.0.1'), 'registry')).toBeNull();
    vi.stubEnv('CODEX_TRUST_PROXY', '1');
    expect(limitRequest(from('10.0.0.1'), 'registry')).toBeNull();
    expect(limitRequest(from('10.0.0.1'), 'registry')?.status).toBe(429);
    expect(limitRequest(from('10.0.0.2'), 'registry')).toBeNull();
  });
});

describe('limitReader', () => {
  const req = (ip: string) => new Request('http://codex.test/api/documents/X/file', { headers: { 'x-forwarded-for': ip } });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('answers in the reader’s language, per user', async () => {
    vi.stubEnv('CODEX_RATE_FILES', '1/1m');
    expect(limitReader(req('10.0.0.1'), 'files', 'jholt', DICT.fr)).toBeNull();
    const fr = limitReader(req('10.0.0.1'), 'files', 'jholt', DICT.fr)!;
    expect(fr.status).toBe(429);
    expect(fr.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(fr.headers.get('cache-control')).toBe('no-store');
    expect(await fr.text()).toMatch(/^Trop de demandes en peu de temps : réessayez dans \d+\u00a0s\.$/);
    expect(await limitReader(req('10.0.0.1'), 'files', 'jholt', DICT.en)!.text()).toMatch(/^Too many requests in a short time: try again in \d+\u00a0s\.$/);
    // Another address does not help the same user; another user has their own budget.
    expect(limitReader(req('10.0.0.9'), 'files', 'jholt', DICT.fr)?.status).toBe(429);
    expect(limitReader(req('10.0.0.1'), 'files', 'gcomte', DICT.fr)).toBeNull();
  });

  it('without a trusted proxy, an address (maybe forged) holds back no one; behind one, it caps every user it carries', () => {
    vi.stubEnv('CODEX_RATE_EXPORTS', '2/1m');
    for (const user of ['cbardet', 'gcomte', 'jwagner']) expect(limitReader(req('10.0.0.1'), 'exports', user, DICT.fr), user).toBeNull();
    vi.stubEnv('CODEX_TRUST_PROXY', '1');
    expect(limitReader(req('10.0.0.5'), 'exports', 'jholt', DICT.fr)).toBeNull();
    expect(limitReader(req('10.0.0.5'), 'exports', 'cbardet', DICT.fr)).toBeNull();
    // The address has used its two: a third user from it waits, and spends nothing of their own budget.
    expect(limitReader(req('10.0.0.5'), 'exports', 'gcomte', DICT.fr)?.status).toBe(429);
    expect(waitFor('exports', 'user:gcomte', { limit: 2, windowMs: 60_000 })).toBe(0);
    expect(limitReader(req('10.0.0.6'), 'exports', 'gcomte', DICT.fr)).toBeNull();
  });

  it('lets everything through when the family is off', () => {
    vi.stubEnv('CODEX_RATE_EXPORTS', 'off');
    for (let i = 0; i < 100; i++) expect(limitReader(req('10.0.0.1'), 'exports', 'cbardet', DICT.fr)).toBeNull();
  });
});

describe('refused tokens', () => {
  const req = (ip: string) => new Request('http://codex.test/api/import', { method: 'POST', headers: { 'x-forwarded-for': ip } });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('without a trusted proxy, the address never holds back a request before its token is compared; wrong ones get 429 beyond the quota', async () => {
    vi.stubEnv('CODEX_RATE_TOKEN_FAILURES', '2/15m');
    expect([countTokenFailure(req('10.0.0.1')), countTokenFailure(req('10.0.0.1'))]).toEqual([null, null]);
    const refused = countTokenFailure(req('10.0.0.1'))!;
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: 'rate_limited', retryAfter: 450 });
    expect(tokenFailuresExceeded(req('10.0.0.1'))).toBeNull();
  });

  it('behind a trusted proxy, an address out of tries waits before its token is even compared', () => {
    vi.stubEnv('CODEX_RATE_TOKEN_FAILURES', '2/15m');
    vi.stubEnv('CODEX_TRUST_PROXY', '1');
    countTokenFailure(req('10.0.0.1'));
    expect(tokenFailuresExceeded(req('10.0.0.1'))).toBeNull();
    countTokenFailure(req('10.0.0.1'));
    expect(tokenFailuresExceeded(req('10.0.0.1'))?.status).toBe(429);
    expect(tokenFailuresExceeded(req('10.0.0.2'))).toBeNull();
  });
});

describe('limitWrite', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('counts the writes of each user', () => {
    vi.stubEnv('CODEX_RATE_WRITES', '2/1m');
    expect([limitWrite('jwagner'), limitWrite('jwagner')]).toEqual([0, 0]);
    expect(limitWrite('jwagner')).toBeGreaterThan(0);
    expect(limitWrite('gcomte')).toBe(0);
  });
});
