import 'server-only';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './schema';
import { seed } from './seed';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

// Runtime data (database, uploaded files) lives outside the build output.
export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.CODEX_DATA_DIR ?? path.join(process.cwd(), '.data'));
export const FILES_DIR = path.join(DATA_DIR, 'files');

/**
 * The audit log is append-only: the database itself refuses UPDATE, DELETE and TRUNCATE on audit_log (statement-level
 * triggers, so even a statement touching no row fails). Installed at every start, after the migrations, rather than in
 * a migration: while there is no production database, drizzle/ is deleted and regenerated as a single migration
 * (CLAUDE.md), which would lose a hand-written statement. CREATE OR REPLACE makes it idempotent. It guards against the
 * application's own writes; whoever administers the database can still drop it.
 */
const AUDIT_APPEND_ONLY = `
create or replace function audit_log_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only: % refused', tg_op using errcode = 'insufficient_privilege';
end $$;
create or replace trigger audit_log_no_change before update or delete on audit_log for each statement execute function audit_log_append_only();
create or replace trigger audit_log_no_truncate before truncate on audit_log for each statement execute function audit_log_append_only();
`;

async function init(): Promise<Db> {
  await mkdir(FILES_DIR, { recursive: true });
  const client = new PGlite(path.join(DATA_DIR, 'pglite'));
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  await client.exec(AUDIT_APPEND_ONLY);
  const [{ n }] = (await client.query<{ n: number }>('select count(*)::int as n from users')).rows;
  if (n === 0) await seed(db);
  return db;
}

// One embedded database per server process; kept on globalThis so dev hot reloads reuse it.
const g = globalThis as unknown as { __codexDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  g.__codexDb ??= init().catch((err) => {
    g.__codexDb = undefined;
    throw err;
  });
  return g.__codexDb;
}

export { schema };
