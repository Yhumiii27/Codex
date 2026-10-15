import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import nextConfig from '../../next.config';
import { config, proxy } from '@/proxy';
import { contentSecurityPolicy, httpsEnabled, makeNonce, SECURITY_HEADERS } from '@/lib/security-headers';

// HTTP security headers (point 25 of docs/reste-a-faire.md): the policy of the pages (src/lib/security-headers.ts),
// drawn per request by src/proxy.ts, and the headers next.config.ts puts on every response.

const directives = (csp: string) => new Map(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));

describe('contentSecurityPolicy', () => {
  it('runs only Codex’s own scripts, those Next.js renders with the nonce and what they load', () => {
    const d = directives(contentSecurityPolicy({ nonce: 'abc123==' }));
    expect(d.get('script-src')).toEqual(["'self'", "'nonce-abc123=='", "'strict-dynamic'"]);
    expect(d.get('default-src')).toEqual(["'self'"]);
    expect(d.get('object-src')).toEqual(["'none'"]);
    expect(d.get('base-uri')).toEqual(["'self'"]);
    expect(d.get('form-action')).toEqual(["'self'"]);
  });

  it('allows what the screens load: inline styles, the self-hosted font, data: and blob: images, the framed file route', () => {
    const d = directives(contentSecurityPolicy({ nonce: 'n' }));
    expect(d.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d.get('font-src')).toEqual(["'self'"]);
    expect(d.get('img-src')).toEqual(["'self'", 'data:', 'blob:']);
    expect(d.get('connect-src')).toEqual(["'self'"]);
    expect(d.get('frame-src')).toEqual(["'self'"]);
  });

  it('lets only Codex itself frame its pages (the Mac app shows them as the top page)', () => {
    expect(directives(contentSecurityPolicy({ nonce: 'n' })).get('frame-ancestors')).toEqual(["'self'"]);
    expect(SECURITY_HEADERS).toContainEqual({ key: 'X-Frame-Options', value: 'SAMEORIGIN' });
  });

  it('adds eval in development only, and upgrade-insecure-requests over HTTPS only', () => {
    const prod = contentSecurityPolicy({ nonce: 'n' });
    expect(prod).not.toContain('unsafe-eval');
    expect(prod).not.toContain('upgrade-insecure-requests');
    expect(directives(contentSecurityPolicy({ nonce: 'n', dev: true })).get('script-src')).toContain("'unsafe-eval'");
    expect(directives(contentSecurityPolicy({ nonce: 'n', https: true })).has('upgrade-insecure-requests')).toBe(true);
  });

  it('never allows inline scripts', () => {
    for (const dev of [false, true]) {
      const d = directives(contentSecurityPolicy({ nonce: 'n', dev }));
      expect(d.get('script-src')).not.toContain("'unsafe-inline'");
      expect(d.get('default-src')).not.toContain("'unsafe-inline'");
    }
  });
});

describe('makeNonce and httpsEnabled', () => {
  it('draws a fresh nonce of the form Next.js reads', () => {
    const a = makeNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(makeNonce()).not.toBe(a);
  });

  it('HTTPS is off unless CODEX_HTTPS says so', () => {
    expect(httpsEnabled({})).toBe(false);
    expect(httpsEnabled({ CODEX_HTTPS: '' })).toBe(false);
    expect(httpsEnabled({ CODEX_HTTPS: '0' })).toBe(false);
    expect(httpsEnabled({ CODEX_HTTPS: '1' })).toBe(true);
    expect(httpsEnabled({ CODEX_HTTPS: 'true' })).toBe(true);
  });
});

describe('src/proxy.ts', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sends the policy with a fresh nonce, and hands the same policy to the rendering (request header)', () => {
    const res = proxy(new NextRequest('http://localhost:3100/documents/PRO-QUA-0001'));
    const csp = res.headers.get('content-security-policy')!;
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
    expect(res.headers.get('x-middleware-override-headers')).toContain('content-security-policy');
    const other = proxy(new NextRequest('http://localhost:3100/')).headers.get('content-security-policy')!;
    expect(/'nonce-([^']+)'/.exec(other)?.[1]).not.toBe(nonce);
  });

  it('sends HSTS and upgrade-insecure-requests only with CODEX_HTTPS', () => {
    const plain = proxy(new NextRequest('http://localhost:3100/'));
    expect(plain.headers.get('strict-transport-security')).toBeNull();
    expect(plain.headers.get('content-security-policy')).not.toContain('upgrade-insecure-requests');
    vi.stubEnv('CODEX_HTTPS', '1');
    const secure = proxy(new NextRequest('https://codex.example/'));
    expect(secure.headers.get('strict-transport-security')).toBe('max-age=31536000');
    expect(secure.headers.get('content-security-policy')).toContain('upgrade-insecure-requests');
  });

  it('runs on pages, not on the API nor the build’s static files', () => {
    const runs = (url: string) => unstable_doesMiddlewareMatch({ config, url });
    for (const page of ['/', '/documents/PRO-QUA-0001', '/recherche?q=pompe', '/administration', '/apiculture']) expect(runs(page), page).toBe(true);
    for (const other of ['/api/registry', '/api/documents/PRO-QUA-0001/file', '/_next/static/chunks/main.js', '/_next/image?url=x', '/favicon.ico']) expect(runs(other), other).toBe(false);
  });

  it('lets the Server Action calls through untouched: the proxy would copy their bodies, uploads included, into memory', () => {
    const action = { 'next-action': '7f3a9c', 'content-type': 'multipart/form-data; boundary=x' };
    for (const page of ['/', '/documents/CTR-JUR-0001', '/documents/nouveau']) {
      expect(unstable_doesMiddlewareMatch({ config, url: page, headers: action }), page).toBe(false);
      // The same page, posted as a plain form before hydration: still a page, still its policy.
      expect(unstable_doesMiddlewareMatch({ config, url: page, headers: { 'content-type': 'multipart/form-data; boundary=x' } }), page).toBe(true);
    }
  });
});

describe('next.config.ts', () => {
  it('puts nosniff, the referrer and framing rules and the permissions policy on every response', async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === '/:path*')!;
    const byKey = new Map(all.headers.map((h) => [h.key, h.value]));
    expect(byKey.get('X-Content-Type-Options')).toBe('nosniff');
    expect(byKey.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(byKey.get('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(byKey.get('Permissions-Policy')).toMatch(/camera=\(\).*microphone=\(\).*geolocation=\(\)/);
    // HSTS never by default: it would force HTTPS on every app of localhost.
    expect(byKey.has('Strict-Transport-Security')).toBe(false);
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it('the proxy’s copy of a request body holds a whole Server Action upload (otherwise cut at 10 MB, silently)', () => {
    const UNIT: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
    const size = (v: string | number | undefined) => {
      if (typeof v === 'number') return v;
      const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/i.exec(v ?? '');
      return m ? Number(m[1]) * UNIT[m[2].toLowerCase()] : NaN;
    };
    const actions = size(nextConfig.experimental?.serverActions?.bodySizeLimit);
    const proxyCopy = size(nextConfig.experimental?.proxyClientMaxBodySize);
    expect(actions).toBeGreaterThanOrEqual(50 * 1024 ** 2);
    expect(proxyCopy).toBeGreaterThanOrEqual(actions);
  });
});
