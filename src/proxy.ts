import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy, httpsEnabled, HSTS, makeNonce } from '@/lib/security-headers';

// Content-Security-Policy of the pages, with a nonce per request (lib/security-headers.ts). The policy is set on the
// request too: Next.js reads the nonce there and puts it on the scripts it renders. HSTS only when CODEX_HTTPS is set.
// The other security headers come from next.config.ts, on every response.

export function proxy(request: NextRequest) {
  const https = httpsEnabled();
  const csp = contentSecurityPolicy({ nonce: makeNonce(), dev: process.env.NODE_ENV === 'development', https });
  const headers = new Headers(request.headers);
  headers.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  if (https) response.headers.set('Strict-Transport-Security', HSTS);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: not the API (JSON and stored files) nor the build's static files.
      source: '/((?!api/|_next/static/|_next/image|favicon.ico).*)',
      // Nor the Server Action calls the browser sends (header Next-Action): their answer is a React stream, not a
      // document, and a proxy makes Next.js copy each request body into memory, cut at
      // experimental.proxyClientMaxBodySize: the file uploads would be truncated. A form posted before the page is
      // hydrated carries no such header; next.config.ts sizes that copy like the Server Actions' own limit.
      missing: [{ type: 'header', key: 'next-action' }],
    },
  ],
};
