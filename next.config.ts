import type { NextConfig } from 'next';
import { SECURITY_HEADERS } from './src/lib/security-headers';

/**
 * Largest request body of a Server Action: file uploads (new documents, new versions) go through them. The proxy
 * (src/proxy.ts) copies the body of the requests it sees into memory up to proxyClientMaxBodySize and silently drops
 * the rest; Server Action calls skip it, but a form posted before the page is hydrated does not, hence the same size.
 */
const ACTION_BODY_LIMIT = '50mb';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@electric-sql/pglite'],
  poweredByHeader: false,
  experimental: {
    serverActions: { bodySizeLimit: ACTION_BODY_LIMIT },
    proxyClientMaxBodySize: ACTION_BODY_LIMIT,
  },
  // On every response; the pages' Content-Security-Policy and HSTS come from src/proxy.ts.
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
