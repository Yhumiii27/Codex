import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Tests live in tests/ and run in Node, without the Next.js server.
export default defineConfig({
  resolve: {
    alias: [
      // Same alias as tsconfig.json.
      { find: /^@\//, replacement: `${here('./src')}/` },
      // 'server-only' throws outside a React Server Components build; in tests it is an empty module.
      { find: /^server-only$/, replacement: here('./tests/support/server-only.ts') },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
