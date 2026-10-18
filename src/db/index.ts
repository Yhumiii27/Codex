import 'server-only';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle as drizzleServer } from 'drizzle-orm/node-postgres';
import { migrate as migrateServer } from 'drizzle-orm/node-postgres/migrator';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import { backupDirOf, createBackup, journal, journalData, keepOf, lockForServer, readMigrations } from '../lib/backup-core.mjs';
import { logger } from '../lib/log';
import { seedModeOf } from '../lib/seed-mode';
import { appVersion } from '../lib/version';
import { appliedMigrations, migrationPlan, type MigrationPlan } from './migrations';
import * as schema from './schema';
import { seed } from './seed';
import { databaseUrlOf, embedded, PgServerClient, poolMaxOf, redactUrl, serverPool, type SqlClient, type SqlQueryable } from './sql-client';

/**
 * Codex's drizzle database, on PGlite (default) or on a PostgreSQL server (DATABASE_URL): the same schema, migrations,
 * functions and triggers, and the same query builder. Typed as PGlite's, whose results (`rows`) node-postgres' share;
 * $client is the raw connection of either (src/db/sql-client.ts), never PGlite's own API (embedded() reaches it).
 */
export type Db = Omit<PgliteDatabase<typeof schema>, '$client'> & { $client: SqlClient };
export type { SqlClient } from './sql-client';

// Runtime data (database, uploaded files) lives outside the build output.
export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.CODEX_DATA_DIR ?? path.join(process.cwd(), '.data'));
export const FILES_DIR = path.join(DATA_DIR, 'files');
/** The migrations of the code (versioned, never regenerated: src/db/migrations.ts). */
export const MIGRATIONS_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), 'drizzle');

const log = logger('db');

/**
 * The audit log is append-only: the database itself refuses UPDATE, DELETE and TRUNCATE on audit_log (statement-level
 * triggers, so even a statement touching no row fails). Installed at every start, after the migrations, rather than in
 * a migration: drizzle-kit does not know functions and triggers (its snapshots, and the check that the migrations give
 * the schema, leave them out), and CREATE OR REPLACE applies their latest version to every database, new or existing,
 * without a migration. Idempotent. It guards against the application's own writes; whoever administers the database can
 * still drop it. A migration must therefore never drop or rename what these statements refer to without changing them.
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
 * Text search on the record (/recherche, lib/queries.ts searchDocs).
 * codex_fold folds a text as lib/search.ts fold does: canonical decomposition (NFD), combining accents U+0300–U+036F
 * removed, then lower case by the Unicode rules the database carries (pg_unicode_fast: full case mapping, a capital
 * sigma ending a word becomes a final sigma), as JavaScript's toLowerCase does. codex_unbom drops a leading byte order
 * mark from a text column: PGlite's decoder drops it from every text value it hands back, so the application never
 * sees it (the values inside a jsonb keep theirs). tests/integration/search-sql.test.ts compares codex_fold with fold
 * on every code point: it tells when another version of Node or PGlite parts them.
 * The trigger documents_terms writes the folded values of a document into document_terms, at its insertion and
 * whenever a searched column changes (an update documents_version skips fires nothing). Its fields are the groups of
 * lib/search.ts score(): id (ID, former IDs), title, keyword, ref (external reference, study ID), other (subtype,
 * source organisation, free-text author); empty values are left out, as score() skips them.
 * codex_fr orders titles and IDs as lib/search.ts does (Intl.Collator 'fr', numeric, base sensitivity): ICU, numbers
 * by value, case and accents ignored, and nondeterministic so that two titles it finds equal keep the order of the
 * other keys, as a stable sort would. PGlite's ICU reads its options in ICU form, not as BCP 47 -u- keywords.
 * Installed at every start, like the journal's triggers; the pg_trgm extension is created before the migrations,
 * which index document_terms with it.
 */
const DOCUMENT_SEARCH = `
create or replace function codex_unbom(t text) returns text language sql immutable strict parallel safe as $$
  select case when left(t, 1) = chr(65279) then substr(t, 2) else t end
$$;
create or replace function codex_fold(t text) returns text language sql immutable strict parallel safe as $$
  select lower(regexp_replace(normalize(t, nfd), '[\\u0300-\\u036f]', '', 'g') collate pg_unicode_fast)
$$;
create or replace function documents_terms() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if (new.id, new.aliases, new.title, new.keywords, new.external_ref, new.study_id, new.subtype, new.source_org, new.author_text)
      is not distinct from (old.id, old.aliases, old.title, old.keywords, old.external_ref, old.study_id, old.subtype, old.source_org, old.author_text) then
      return null;
    end if;
    delete from document_terms where doc_id in (old.id, new.id);
  end if;
  insert into document_terms (doc_id, field, term)
  select distinct new.id, v.field, codex_fold(v.value)
  from (
    select * from (values
      ('id', codex_unbom(new.id)), ('title', codex_unbom(new.title)), ('ref', codex_unbom(new.external_ref)), ('ref', codex_unbom(new.study_id)),
      ('other', codex_unbom(new.subtype)), ('other', codex_unbom(new.source_org)), ('other', codex_unbom(new.author_text))
    ) as x(field, value)
    union all select 'id', a from jsonb_array_elements_text(new.aliases) a
    union all select 'keyword', k from jsonb_array_elements_text(new.keywords) k
  ) v
  where v.value <> '';
  return null;
end $$;
create or replace trigger documents_terms after insert or update on documents for each row execute function documents_terms();
create collation if not exists codex_fr (provider = icu, locale = 'fr@colNumeric=yes;colStrength=primary', deterministic = false);
`;

type OpenOptions = {
  /** Runs before the pending migrations are applied, when there are some (the backup of init()). */
  beforeMigrate?: (client: SqlClient, plan: MigrationPlan) => Promise<void>;
};

/** Where a database is: a PGlite data directory (undefined: in memory), or a PostgreSQL server. */
export type DbTarget = string | undefined | { url: string };

/**
 * Opens a database with the schema of drizzle/, the append-only journal, the version of documents and their search
 * terms, but no data: PGlite on disk under a data directory, or in memory without one; or a PostgreSQL server (`{ url }`).
 * getDb() opens the application's database with it and seeds it; integration tests (tests/integration) open throwaway
 * in-memory databases with it, so they run against the same schema and triggers. With CODEX_TEST_DATABASE_URL set (the
 * address of a PostgreSQL server whose user may create databases), the in-memory database of a test is instead a new
 * database on that server, dropped when it is closed: `npm run test:pg` runs the whole suite on PostgreSQL that way.
 */
export async function openDb(target?: DbTarget, opts: OpenOptions = {}): Promise<Db> {
  if (typeof target === 'object') return openServer(target.url, opts);
  const testServer = target === undefined ? process.env.CODEX_TEST_DATABASE_URL?.trim() : '';
  if (testServer) {
    const t = await throwawayDatabase(testServer);
    return openServer(t.url, opts, t.drop).catch(async (err) => {
      await t.drop().catch(() => {});
      throw err;
    });
  }
  const client = new PGlite({ dataDir: target, extensions: { pg_trgm } });
  const db = drizzle(client, { schema }) as unknown as Db;
  try {
    await client.exec('create extension if not exists pg_trgm');
    // Refuses a database made by another schema before drizzle replays anything on it (src/db/migrations.ts).
    const plan = migrationPlan(await appliedMigrations(client), await readMigrations(MIGRATIONS_DIR));
    if (plan.pending.length && opts.beforeMigrate) await opts.beforeMigrate(client, plan);
    // All pending migrations in one transaction: a failure leaves the database as it was.
    await migrate(db as unknown as PgliteDatabase<typeof schema>, { migrationsFolder: MIGRATIONS_DIR });
  } catch (err) {
    await client.close().catch(() => {});
    throw err;
  }
  await installCompanions(client);
  return db;
}

/** The functions, triggers and collation every start lays (statements above), in that order. */
async function installCompanions(q: SqlQueryable): Promise<void> {
  await q.exec(AUDIT_APPEND_ONLY);
  await q.exec(DOCUMENT_VERSION);
  await q.exec(DOCUMENT_SEARCH);
}

/**
 * PostgreSQL 18 at least: codex_fold folds case with the pg_unicode_fast collation (built-in provider, PostgreSQL 18),
 * as PGlite 0.5 (PostgreSQL 18) does; an older server would fold differently from lib/search.ts, or not at all.
 */
const SERVER_MIN_VERSION = 180000;

/** Key of the session lock under which one Codex process at a time migrates a server and lays its functions. */
const MIGRATION_LOCK = `select pg_advisory_lock(hashtext('codex:migrate'))`;

/**
 * A PostgreSQL server (DATABASE_URL): a pool of connections, the same migrations and the same functions and triggers as
 * PGlite. Several Codex processes may start on the same database at once: the first takes a session lock (advisory),
 * checks and migrates the database and lays the functions, the others wait for it, then find nothing left to do.
 * Needs PostgreSQL 18 or later, ICU (the codex_fr collation) and the pg_trgm extension (contrib), which the user must be
 * allowed to create (trusted extension: the owner of the database may) unless it is already there.
 */
async function openServer(url: string, opts: OpenOptions, onClose?: () => Promise<void>): Promise<Db> {
  const pool = serverPool(url, poolMaxOf(process.env));
  // An idle connection the server drops (restart, network) emits 'error' on the pool: logged, the pool opens another.
  pool.on('error', (err) => log.warn('database connection lost', { err }));
  const client = new PgServerClient(pool, onClose);
  const db = drizzleServer(pool, { schema });
  Object.defineProperty(db, '$client', { value: client, enumerable: true });
  const conn = await pool.connect().catch(async (err: unknown) => {
    await client.close().catch(() => {});
    throw new Error(`the PostgreSQL server of DATABASE_URL (${redactUrl(url)}) cannot be reached: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  });
  let broken = false;
  try {
    const [{ v }] = (await conn.query<{ v: number }>(`select current_setting('server_version_num')::int as v`)).rows;
    if (Number(v) < SERVER_MIN_VERSION) throw new Error(`Codex needs PostgreSQL 18 or later (the server of DATABASE_URL is ${Math.floor(Number(v) / 10000)}): codex_fold uses the pg_unicode_fast collation`);
    await conn.query(MIGRATION_LOCK);
    const locked = { query: async <T,>(text: string, params?: unknown[]) => ({ rows: (await conn.query(text, params)).rows as T[] }), exec: (text: string) => conn.query(text) };
    await locked.exec('create extension if not exists pg_trgm');
    const plan = migrationPlan(await appliedMigrations(locked), await readMigrations(MIGRATIONS_DIR));
    if (plan.pending.length && opts.beforeMigrate) await opts.beforeMigrate(client, plan);
    await migrateServer(db, { migrationsFolder: MIGRATIONS_DIR });
    await installCompanions(locked);
    await conn.query(`select pg_advisory_unlock(hashtext('codex:migrate'))`);
  } catch (err) {
    broken = true;
    throw err;
  } finally {
    // A connection left with the lock (an error) is closed rather than handed back to the pool, which frees the lock.
    conn.release(broken);
    if (broken) await client.close().catch(() => {});
  }
  return db as unknown as Db;
}

/**
 * A new, empty database on the server of `adminUrl` (CODEX_TEST_DATABASE_URL), for one test file: its address, and
 * drop() which removes it (WITH (FORCE): connections a failed test left open are closed).
 */
async function throwawayDatabase(adminUrl: string): Promise<{ url: string; drop: () => Promise<void> }> {
  const name = `codex_test_${process.pid}_${Math.random().toString(36).slice(2, 10)}`;
  const admin = async (statement: string) => {
    const c = new pg.Client({ connectionString: adminUrl });
    await c.connect();
    try {
      await c.query(statement);
    } finally {
      await c.end();
    }
  };
  await admin(`create database ${name}`);
  const u = new URL(adminUrl);
  u.pathname = `/${name}`;
  return { url: u.toString(), drop: () => admin(`drop database if exists ${name} with (force)`) };
}

/**
 * Before migrating a database that holds data, an archive of it and of its files (lib/backup-core.mjs, as
 * Administration › Sauvegardes writes them): the way back from a migration that went through but turned out wrong is
 * `npm run restore` of that archive with the version of Codex that made it (docs/sauvegarde.md). A failed migration
 * needs none: drizzle applies them in one transaction. When the archive cannot be written, the server does not start
 * and the database is left as it was; CODEX_MIGRATION_BACKUP=off migrates without it.
 */
async function backUpBeforeMigrating(client: SqlClient, plan: MigrationPlan): Promise<{ name: string; data: Record<string, unknown> } | null> {
  if (plan.fresh) return null;
  if (/^(0|false|off|no)$/i.test(process.env.CODEX_MIGRATION_BACKUP?.trim() ?? '')) {
    log.warn('migrating without a backup (CODEX_MIGRATION_BACKUP=off)', { pending: plan.pending });
    return null;
  }
  // Codex's archives copy PGlite's data directory; a PostgreSQL server is backed up by its own tools (pg_dump, the
  // host's snapshots: not decided, M22). Its migration waits for whoever runs it to say a backup was made.
  const pglite = embedded(client);
  if (!pglite) {
    throw new Error(`migrations ${plan.pending.join(', ')} are pending on the PostgreSQL server of DATABASE_URL, and Codex cannot back up a server database (docs/postgres.md). The database was not changed. Back it up (pg_dump), then start Codex once with CODEX_MIGRATION_BACKUP=off`);
  }
  const res = await createBackup({
    pg: pglite, filesDir: FILES_DIR, dbDir: path.join(DATA_DIR, 'pglite'), backupDir: backupDirOf(DATA_DIR, process.env), keep: keepOf(process.env),
    mode: 'online', by: 'codex', migrations: await readMigrations(MIGRATIONS_DIR), app: await appVersion(),
  }).catch((err: unknown) => {
    throw new Error(`no backup could be written before migrating (${plan.pending.join(', ')}): ${err instanceof Error ? err.message : String(err)}. The database was not changed. Correct CODEX_BACKUP_DIR, or set CODEX_MIGRATION_BACKUP=off to migrate without a backup`, { cause: err });
  });
  log.info('backup written before migrating', { path: res.path, pending: plan.pending });
  return { name: res.name, data: journalData(res.manifest, res) };
}

async function init(): Promise<Db> {
  await mkdir(FILES_DIR, { recursive: true });
  // codex.lock: the backup and restore commands (npm run backup, npm run restore) refuse to run while this process holds
  // the database, and this process refuses to open it while one of them works on it (lib/backup-core.mjs).
  await lockForServer(DATA_DIR);
  // The archive written before migrating, journaled once the migrations are applied (the journal's own table may change).
  const before: { archive: { name: string; data: Record<string, unknown> } | null; pending: string[] } = { archive: null, pending: [] };
  const url = databaseUrlOf(process.env);
  if (url) log.info('database: PostgreSQL server', { url: redactUrl(url) });
  const db = await openDb(url ? { url } : path.join(DATA_DIR, 'pglite'), {
    beforeMigrate: async (client, plan) => {
      before.archive = await backUpBeforeMigrating(client, plan);
      before.pending = plan.pending;
    },
  });
  if (before.archive) await journal(db.$client, 'backup_created', before.archive.name, before.archive.data, `migration ${before.pending.join(', ')}`);
  await seedIfEmpty(db);
  return db;
}

/**
 * Seeded once, when nothing is there yet: neither a person nor a type (CODEX_SEED, lib/seed-mode.ts). On a server,
 * under a session lock, so that two processes starting on a new database do not both seed it.
 */
async function seedIfEmpty(db: Db): Promise<void> {
  const run = async () => {
    const [{ n }] = (await db.$client.query<{ n: number }>('select ((select count(*) from users) + (select count(*) from doc_types))::int as n')).rows;
    if (Number(n) !== 0) return;
    const mode = seedModeOf(process.env);
    if (!mode) throw new Error(`CODEX_SEED="${process.env.CODEX_SEED}" is neither demo nor minimal: the new database was left empty`);
    await seed(db, mode);
    log.info('new database seeded', { mode });
  };
  if (!(db.$client instanceof PgServerClient)) return run();
  const s = await db.$client.session();
  let failed = true;
  try {
    await s.exec(`select pg_advisory_lock(hashtext('codex:seed'))`);
    await run();
    await s.exec(`select pg_advisory_unlock(hashtext('codex:seed'))`);
    failed = false;
  } finally {
    // After an error the connection may still hold the lock: closed rather than handed back to the pool.
    s.release(failed);
  }
}

// One database per server process (PGlite, or a pool of server connections); kept on globalThis so dev hot reloads
// reuse it. Integration tests mock getDb() to hand the code under test their in-memory database from openDb()
// (tests/support/db.ts, currentDb).
const g = globalThis as unknown as { __codexDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  g.__codexDb ??= init().catch((err) => {
    g.__codexDb = undefined;
    throw err;
  });
  return g.__codexDb;
}

export { schema };
