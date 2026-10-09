import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@electric-sql/pglite'],
  experimental: {
    // File uploads (new documents, new versions) go through Server Actions.
    serverActions: { bodySizeLimit: '50mb' },
  },
};

export default nextConfig;
