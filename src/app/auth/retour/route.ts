import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, SIGN_IN_COOKIE, cookieOptions, finishSignIn, linkUser, roleNow, sessionCookie, unseal, type SignInData } from '@/lib/clavis-auth';
import { authMode, clavisConfig } from '@/lib/clavis-rules';
import { logger } from '@/lib/log';

const log = logger('auth');

/**
 * GET /auth/retour?code&state — back from Clavis: the ID token is checked, the access read in clavis.pub_acces, the
 * person linked to a Codex user, then the session opens. Any failure: no session, the refusal page says why.
 */
export async function GET(req: NextRequest) {
  if (authMode() !== 'clavis') return new NextResponse(null, { status: 404 });
  const origin = req.nextUrl.origin;
  const refuse = (motif: string) => {
    const res = NextResponse.redirect(new URL(`/auth/refus?motif=${motif}`, origin), 302);
    res.cookies.delete(SIGN_IN_COOKIE);
    return res;
  };
  let cfg;
  try {
    cfg = clavisConfig();
  } catch (e) {
    log.error('sign-in not configured', { error: e instanceof Error ? e.message : String(e) });
    return refuse('indisponible');
  }
  const tx = unseal<SignInData>(cfg.sessionSecret, 'signin', req.cookies.get(SIGN_IN_COOKIE)?.value);
  if (!tx) return refuse('expiree');
  if (req.nextUrl.searchParams.get('error')) return refuse(req.nextUrl.searchParams.get('error') === 'access_denied' ? 'acces' : 'clavis');
  let claims: Record<string, unknown>;
  try {
    claims = await finishSignIn(cfg, tx, req.nextUrl.searchParams);
  } catch (e) {
    log.warn('sign-in refused', { error: e instanceof Error ? e.message : String(e) });
    return refuse('jeton');
  }
  const pid = String(claims.oid);
  try {
    const role = await roleNow(pid);
    if (!role) return refuse('acces');
    await linkUser(pid, role, claims);
  } catch (e) {
    log.error('rights not read in clavis.pub_acces', { error: e instanceof Error ? e.message : String(e) });
    return refuse('indisponible');
  }
  const res = NextResponse.redirect(new URL(tx.returnTo, origin), 302);
  res.cookies.set(SESSION_COOKIE, sessionCookie(cfg, pid), cookieOptions(cfg, cfg.sessionHours * 3600));
  res.cookies.delete(SIGN_IN_COOKIE);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
