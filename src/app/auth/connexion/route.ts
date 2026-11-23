import { NextResponse, type NextRequest } from 'next/server';
import { SIGN_IN_COOKIE, cookieOptions, startSignIn } from '@/lib/clavis-auth';
import { authMode, clavisConfig, safeReturnTo } from '@/lib/clavis-rules';
import { logger } from '@/lib/log';

const log = logger('auth');

/** GET /auth/connexion?retour=/… — sends the browser to Clavis (sign-in through Clavis, CODEX_AUTH=clavis). */
export async function GET(req: NextRequest) {
  if (authMode() !== 'clavis') return new NextResponse(null, { status: 404 });
  try {
    const cfg = clavisConfig();
    const { url, cookie } = await startSignIn(cfg, safeReturnTo(req.nextUrl.searchParams.get('retour')));
    const res = NextResponse.redirect(url, 302);
    res.cookies.set(SIGN_IN_COOKIE, cookie, cookieOptions(cfg, 600));
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (e) {
    log.error('sign-in not started', { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.redirect(new URL('/auth/refus?motif=indisponible', req.nextUrl.origin), 302);
  }
}
