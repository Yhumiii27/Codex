import type { T } from './i18n';
import { logger } from './log';

// Rate limiting of the sensitive endpoints (point 24 of docs/reste-a-faire.md): a token bucket per family and per key,
// in memory. A key may send `limit` requests at once, then regains one every windowMs / limit; beyond, the request is
// refused with 429 and Retry-After.
//
// One server process: PGlite already confines Codex to one (README). Several instances would each count on their own,
// letting through up to n times the limit: the counters would then move to a shared store (Redis, the database) or
// to the reverse proxy in front of them. A restart empties the counters.
//
// A key the client chooses never holds back anyone else. The client's address comes from X-Forwarded-For, which the
// client may write itself unless a reverse proxy declared by CODEX_TRUST_PROXY writes it: without one, the address only
// counts requests that already carry the right token (import, Vigie) and refused tokens, and the right token always
// goes through. The browser endpoints count per user as resolved by lib/context.ts (an unknown cookie is the default
// user), whose set is bounded by the real accounts, and per address behind a trusted proxy only.

const log = logger('ratelimit');

export type Rule = { limit: number; windowMs: number };

type FamilySpec = {
  /** Environment variable overriding the default: "600" (per minute), "600/1m", "20/15m", "5/30s", "0" or "off". */
  env: string;
  def: string;
};

export const RATE_LIMITS = {
  /** POST /api/import (migration tool), per address, once the token is checked. */
  import: { env: 'CODEX_RATE_IMPORT', def: '600/1m' },
  /** POST /api/integrations/vigie (Vigie's decisions), per address, once the token is checked. */
  vigie: { env: 'CODEX_RATE_VIGIE', def: '600/1m' },
  /** Credentials refused (token or signature missing or wrong) on those two and on a registry behind a token, per address: beyond, 429 instead of 401. */
  tokens: { env: 'CODEX_RATE_TOKEN_FAILURES', def: '20/15m' },
  /** GET /api/registry (Keystone), per address, behind a trusted proxy only. */
  registry: { env: 'CODEX_RATE_REGISTRY', def: '300/1m' },
  /** Stored files and approval records (/api/documents/[id]/file and /approval), per user (and address). */
  files: { env: 'CODEX_RATE_FILES', def: '600/1m' },
  /** CSV exports (/api/export/search, /api/export/audit), per user (and address). */
  exports: { env: 'CODEX_RATE_EXPORTS', def: '30/1m' },
  /** Server Actions that write (lib/actions.ts), per user. */
  writes: { env: 'CODEX_RATE_WRITES', def: '120/1m' },
} as const satisfies Record<string, FamilySpec>;

export type Family = keyof typeof RATE_LIMITS;

const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 };

/**
 * "N" (per minute) or "N/<duration>" (30s, 1m, 15m, 1h; the number may be left out: "N/m"). Null for no limit ("0",
 * "off"); undefined for a value that is none of these.
 */
export function parseRule(raw: string | undefined): Rule | null | undefined {
  const v = raw?.trim().toLowerCase();
  if (!v) return undefined;
  if (v === '0' || v === 'off') return null;
  const m = /^(\d+)(?:\s*\/\s*(\d*)\s*([smh]))?$/.exec(v);
  if (!m) return undefined;
  const limit = Number(m[1]);
  const windowMs = m[3] ? (m[2] ? Number(m[2]) : 1) * UNIT_MS[m[3]] : UNIT_MS.m;
  if (!Number.isSafeInteger(limit) || windowMs <= 0) return undefined;
  return limit === 0 ? null : { limit, windowMs };
}

const warned = new Set<string>();

/** The rule of `family`: its variable, else its default; null when limiting is off (CODEX_RATE_LIMIT=off, or "0"). */
export function ruleFor(family: Family, env: Record<string, string | undefined> = process.env): Rule | null {
  if (/^(0|off|false|no)$/i.test(env.CODEX_RATE_LIMIT?.trim() ?? '')) return null;
  const spec = RATE_LIMITS[family];
  const raw = env[spec.env];
  const own = parseRule(raw);
  if (own !== undefined) return own;
  if (raw?.trim() && !warned.has(`${spec.env}=${raw}`)) {
    warned.add(`${spec.env}=${raw}`);
    log.warn(`${spec.env}="${raw}" is not a valid limit; default ${spec.def} applies`);
  }
  return parseRule(spec.def)!;
}

/**
 * CODEX_TRUST_PROXY=1: a reverse proxy in front of Codex writes X-Forwarded-For (replaces it, or appends the address it
 * sees), and clients cannot reach Codex without it. Off by default: locally the client may write that header itself.
 */
export function trustProxy(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|on|yes)$/i.test(env.CODEX_TRUST_PROXY?.trim() ?? '');
}

// ── Buckets ─────────────────────────────────────────────────────────────

type Bucket = { tokens: number; at: number };

/**
 * Keys kept at most per family. Beyond, only buckets full again (which remember nothing) are forgotten; while none is,
 * a new key is refused rather than one in deficit forgotten.
 */
export const MAX_KEYS = 10_000;

// Kept on globalThis so that route handlers, Server Actions and dev hot reloads share one set of counters. One map per
// family: the keys of one never crowd out those of another.
const g = globalThis as unknown as { __codexRateLimits?: Map<Family, Map<string, Bucket>> };
function bucketsOf(family: Family): Map<string, Bucket> {
  const all = (g.__codexRateLimits ??= new Map());
  let map = all.get(family);
  if (!map) all.set(family, (map = new Map()));
  return map;
}

function current(b: Bucket | undefined, rule: Rule, now: number): Bucket {
  if (!b) return { tokens: rule.limit, at: now };
  const refilled = b.tokens + (Math.max(0, now - b.at) * rule.limit) / rule.windowMs;
  return { tokens: Math.min(rule.limit, refilled), at: now };
}

/** Whole seconds until the bucket holds `goal` tokens again (at least 1). */
const secondsUntil = (b: Bucket, goal: number, rule: Rule) => Math.max(1, Math.ceil(((goal - b.tokens) * rule.windowMs) / rule.limit / 1000));

/**
 * Room for one more key in a full map: forgets every bucket full again. 0 when some were, else the seconds until the
 * first one is.
 */
function makeRoom(map: Map<string, Bucket>, rule: Rule, now: number): number {
  let soonest = Infinity;
  for (const [id, stored] of map) {
    const b = current(stored, rule, now);
    if (b.tokens >= rule.limit) map.delete(id);
    else soonest = Math.min(soonest, secondsUntil(b, rule.limit, rule));
  }
  return map.size < MAX_KEYS ? 0 : soonest;
}

/** Counts one request of `key`: 0 when it may go, else the seconds to wait (Retry-After); a refused request is not counted. */
export function take(family: Family, key: string, rule: Rule, now = Date.now()): number {
  const map = bucketsOf(family);
  const stored = map.get(key);
  const b = current(stored, rule, now);
  if (b.tokens < 1) return secondsUntil(b, 1, rule);
  if (!stored && map.size >= MAX_KEYS) {
    const wait = makeRoom(map, rule, now);
    if (wait) return wait;
  }
  b.tokens -= 1;
  map.set(key, b);
  return 0;
}

/** The seconds `key` must wait before its next request, without counting one: 0 when it may go. */
export function waitFor(family: Family, key: string, rule: Rule, now = Date.now()): number {
  const b = current(bucketsOf(family).get(key), rule, now);
  return b.tokens >= 1 ? 0 : secondsUntil(b, 1, rule);
}

/** Forgets every counter (tests). */
export function resetRateLimits(): void {
  g.__codexRateLimits?.clear();
}

// ── Keys ────────────────────────────────────────────────────────────────

/**
 * The client's address: the last X-Forwarded-For entry. A reverse proxy in front of Codex adds it (or replaces the
 * header); without one, Next.js sets it from the connection, unless the client sent one itself, which it may then
 * choose freely (see trustProxy).
 */
export function clientAddress(headers: Headers): string {
  const last = headers.get('x-forwarded-for')?.split(',').map((x) => x.trim()).filter(Boolean).pop();
  return last ? last.slice(0, 64) : 'unknown';
}

// ── Answers ─────────────────────────────────────────────────────────────

const NO_STORE = { 'Cache-Control': 'no-store' };

/** Integration endpoints: JSON. */
function tooManyJson(wait: number): Response {
  return Response.json({ error: 'rate_limited', retryAfter: wait }, { status: 429, headers: { 'Retry-After': String(wait), ...NO_STORE } });
}

/** Browser endpoints (a download, the preview frame): a line of text in the reader's language. */
function tooManyText(wait: number, t: T): Response {
  return new Response(t.rate_limited.replace('{n}', String(wait)), {
    status: 429,
    headers: { 'Retry-After': String(wait), ...NO_STORE, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/**
 * Integration endpoints: the 429 to send when the client's address has used up its bucket of `family`; otherwise null,
 * the request counted. Import and Vigie call it once the token is checked, so that only its holder spends the budget.
 * The registry has no token: it is limited behind a trusted proxy only, where a client cannot spend another's budget.
 */
export function limitRequest(req: Request, family: 'import' | 'vigie' | 'registry'): Response | null {
  if (family === 'registry' && !trustProxy()) return null;
  const rule = ruleFor(family);
  const wait = rule ? take(family, clientAddress(req.headers), rule) : 0;
  return wait ? tooManyJson(wait) : null;
}

/**
 * Browser endpoints: the 429 to send, in the reader's language, when `userId` (the user lib/context.ts resolved, never
 * the raw cookie) has used up its bucket of `family`, or, behind a trusted proxy, the client's address has; otherwise
 * null, the request counted in both.
 */
export function limitReader(req: Request, family: 'files' | 'exports', userId: string, t: T): Response | null {
  const rule = ruleFor(family);
  if (!rule) return null;
  const keys = [`user:${userId}`, ...(trustProxy() ? [`address:${clientAddress(req.headers)}`] : [])];
  // Both buckets must have room before either is counted: a request refused by one spends nothing in the other.
  const wait = Math.max(...keys.map((k) => waitFor(family, k, rule))) || Math.max(...keys.map((k) => take(family, k, rule)));
  return wait ? tooManyText(wait, t) : null;
}

/**
 * Before comparing a token: behind a trusted proxy, the 429 to send when the client's address has had too many tokens
 * refused; the token is then not even compared, so that guessing it gets no faster than the limit. Without one, null:
 * the address may be another client's, forged, and must never hold back the right token.
 */
export function tokenFailuresExceeded(req: Request): Response | null {
  if (!trustProxy()) return null;
  const rule = ruleFor('tokens');
  const wait = rule ? waitFor('tokens', clientAddress(req.headers), rule) : 0;
  return wait ? tooManyJson(wait) : null;
}

/** Counts a refused token against the client's address: the 429 to send instead of 401 once its quota is used up. */
export function countTokenFailure(req: Request): Response | null {
  const rule = ruleFor('tokens');
  const wait = rule ? take('tokens', clientAddress(req.headers), rule) : 0;
  return wait ? tooManyJson(wait) : null;
}

/** Server Actions: counts a write of `userId`; 0 when it may go, else the seconds to wait. */
export function limitWrite(userId: string): number {
  const rule = ruleFor('writes');
  return rule ? take('writes', userId, rule) : 0;
}
