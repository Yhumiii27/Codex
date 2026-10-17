import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  schemaFilter: ['codex'],
  migrations: { schema: 'codex', table: '__drizzle_migrations' },
});
