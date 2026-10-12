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

/**
 * documents.version follows every change of a document's row, whatever path writes it (metadata, lifecycle, Vigie,
 * hold, archive): one step per UPDATE that changes something. A statement that sets the version itself still moves it
 * by one step. The record's dialogs send it back to detect concurrent edits (lib/concurrency.ts).
 * An UPDATE that leaves the row as it was is skipped, as Postgres' suppress_redundant_updates_trigger does: the row
 * keeps its version and the transaction that last changed it (its xmin), whose journal entries name who changed it
 * (lib/actions.ts lastChangedBy). Installed at every start, like the journal's triggers.
 */
const DOCUMENT_VERSION = `
create or replace function documents_version() returns trigger language plpgsql as $$
begin
  if new is not distinct from old then
    return null;
  end if;
  new.version := old.version + 1;
  return new;
end $$;
create or replace trigger documents_version before update on documents for each row execute function documents_version();
`;

/**
 * Opens a database with the schema of drizzle/, the append-only journal and the version of documents, but no data: on
 * disk under `dataDir`, or in memory without one. getDb() opens the application's database with it and seeds it;
 * integration tests (tests/integration) open throwaway in-memory databases with it, so they run against the same
 * schema and triggers.
 */
export async function openDb(dataDir?: string): Promise<Db> {
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  await client.exec(AUDIT_APPEND_ONLY);
  await client.exec(DOCUMENT_VERSION);
  return db;
}

async function init(): Promise<Db> {
  await mkdir(FILES_DIR, { recursive: true });
  const db = await openDb(path.join(DATA_DIR, 'pglite'));
  const [{ n }] = (await db.$client.query<{ n: number }>('select count(*)::int as n from users')).rows;
  if (n === 0) await seed(db);
  return db;
}

// One embedded database per server process; kept on globalThis so dev hot reloads reuse it. Integration tests mock
// getDb() to hand the code under test their in-memory database from openDb() (tests/support/db.ts, currentDb).
const g = globalThis as unknown as { __codexDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  g.__codexDb ??= init().catch((err) => {
    g.__codexDb = undefined;
    throw err;
  });
  return g.__codexDb;
}

export { schema };
