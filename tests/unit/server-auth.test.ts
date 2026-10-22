import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { credentialsOf, signatureWindow, valuesOf } from '@/lib/integration-credentials';
import { signatureOf, signRequest, verifySignature } from '@/lib/server-auth';

// Signature of the requests between servers (point 23 of docs/reste-a-faire.md; contract: docs/api.md,
// « Authentification ») : HMAC-SHA256 of "<timestamp>." + raw body, a timestamp within the window either way, the
// secrets of a rotation both accepted. The replay check needs the database: tests/integration/server-auth.test.ts.

const SECRET = 'k3y-0f-th1rty-tw0-v4r1ed-ch4r4ct3rs!';
const NEXT = 'n3xt-k3y-0f-th1rty-tw0-v4r1ed-ch4rs!';
const NOW = Date.UTC(2026, 9, 18, 8, 0, 0);
const BODY = '{"requestId":"ECR-2026-001","accepted":true}';

const check = (headers: Record<string, string | null>, o: { secrets?: string[]; body?: string; now?: number; windowS?: number } = {}) =>
  verifySignature({
    secrets: o.secrets ?? [SECRET], timestamp: headers['X-Codex-Timestamp'] ?? null, signature: headers['X-Codex-Signature'] ?? null,
    body: o.body ?? BODY, now: o.now ?? NOW, windowS: o.windowS ?? 300,
  });

describe('signature', () => {
  it('is the HMAC-SHA256 of "<timestamp>." and the raw body, as a sender computes it with any HMAC library', () => {
    const ts = String(NOW / 1000);
    expect(signatureOf(SECRET, ts, BODY)).toBe(createHmac('sha256', SECRET).update(`${ts}.${BODY}`).digest('hex'));
    expect(signRequest(SECRET, BODY, NOW)).toEqual({ 'X-Codex-Timestamp': ts, 'X-Codex-Signature': `v1=${signatureOf(SECRET, ts, BODY)}` });
  });

  it('accepts a request signed with the secret, within the window either way', () => {
    expect(check(signRequest(SECRET, BODY, NOW))).toMatchObject({ ok: true, timestamp: NOW / 1000 });
    expect(check(signRequest(SECRET, BODY, NOW - 300_000))).toMatchObject({ ok: true });
    expect(check(signRequest(SECRET, BODY, NOW + 300_000))).toMatchObject({ ok: true });
  });

  it('refuses a request out of the window as expired, even signed right', () => {
    expect(check(signRequest(SECRET, BODY, NOW - 301_000))).toEqual({ ok: false, reason: 'signature_expired' });
    expect(check(signRequest(SECRET, BODY, NOW + 301_000))).toEqual({ ok: false, reason: 'signature_expired' });
    expect(check(signRequest(SECRET, BODY, NOW - 31_000), { windowS: 30 })).toEqual({ ok: false, reason: 'signature_expired' });
  });

  it('refuses another secret, a body changed after signing, a timestamp changed after signing', () => {
    expect(check(signRequest('an0ther-s3cret-of-th1rty-tw0-chars!!', BODY, NOW))).toEqual({ ok: false, reason: 'signature_invalid' });
    expect(check(signRequest(SECRET, BODY, NOW), { body: BODY.replace('true', 'false') })).toEqual({ ok: false, reason: 'signature_invalid' });
    const h = signRequest(SECRET, BODY, NOW);
    expect(check({ ...h, 'X-Codex-Timestamp': String(NOW / 1000 + 1) })).toEqual({ ok: false, reason: 'signature_invalid' });
  });

  it('refuses missing or malformed headers', () => {
    const h = signRequest(SECRET, BODY, NOW);
    expect(check({ ...h, 'X-Codex-Signature': null })).toEqual({ ok: false, reason: 'signature_missing' });
    expect(check({ ...h, 'X-Codex-Timestamp': null })).toEqual({ ok: false, reason: 'signature_missing' });
    expect(check({ ...h, 'X-Codex-Timestamp': '2026-10-18T08:00:00Z' })).toEqual({ ok: false, reason: 'signature_invalid' });
    expect(check({ ...h, 'X-Codex-Signature': h['X-Codex-Signature'].replace('v1=', 'v0=') })).toEqual({ ok: false, reason: 'signature_invalid' });
    expect(check({ ...h, 'X-Codex-Signature': 'v1=abc' })).toEqual({ ok: false, reason: 'signature_invalid' });
  });

  it('accepts either secret of a rotation, and a request signed with both', () => {
    expect(check(signRequest(NEXT, BODY, NOW), { secrets: [SECRET, NEXT] })).toMatchObject({ ok: true });
    expect(check(signRequest([SECRET, NEXT], BODY, NOW), { secrets: [NEXT] })).toMatchObject({ ok: true });
    expect(check(signRequest(NEXT, BODY, NOW), { secrets: [SECRET] })).toEqual({ ok: false, reason: 'signature_invalid' });
  });
});

describe('credentials', () => {
  it('reads a variable and its _NEXT, trimmed, empty ones left out', () => {
    expect(valuesOf('VIGIE_WEBHOOK_TOKEN', { VIGIE_WEBHOOK_TOKEN: ' a ', VIGIE_WEBHOOK_TOKEN_NEXT: 'b' })).toEqual(['a', 'b']);
    expect(valuesOf('VIGIE_WEBHOOK_TOKEN', { VIGIE_WEBHOOK_TOKEN_NEXT: ' ' })).toEqual([]);
    expect(credentialsOf('vigie', { VIGIE_WEBHOOK_SECRET: 's', VIGIE_WEBHOOK_TOKEN: 't' })).toEqual({ tokens: ['t'], secrets: ['s'] });
    // The registry takes no signature: a GET has no body.
    expect(credentialsOf('registry', { CODEX_REGISTRY_TOKEN: 'r', CODEX_REGISTRY_SECRET: 'x' })).toEqual({ tokens: ['r'], secrets: [] });
  });

  it('keeps the window between 30 and 3600 seconds, 300 otherwise', () => {
    expect(signatureWindow({})).toBe(300);
    expect(signatureWindow({ CODEX_SIGNATURE_WINDOW_S: '60' })).toBe(60);
    for (const v of ['10', '7200', '5m', '-1']) expect(signatureWindow({ CODEX_SIGNATURE_WINDOW_S: v }), v).toBe(300);
  });
});
