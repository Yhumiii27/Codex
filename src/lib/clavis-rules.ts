// Sign-in of Codex through Clavis, the group's directory and accesses (owner, 23 Nov 2026: one database for every tool;
// the person's rights are read in the database, never copied). Pure rules: configuration, role, user identifier.
// The flow itself (OpenID Connect, session cookie, routes /auth/…) is in lib/clavis-auth.ts.
//
//   CODEX_AUTH                  demo (default: the simulated user of the shell) | clavis
//   CODEX_PUBLIC_URL            https://<host of Codex> (the callback is <url>/auth/retour, registered in Clavis)
//   CODEX_CLAVIS_URL            https://<host of Clavis> (issuer of the ID tokens)
//   CODEX_CLAVIS_CLIENT_ID      client id registered in Clavis (default "codex")
//   CODEX_CLAVIS_CLIENT_SECRET  its secret (`npm run oidc:client -- codex <callback>` in Clavis, shown once)
//   CODEX_SESSION_SECRET        ≥ 32 characters: encrypts the session and sign-in cookies
//   CODEX_SESSION_HOURS         session lifetime in hours (default 10, 1 to 24)
import { SIM_ROLES, type SimRole } from './i18n';

type Env = Readonly<Record<string, string | undefined>>;

export type AuthMode = 'demo' | 'clavis';

export const authMode = (env: Env = process.env): AuthMode => (env.CODEX_AUTH?.trim().toLowerCase() === 'clavis' ? 'clavis' : 'demo');

export interface ClavisConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Codex's public origin, without a trailing slash. */
  origin: string;
  redirectUri: string;
  sessionSecret: string;
  sessionHours: number;
}

const httpsOrLocal = (v: string | undefined): URL | null => {
  try {
    const u = new URL((v ?? '').trim());
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)) ? u : null;
  } catch {
    return null;
  }
};

/** What is wrong with the Clavis configuration (variable → message), empty when it is complete. */
export function clavisConfigProblems(env: Env = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  if (!httpsOrLocal(env.CODEX_PUBLIC_URL)) out.CODEX_PUBLIC_URL = 'must be the https address of Codex';
  if (!httpsOrLocal(env.CODEX_CLAVIS_URL)) out.CODEX_CLAVIS_URL = 'must be the https address of Clavis';
  if (!env.CODEX_CLAVIS_CLIENT_SECRET?.trim()) out.CODEX_CLAVIS_CLIENT_SECRET = 'is required';
  if ((env.CODEX_SESSION_SECRET ?? '').length < 32) out.CODEX_SESSION_SECRET = 'must be at least 32 characters';
  const h = env.CODEX_SESSION_HOURS;
  if (h && !(/^\d+$/.test(h) && +h >= 1 && +h <= 24)) out.CODEX_SESSION_HOURS = 'must be a number of hours from 1 to 24';
  return out;
}

/** The Clavis configuration; throws when it is incomplete (fail closed: never fall back to the simulated user). */
export function clavisConfig(env: Env = process.env): ClavisConfig {
  const problems = clavisConfigProblems(env);
  const first = Object.entries(problems)[0];
  if (first) throw new Error(`Sign-in through Clavis is not configured: ${first[0]} ${first[1]}`);
  const origin = httpsOrLocal(env.CODEX_PUBLIC_URL)!.origin;
  return {
    issuer: httpsOrLocal(env.CODEX_CLAVIS_URL)!.origin,
    clientId: env.CODEX_CLAVIS_CLIENT_ID?.trim() || 'codex',
    clientSecret: env.CODEX_CLAVIS_CLIENT_SECRET!.trim(),
    origin,
    redirectUri: `${origin}/auth/retour`,
    sessionSecret: env.CODEX_SESSION_SECRET!,
    sessionHours: env.CODEX_SESSION_HOURS ? +env.CODEX_SESSION_HOURS : 10,
  };
}

/**
 * The Codex role of a person's row of clavis.pub_acces (application "codex"): the role IT set in Clavis when the access
 * opens now (`ouvert`), else null. An unknown role gives null (fail closed).
 */
export function roleFromAccess(row: Record<string, unknown> | null | undefined): SimRole | null {
  if (!row || row.ouvert !== true || typeof row.role !== 'string') return null;
  return (SIM_ROLES as readonly string[]).includes(row.role) ? (row.role as SimRole) : null;
}

/** Identifier of a new Codex user from the e-mail's local part ("claire.bardet"), made unique among `taken`. */
export function userIdFor(email: string, taken: ReadonlySet<string>): string {
  const base = (email.split('@')[0] ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9._-]/g, '').slice(0, 40) || 'personne';
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** Two initials of a name ("Claire Bardet" → "CB"; one word → its first two letters). */
export function initialsOf(name: string): string {
  const words = name.trim().split(/[\s-]+/).filter(Boolean);
  const s = words.length >= 2 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? '?').slice(0, 2);
  return s.toUpperCase();
}

/** A return path inside Codex (never another site), default "/". */
export function safeReturnTo(v: string | null | undefined): string {
  return v && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') && !v.startsWith('/auth/') && v.length <= 2000 ? v : '/';
}
