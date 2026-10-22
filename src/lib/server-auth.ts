import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { lt } from 'drizzle-orm';
import { getDb, schema as s } from '@/db';
import { currentRequest, expectedAnswer, logger } from './log';
import { credentialsOf, ENDPOINTS, signatureWindow, type Endpoint } from './integration-credentials';
import { clientAddress, countTokenFailure, tokenFailuresExceeded, trustProxy } from './ratelimit';

export { credentialsOf, type Endpoint } from './integration-credentials';

// Authentication between servers (point 23 of docs/reste-a-faire.md; contract: docs/api.md, « Authentification »).
//
// Two credentials, each set per endpoint, and both required when both are set:
// - a bearer token (`Authorization: Bearer <token>`), compared in constant time;
// - an HMAC-SHA256 signature of the request: `X-Codex-Timestamp: <Unix seconds>` and
//   `X-Codex-Signature: v1=<hex of HMAC-SHA256(secret, "<timestamp>." + raw body)>`. The timestamp must be within the
//   window (CODEX_SIGNATURE_WINDOW_S, 300 s by default, either way), and a signed request (its timestamp and raw body) is
//   accepted once: sent again within the window, with any of its signatures, it is refused as a replay (table
//   integration_signatures, shared by every Codex process on the database).
// Rotation: each variable has a second one, <NAME>_NEXT, accepted beside it; the new value is set there, the client
// moves to it, then it becomes the value and _NEXT is removed. A sender may sign with both secrets during the change
// (several "v1=" values, comma-separated).
//
// An import or Vigie endpoint with neither token nor secret is disabled (503). The registry, read by Keystone, stays open
// while CODEX_REGISTRY_TOKEN is unset (the default, so that Keystone keeps reading it); it takes no signature (a GET has
// no body). How Vigie and Keystone themselves will hold and send these is not decided (O-03, O-10).

const log = logger('auth');

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

type Refusal = 'disabled' | 'blocked' | 'missing' | 'invalid' | 'signature_missing' | 'signature_invalid' | 'signature_expired' | 'signature_replayed';

/**
 * A refused request, in the technical log: the route, the client's address and why, never the token or signature sent.
 * The address is `client` behind a trusted proxy only (CODEX_TRUST_PROXY, lib/ratelimit.ts); otherwise the client may
 * have written X-Forwarded-For itself, and its last entry is logged as `forwardedFor`, with `clientTrusted: false`. A
 * call to an endpoint left disabled (no variable, the default) is information, not a credential being guessed.
 */
function refused(req: Request, endpoint: Endpoint, reason: Refusal, res: Response): Response {
  const address = clientAddress(req.headers);
  const e = ENDPOINTS[endpoint];
  log[reason === 'disabled' ? 'info' : 'warn'](reason.startsWith('signature') ? 'integration signature refused' : 'integration token refused', {
    route: currentRequest()?.route ?? new URL(req.url).pathname,
    ...(trustProxy() ? { client: address } : { forwardedFor: address, clientTrusted: false }),
    reason, variable: reason.startsWith('signature') ? e.secret : e.token, status: res.status,
  });
  return res;
}

const digest = (v: string) => createHash('sha256').update(v).digest();

/** Whether `sent` is one of `accepted`: every value compared, through fixed-length digests, in constant time. */
function matchesOne(sent: string, accepted: string[]): boolean {
  const d = digest(sent);
  let ok = false;
  for (const a of accepted) ok = timingSafeEqual(d, digest(a)) || ok;
  return ok;
}

/**
 * First check of an integration request, before its body is read: null when it may go on. Otherwise the response to
 * send: 503 while the endpoint has neither token nor secret (import, Vigie: disabled; the registry is then open and
 * this returns null), 401 for a missing or wrong token when one is set, 429 once the client's address has had too many
 * credentials refused (CODEX_RATE_TOKEN_FAILURES, lib/ratelimit.ts). Behind a trusted proxy (CODEX_TRUST_PROXY), that
 * address then gets 429 without its token being compared, so that guessing it gets no faster than the limit; without
 * one, the address may be forged, so only wrong credentials get 429 and the right one always goes through.
 * The signature, when the endpoint has a secret, is checked once the body is read (checkSignature).
 */
export function checkBearer(req: Request, endpoint: Endpoint): Response | null {
  const { tokens, secrets } = credentialsOf(endpoint);
  if (!tokens.length && !secrets.length) {
    return endpoint === 'registry' ? null : refused(req, endpoint, 'disabled', expectedAnswer(json({ error: 'disabled' }, 503)));
  }
  const blocked = tokenFailuresExceeded(req);
  if (blocked) return refused(req, endpoint, 'blocked', blocked);
  if (!tokens.length) return null;
  const m = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(req.headers.get('authorization') ?? '');
  if (!m || !matchesOne(m[1], tokens)) {
    const res = countTokenFailure(req) ?? json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer realm="codex"' });
    return refused(req, endpoint, m ? 'invalid' : 'missing', res);
  }
  return null;
}

// ── Signatures ──────────────────────────────────────────────────────────

export const TIMESTAMP_HEADER = 'x-codex-timestamp';
export const SIGNATURE_HEADER = 'x-codex-signature';

/** HMAC-SHA256 of "<timestamp>." followed by the raw body, in hexadecimal. */
export function signatureOf(secret: string, timestamp: string, body: Uint8Array | string): string {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');
}

/**
 * The headers a sender adds to a request whose raw body is `body`: the timestamp (Unix seconds) and one "v1=" signature
 * per secret given (two during a rotation). For tests, and for Codex's own calls to Vigie once they exist (T-01).
 */
export function signRequest(secrets: string | string[], body: Uint8Array | string, now = Date.now()): Record<string, string> {
  const timestamp = String(Math.floor(now / 1000));
  const list = Array.isArray(secrets) ? secrets : [secrets];
  return { 'X-Codex-Timestamp': timestamp, 'X-Codex-Signature': list.map((k) => `v1=${signatureOf(k, timestamp, body)}`).join(',') };
}

export type SignatureCheck = { ok: true; timestamp: number; signature: string } | { ok: false; reason: 'signature_missing' | 'signature_invalid' | 'signature_expired' };

/**
 * Checks the signature headers against the secrets, without the replay check. Pure. `now` in milliseconds. The timestamp
 * is checked before the signature: an expired request is refused as such, signed right or not.
 */
export function verifySignature(o: { secrets: string[]; timestamp: string | null; signature: string | null; body: Uint8Array | string; now: number; windowS: number }): SignatureCheck {
  if (!o.timestamp || !o.signature) return { ok: false, reason: 'signature_missing' };
  if (!/^\d{1,12}$/.test(o.timestamp.trim())) return { ok: false, reason: 'signature_invalid' };
  const ts = Number(o.timestamp.trim());
  if (Math.abs(o.now / 1000 - ts) > o.windowS) return { ok: false, reason: 'signature_expired' };
  const sent = o.signature.split(',').map((x) => x.trim()).filter((x) => x.startsWith('v1=')).map((x) => x.slice(3).toLowerCase()).filter((x) => /^[0-9a-f]{64}$/.test(x)).slice(0, 4);
  // Every pair compared in constant time; the first one that matches is the signature remembered against a replay.
  let matched: string | null = null;
  for (const secret of o.secrets) {
    const expected = Buffer.from(signatureOf(secret, o.timestamp.trim(), o.body), 'hex');
    for (const x of sent) if (timingSafeEqual(expected, Buffer.from(x, 'hex')) && !matched) matched = x;
  }
  return matched ? { ok: true, timestamp: ts, signature: matched } : { ok: false, reason: 'signature_invalid' };
}

/**
 * Second check of an integration request whose endpoint has a secret, once its raw body is read: null when the
 * signature is valid, fresh and new. Otherwise 401 `{"error":"unauthorized","reason":…}` (signature_missing,
 * signature_invalid, signature_expired, signature_replayed), or 429 past the quota of refused credentials. An accepted
 * signature is remembered until its timestamp leaves the window; those already out of it are forgotten at that moment.
 */
export async function checkSignature(req: Request, endpoint: Endpoint, body: Uint8Array, now = Date.now()): Promise<Response | null> {
  const { secrets } = credentialsOf(endpoint);
  if (!secrets.length) return null;
  const windowS = signatureWindow();
  const v = verifySignature({ secrets, timestamp: req.headers.get(TIMESTAMP_HEADER), signature: req.headers.get(SIGNATURE_HEADER), body, now, windowS });
  const deny = (reason: Refusal) => refused(req, endpoint, reason, countTokenFailure(req) ?? json({ error: 'unauthorized', reason }, 401));
  if (!v.ok) return deny(v.reason);
  const db = await getDb();
  // Remembered by what is signed (timestamp and raw body), not by the signature recognised: a request signed with both
  // secrets of a rotation, sent again with the other signature alone, is the same request (revue du lot 9).
  const bodyDigest = createHash('sha256').update(body).digest('hex');
  const key = createHash('sha256').update(`${endpoint}:${v.timestamp}:${bodyDigest}`).digest('hex');
  await db.delete(s.integrationSignatures).where(lt(s.integrationSignatures.expiresAt, new Date(now).toISOString()));
  const [fresh] = await db.insert(s.integrationSignatures)
    .values({ digest: key, endpoint, expiresAt: new Date((v.timestamp + windowS) * 1000).toISOString() })
    .onConflictDoNothing()
    .returning({ digest: s.integrationSignatures.digest });
  return fresh ? null : deny('signature_replayed');
}
