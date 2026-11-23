import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, signOutUrl } from '@/lib/clavis-auth';
import { authMode, clavisConfig } from '@/lib/clavis-rules';

/** POST /auth/deconnexion — ends the Codex session, then the Clavis one. A cross-site request is refused. */
export async function POST(req: NextRequest) {
  if (authMode() !== 'clavis') return new NextResponse(null, { status: 404 });
  if (req.headers.get('sec-fetch-site') === 'cross-site') return new NextResponse('Forbidden', { status: 403 });
  let target = `${req.nextUrl.origin}/`;
  try {
    target = await signOutUrl(clavisConfig());
  } catch {
    // not configured: the session cookie is removed all the same
  }
  const res = NextResponse.redirect(target, 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
