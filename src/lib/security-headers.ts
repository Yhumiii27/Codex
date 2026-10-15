// HTTP security headers (point 25 of docs/reste-a-faire.md). No 'server-only': next.config.ts and src/proxy.ts import
// it, outside the React Server Components build.
//
// - SECURITY_HEADERS go on every response, through next.config.ts headers(). A route may still set its own value (the
//   file route sets nosniff itself, its Content-Disposition is untouched).
// - The Content-Security-Policy goes on pages only, through src/proxy.ts, with a nonce drawn for each request: Next.js
//   reads it from the request's policy and puts it on its own scripts (node_modules/next/dist/docs/01-app/02-guides/
//   content-security-policy.md). Every page is rendered per request (the root layout reads the session cookies), so
//   every page gets it. API responses (JSON, stored files) carry no policy: nothing in them runs, and a policy on a
//   PDF can stop the browser's own viewer from showing it in the document preview.

/** Headers sent with every response. */
export const SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Other origins (Keystone, Vigie, the web) get the origin only, never the path, which names documents.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Same as frame-ancestors 'self', for browsers that ignore it. The Mac app opens Codex as the top page of its web
  // view (desktop/CodexApp.swift), which no framing rule concerns; the document preview frames the file route, same origin.
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  // Features Codex never uses.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()' },
];

/** HSTS lifetime once CODEX_HTTPS is set: one year, this host only (other apps of the group may live on subdomains). */
export const HSTS = 'max-age=31536000';

/**
 * CODEX_HTTPS=1: Codex is served over HTTPS (behind a TLS reverse proxy). Off by default: locally and in the Mac app it
 * is plain HTTP, and HSTS on localhost would force HTTPS on every local app (Keystone on :3000, Vigie on :3200).
 */
export function httpsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|on|yes)$/i.test(env.CODEX_HTTPS?.trim() ?? '');
}

/** A fresh nonce: 16 random bytes in base64, the form Next.js looks for in the policy. */
export function makeNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * The policy of a page. What Codex loads: its own scripts (Next.js runtime and chunks, nonce and 'strict-dynamic');
 * its own style sheets plus style attributes and the style elements React and Next.js insert ('unsafe-inline' for
 * styles only); the Inter font self-hosted by next/font; images from the file route, data: and blob:; the file route
 * framed by the document preview. `dev`: React's development build needs eval, and the dev server's hot reload its
 * own WebSocket ('self' covers ws: on the same host in current browsers).
 */
export function contentSecurityPolicy({ nonce, dev = false, https = false }: { nonce: string; dev?: boolean; https?: boolean }): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}
