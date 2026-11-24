import 'server-only';
// Sign-in of Codex through Clavis (CODEX_AUTH=clavis; rules and variables: src/server/integrations/clavis/rules.ts). OpenID Connect
// authorisation code flow with PKCE, as Clavis provides it: /auth/connexion sends the browser to Clavis, /auth/retour
// checks the ID token (RS256 signature against Clavis's keys, issuer, audience, expiry, nonce), links the person to a
// Codex user and opens the session; /auth/deconnexion ends it. The session cookie holds the person's Clavis id only: the
// role and whether Codex opens are read in clavis.pub_acces on every request (getCtx), so IT's changes apply at once.
import { createCipheriv, createDecipheriv, createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { getDb, schema as s } from '@/db';
import type { ClavisConfig } from './rules';
import { initialsOf, roleFromAccess, userIdFor } from './rules';
import type { SimRole } from '@/lib/i18n';

export const SESSION_COOKIE = 'codex-session';
export const SIGN_IN_COOKIE = 'codex-signin';
const SIGN_IN_MINUTES = 10;

// ── Sealed cookies (AES-256-GCM, key derived from CODEX_SESSION_SECRET) ────────────────────────────────────────────────

const keyOf = (secret: string, purpose: string) => createHash('sha256').update(`codex:${purpose}:${secret}`).digest();

export function seal(secret: string, purpose: string, data: object): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyOf(secret, purpose), iv);
  const body = Buffer.concat([c.update(JSON.stringify(data), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url');
}

/** The sealed data, or null when absent, tampered with, sealed for another purpose or expired (`exp`, seconds). */
export function unseal<T extends { exp: number }>(secret: string, purpose: string, value: string | undefined, now = Date.now()): T | null {
  if (!value || value.length > 4096) return null;
  try {
    const raw = Buffer.from(value, 'base64url');
    const d = createDecipheriv('aes-256-gcm', keyOf(secret, purpose), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    const data = JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')) as T;
    return typeof data.exp === 'number' && data.exp * 1000 > now ? data : null;
  } catch {
    return null;
  }
}

export interface SessionData { pid: string; exp: number }
export interface SignInData { state: string; nonce: string; verifier: string; returnTo: string; exp: number }

export const sessionCookie = (cfg: ClavisConfig, pid: string, now = Date.now()) =>
  seal(cfg.sessionSecret, 'session', { pid, exp: Math.floor(now / 1000) + cfg.sessionHours * 3600 } satisfies SessionData);

export const cookieOptions = (cfg: ClavisConfig, maxAge: number) =>
  ({ httpOnly: true, secure: cfg.origin.startsWith('https:'), sameSite: 'lax' as const, path: '/', maxAge });

// ── OpenID Connect ─────────────────────────────────────────────────────────────────────────────────────────────────────

interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string; end_session_endpoint?: string }
let discovered: { issuer: string; at: number; doc: Discovery } | null = null;

/** Clavis's discovery document (kept one hour). */
export async function discover(cfg: ClavisConfig): Promise<Discovery> {
  if (discovered && discovered.issuer === cfg.issuer && Date.now() - discovered.at < 3600_000) return discovered.doc;
  const r = await fetch(`${cfg.issuer}/.well-known/openid-configuration`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Clavis discovery failed (${r.status})`);
  const doc = (await r.json()) as Discovery;
  if (doc.issuer !== cfg.issuer) throw new Error('Clavis discovery: unexpected issuer');
  discovered = { issuer: cfg.issuer, at: Date.now(), doc };
  return doc;
}

export const resetDiscovery = () => void (discovered = null);

const b64url = (b: Buffer) => b.toString('base64url');

/** A new sign-in: the Clavis address to go to and the sealed state to keep in a cookie. */
export async function startSignIn(cfg: ClavisConfig, returnTo: string): Promise<{ url: string; cookie: string }> {
  const doc = await discover(cfg);
  const tx: SignInData = { state: b64url(randomBytes(24)), nonce: b64url(randomBytes(24)), verifier: b64url(randomBytes(48)), returnTo, exp: Math.floor(Date.now() / 1000) + SIGN_IN_MINUTES * 60 };
  const u = new URL(doc.authorization_endpoint);
  u.search = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: 'code', scope: 'openid profile email', state: tx.state, nonce: tx.nonce,
    code_challenge: b64url(createHash('sha256').update(tx.verifier).digest()), code_challenge_method: 'S256',
  }).toString();
  return { url: u.toString(), cookie: seal(cfg.sessionSecret, 'signin', tx) };
}

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Exchanges the code and checks the ID token; returns its claims. Throws on any failure. */
export async function finishSignIn(cfg: ClavisConfig, tx: SignInData, params: URLSearchParams): Promise<Record<string, unknown>> {
  const state = params.get('state');
  const code = params.get('code');
  if (!state || !safeEqual(state, tx.state)) throw new Error('state mismatch');
  if (!code || code.length > 512) throw new Error('code missing');
  const doc = await discover(cfg);
  const r = await fetch(doc.token_endpoint, {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri, code_verifier: tx.verifier, client_id: cfg.clientId, client_secret: cfg.clientSecret }),
  });
  if (!r.ok) throw new Error(`token exchange refused (${r.status})`);
  const idToken = ((await r.json()) as { id_token?: unknown }).id_token;
  if (typeof idToken !== 'string') throw new Error('no ID token');
  const claims = await verifyIdToken(cfg, doc, idToken);
  if (claims.nonce !== tx.nonce) throw new Error('nonce mismatch');
  return claims;
}

/** RS256 signature against Clavis's published keys, then issuer, audience and time. */
export async function verifyIdToken(cfg: ClavisConfig, doc: Discovery, jwt: string, now = Date.now()): Promise<Record<string, unknown>> {
  const [h, p, sig, extra] = jwt.split('.');
  if (!h || !p || !sig || extra !== undefined) throw new Error('malformed ID token');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8')) as { alg?: string; kid?: string };
  if (header.alg !== 'RS256') throw new Error('unexpected algorithm');
  const r = await fetch(doc.jwks_uri, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Clavis keys unavailable (${r.status})`);
  const { keys } = (await r.json()) as { keys: (Record<string, unknown> & { kid?: string; kty?: string })[] };
  const jwk = keys.find((k) => k.kty === 'RSA' && (!header.kid || k.kid === header.kid));
  if (!jwk) throw new Error('unknown signing key');
  const key = createPublicKey({ key: jwk as never, format: 'jwk' });
  if (!verify('sha256', Buffer.from(`${h}.${p}`), key, Buffer.from(sig, 'base64url'))) throw new Error('bad signature');
  const c = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as Record<string, unknown>;
  const t = Math.floor(now / 1000);
  if (c.iss !== cfg.issuer) throw new Error('unexpected issuer');
  if (c.aud !== cfg.clientId && !(Array.isArray(c.aud) && c.aud.includes(cfg.clientId))) throw new Error('unexpected audience');
  if (typeof c.exp !== 'number' || c.exp < t - 60) throw new Error('expired ID token');
  if (typeof c.oid !== 'string' || !/^[0-9a-f-]{36}$/i.test(c.oid)) throw new Error('no person id');
  return c;
}

/** Where to send the browser after the sign-out: Clavis's end-session page, back to Codex. */
export async function signOutUrl(cfg: ClavisConfig): Promise<string> {
  try {
    const doc = await discover(cfg);
    if (doc.end_session_endpoint) {
      const u = new URL(doc.end_session_endpoint);
      u.searchParams.set('post_logout_redirect_uri', `${cfg.origin}/`);
      u.searchParams.set('client_id', cfg.clientId);
      return u.toString();
    }
  } catch {
    // Clavis unreachable: the Codex session is ended all the same.
  }
  return `${cfg.origin}/`;
}

// ── Rights and person, read in the database (Clavis's publications, defined by Matrix) ──────────────────────────────

type Row = Record<string, unknown>;

async function firstRow(query: ReturnType<typeof sql>): Promise<Row | null> {
  const db = await getDb();
  const res = (await db.execute(query)) as unknown as { rows: { r: Row | string }[] };
  const r = res.rows[0]?.r;
  return r == null ? null : typeof r === 'string' ? (JSON.parse(r) as Row) : r;
}

/** The person's Codex row of clavis.pub_acces, or null. Throws when the view cannot be read (the caller refuses). */
export const readAccess = (pid: string) =>
  firstRow(sql`select to_jsonb(v) as r from clavis.pub_acces v where v.personne_id::text = ${pid} and v.application = 'codex' limit 1`);

/** The person in clavis.pub_personnes, or null. */
export const readPerson = (pid: string) =>
  firstRow(sql`select to_jsonb(v) as r from clavis.pub_personnes v where v.personne_id::text = ${pid} limit 1`);

/** The Codex role of the person now (null: Codex does not open for them). */
export async function roleNow(pid: string): Promise<SimRole | null> {
  return roleFromAccess(await readAccess(pid));
}

/**
 * The Codex user of a Clavis person: the one already linked, else the one with the same employee number, else a new one
 * (name and initials from the directory). Name, role and employee number follow Clavis at each sign-in.
 */
export async function linkUser(pid: string, role: SimRole, claims: Record<string, unknown>): Promise<string> {
  const person = await readPerson(pid);
  const email = String(person?.email ?? claims.email ?? '');
  const name = String(person?.nom_affiche ?? claims.name ?? email).trim().slice(0, 200) || email;
  const matricule = typeof person?.matricule === 'string' && /^EMP-[0-9]{4,}$/.test(person.matricule) ? person.matricule : null;
  const db = await getDb();
  return db.transaction(async (tx) => {
    let [u] = await tx.select().from(s.users).where(eq(s.users.clavisPersonId, pid));
    if (!u && matricule) [u] = await tx.select().from(s.users).where(eq(s.users.matricule, matricule));
    if (u && u.isSystem) throw new Error('a system actor cannot sign in');
    if (u) {
      await tx.update(s.users).set({ clavisPersonId: pid, name, initials: initialsOf(name), role, ...(matricule ? { matricule } : {}) }).where(eq(s.users.id, u.id));
      return u.id;
    }
    const taken = new Set((await tx.select({ id: s.users.id }).from(s.users)).map((x) => x.id));
    const id = userIdFor(email, taken);
    await tx.insert(s.users).values({ id, name, initials: initialsOf(name), role, isSystem: false, clavisPersonId: pid, matricule, department: null, site: null });
    return id;
  });
}
