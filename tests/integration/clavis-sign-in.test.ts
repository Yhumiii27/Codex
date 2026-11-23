import { generateKeyPairSync, sign } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { SESSION_COOKIE, SIGN_IN_COOKIE, resetDiscovery } from '@/lib/clavis-auth';
import { getCtx } from '@/lib/context';
import { GET as connexion } from '@/app/auth/connexion/route';
import { GET as retour } from '@/app/auth/retour/route';
import { setupDb } from '../support/db';
import { cookieStore } from '../support/session';

// Sign-in through Clavis end to end (CODEX_AUTH=clavis), against a Clavis double: the ID token signed with an RSA key
// published as JWKS, the rights read in clavis.pub_acces (a stand-in of the views Matrix publishes, same columns), the
// person linked to a Codex user, then getCtx on every request: the role is Clavis's, a closed access ends the session.

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), cache: <T,>(f: T) => f }));

const db = setupDb();
// Under npm run test:pg the role has no CREATE on the database (as codex_app on the shared server): no stand-in schema
// clavis there, so only the case « view not readable » runs on both (as in capex.test.ts).
const PG = !!process.env.CODEX_TEST_DATABASE_URL?.trim();
const ISSUER = 'https://clavis.example';
const ORIGIN = 'https://codex.example';
const PID = '7b0c2e2a-5f0e-4a6b-9d7e-3c1f2a4b5c6d';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid: 'k1', use: 'sig', alg: 'RS256' };
let nonce = '';
let claimsOverride: Record<string, unknown> = {};

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function idToken(extra: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'RS256', kid: 'k1' })}.${b64({ iss: ISSUER, aud: 'codex', sub: PID, oid: PID, nonce, iat: now, exp: now + 3600, email: 'claire.dupont@epc-groupe.com', name: 'Claire Dupont', ...extra })}`;
  return `${body}.${sign('sha256', Buffer.from(body), privateKey).toString('base64url')}`;
}

beforeAll(() => {
  for (const [k, v] of Object.entries({ CODEX_AUTH: 'clavis', CODEX_PUBLIC_URL: ORIGIN, CODEX_CLAVIS_URL: ISSUER, CODEX_CLAVIS_CLIENT_SECRET: 'client-secret', CODEX_SESSION_SECRET: 's'.repeat(40) })) vi.stubEnv(k, v);
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === `${ISSUER}/.well-known/openid-configuration`)
      return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/oauth/authorize`, token_endpoint: `${ISSUER}/oauth/token`, jwks_uri: `${ISSUER}/oauth/jwks`, end_session_endpoint: `${ISSUER}/oauth/logout` });
    if (url === `${ISSUER}/oauth/jwks`) return Response.json({ keys: [jwk] });
    if (url === `${ISSUER}/oauth/token`) {
      const form = new URLSearchParams(String(init?.body));
      if (form.get('client_secret') !== 'client-secret' || form.get('code') !== 'the-code') return Response.json({ error: 'invalid_grant' }, { status: 400 });
      return Response.json({ id_token: idToken(claimsOverride) });
    }
    return new Response('not found', { status: 404 });
  });
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
beforeEach(async () => {
  resetDiscovery();
  claimsOverride = {};
  if (PG) return;
  await db().execute(sql.raw('drop schema if exists clavis cascade'));
  await db().execute(sql.raw('create schema clavis'));
  await db().execute(sql.raw('create table clavis.pub_acces (personne_id uuid, application text, autorise boolean, niveau text, domaine text, role text, ouvert boolean, maj_le timestamptz)'));
  await db().execute(sql.raw('create table clavis.pub_personnes (personne_id uuid, matricule text, prenom text, nom text, nom_affiche text, email text, poste text, departement text, pole text, responsable_id uuid, dans_annuaire boolean, actif boolean, maj_le timestamptz)'));
  await db().execute(sql`insert into clavis.pub_personnes values (${PID}, null, 'Claire', 'Dupont', 'Claire Dupont', 'claire.dupont@epc-groupe.com', 'Responsable qualité', 'Qualité', null, null, true, true, now())`);
  await db().execute(sql`insert into clavis.pub_acces values (${PID}, 'codex', true, 'referent', 'quality', 'gestionnaire', true, now()), (${PID}, 'keystone', true, 'reader', null, 'member', true, now())`);
});

/** /auth/connexion → Clavis (the double) → /auth/retour, as the browser would; returns the callback's response. */
async function signIn(code = 'the-code') {
  const start = await connexion(new NextRequest(`${ORIGIN}/auth/connexion?retour=%2Fexplorateur`));
  const location = new URL(start.headers.get('location')!);
  expect(location.origin + location.pathname).toBe(`${ISSUER}/oauth/authorize`);
  expect(location.searchParams.get('code_challenge_method')).toBe('S256');
  nonce = location.searchParams.get('nonce')!;
  const tx = start.cookies.get(SIGN_IN_COOKIE)!.value;
  return retour(new NextRequest(`${ORIGIN}/auth/retour?code=${code}&state=${location.searchParams.get('state')}`, { headers: { cookie: `${SIGN_IN_COOKIE}=${tx}` } }));
}

describe('sign-in through Clavis', () => {
  it.skipIf(PG)('opens the session, creates the Codex user and takes the role set in Clavis', async () => {
    const res = await signIn();
    expect(res.headers.get('location')).toBe(`${ORIGIN}/explorateur`);
    const session = res.cookies.get(SESSION_COOKIE)!;
    expect(session.httpOnly).toBe(true);
    const [u] = await db().select().from(s.users).where(eq(s.users.clavisPersonId, PID));
    expect(u).toMatchObject({ id: 'claire.dupont', name: 'Claire Dupont', initials: 'CD', role: 'gestionnaire', isSystem: false });

    (await cookieStore()).set(SESSION_COOKIE, session.value);
    expect(await getCtx()).toMatchObject({ user: { id: 'claire.dupont' }, role: 'gestionnaire', seesAll: true });
    // A change in Clavis applies at the next page.
    await db().execute(sql`update clavis.pub_acces set role = 'collaborateur' where application = 'codex'`);
    expect(await getCtx()).toMatchObject({ role: 'collaborateur', seesAll: false });
    // Access closed: the refusal page, no Codex page.
    await db().execute(sql`update clavis.pub_acces set ouvert = false where application = 'codex'`);
    await expect(getCtx()).rejects.toThrow('REDIRECT:/auth/refus?motif=acces');
    // A second sign-in links the same user again, never a new one.
    await db().execute(sql`update clavis.pub_acces set ouvert = true where application = 'codex'`);
    await signIn();
    expect((await db().select().from(s.users).where(eq(s.users.clavisPersonId, PID))).length).toBe(1);
  });

  it.skipIf(PG)('refuses a person without access, a forged or foreign token, and a missing session', async () => {
    await db().execute(sql`update clavis.pub_acces set ouvert = false where application = 'codex'`);
    expect((await signIn()).headers.get('location')).toBe(`${ORIGIN}/auth/refus?motif=acces`);
    await db().execute(sql`update clavis.pub_acces set ouvert = true where application = 'codex'`);
    claimsOverride = { aud: 'keystone' };
    expect((await signIn()).headers.get('location')).toBe(`${ORIGIN}/auth/refus?motif=jeton`);
    claimsOverride = { iss: 'https://other.example' };
    expect((await signIn()).headers.get('location')).toBe(`${ORIGIN}/auth/refus?motif=jeton`);
    expect((await signIn('wrong-code')).headers.get('location')).toBe(`${ORIGIN}/auth/refus?motif=jeton`);
    expect((await db().select().from(s.users).where(eq(s.users.clavisPersonId, PID))).length).toBe(0);
    (await cookieStore()).set(SESSION_COOKIE, 'forged');
    await expect(getCtx()).rejects.toThrow('REDIRECT:/auth/connexion');
  });

  it('refuses when the rights cannot be read (view missing): never a page without rights', async () => {
    if (!PG) await db().execute(sql.raw('drop schema clavis cascade'));
    expect((await signIn()).headers.get('location')).toBe(`${ORIGIN}/auth/refus?motif=indisponible`);
  });
});

