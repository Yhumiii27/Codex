import type { NextConfig } from 'next';
import { maxFileBytes } from './src/lib/filetypes';
import { SECURITY_HEADERS } from './src/lib/security-headers';

/**
 * Largest request body of a Server Action: file uploads (new documents, new versions) go through them. It is the largest
 * file (CODEX_MAX_FILE_MB, the same for every entry: src/lib/filetypes.ts), plus room for the other fields of the form,
 * so that a file over the limit gets the explicit refusal of stageFile rather than the framework's. The proxy
 * (src/proxy.ts) copies the body of the requests it sees into memory up to proxyClientMaxBodySize and silently drops
 * the rest; Server Action calls skip it, but a form posted before the page is hydrated does not, hence the same size.
 * Read when the server starts (next dev, next start).
 */
const ACTION_BODY_LIMIT = maxFileBytes(process.env) + 1024 * 1024;

const nextConfig: NextConfig = {
  serverExternalPackages: ['@electric-sql/pglite'],
  poweredByHeader: false,
  experimental: {
    // No Turbopack cache on disk for next dev (on by default since Next.js 16, .next/dev/cache/turbopack). Restored on a
    // start after the sources changed, it made the client runtime's HMR subscription answer every new page with a
    // "restart" update: the page reloaded about three times a second until the cache settled (docs/historique.md §18.1).
    // Each start compiles the screens again; next build keeps its own cache.
    turbopackFileSystemCacheForDev: false,
    serverActions: { bodySizeLimit: ACTION_BODY_LIMIT },
    proxyClientMaxBodySize: ACTION_BODY_LIMIT,
  },
  // On every response; the pages' Content-Security-Policy and HSTS come from src/proxy.ts.
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
