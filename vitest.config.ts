import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Tests live in tests/ and run in Node, without the Next.js server: tests/unit for pure rules, tests/integration on an
// in-memory PGlite database (tests/support/db.ts).
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
    // Opening PGlite (WebAssembly) takes a few seconds, more when several test files open one at once.
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
});
