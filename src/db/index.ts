import 'server-only';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzleServer } from 'drizzle-orm/node-postgres';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import pg from 'pg';
import { backupDirOf, createBackup, journal, journalData, keepOf, lockForServer, readMigrations } from '../lib/backup-core.mjs';
import { logger } from '../lib/log';
import { pgliteOptions } from '../lib/pglite-options.mjs';
import { declarerSchemaCodex } from '../lib/matrix';
import { seedModeOf } from '../lib/seed-mode';
import { appVersion } from '../lib/version';
import { applyMigrations, planFor, readLayout, SERVER_PLAN, type MigrationPlan } from './migrations';
import * as schema from './schema';
import { DB_SCHEMA } from './schema';
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

/** Set by Next.js while `next build` runs (node_modules/next/dist/docs: NEXT_PHASE). */
const BUILDING = process.env.NEXT_PHASE === 'phase-production-build';

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
 * removed, then lower case by full Unicode case mapping (a capital sigma ending a word becomes a final sigma, ẞ becomes
 * ß), as JavaScript's toLowerCase does, under the collation foldCollation() picks: pg_unicode_fast (built-in provider,
 * PostgreSQL 18 and PGlite 0.5), or the ICU root collation "und-x-icu" on PostgreSQL 16 and 17 (ICU's case mapping,
 * the same rules; the shared EPC2I server stays on PostgreSQL 16, Matrix decision P-01). codex_unbom drops a leading
 * byte order mark from a text column: PGlite's decoder drops it from every text value it hands back, so the
 * application never sees it (the values inside a jsonb keep theirs). tests/integration/search-sql.test.ts compares codex_fold with fold
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
const documentSearch = (foldCollation: string) => `
create or replace function codex_unbom(t text) returns text language sql immutable strict parallel safe as $$
  select case when left(t, 1) = chr(65279) then substr(t, 2) else t end
$$;
create or replace function codex_fold(t text) returns text language sql immutable strict parallel safe as $$
  select lower(regexp_replace(normalize(t, nfd), '[\\u0300-\\u036f]', '', 'g') collate ${foldCollation})
$$;
create or replace function documents_terms() returns trigger language plpgsql set search_path = codex as $$
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
  const client = new PGlite(pgliteOptions(target));
  const db = drizzle(client, { schema }) as unknown as Db;
  try {
    // Refuses a database made by another schema, or by the former layout when it cannot be taken up, before anything
    // is changed in it (src/db/migrations.ts).
    const plan = planFor(await readLayout(client), await readMigrations(MIGRATIONS_DIR), { embedded: true, remedy: pgliteRemedy(target) });
    if (plan.pending.length && opts.beforeMigrate) await opts.beforeMigrate(client, plan);
    // The take-up, the schema codex and pg_trgm (in it: gin_trgm_ops resolves through search_path), then all pending
    // migrations, in one transaction: a failure leaves the database as it was.
    await client.transaction(async (tx) => {
      if (!plan.takeUp) await tx.exec(`create schema if not exists ${DB_SCHEMA}`);
      await applyMigrations(tx, MIGRATIONS_DIR, plan, () => tx.exec(`create extension if not exists pg_trgm schema ${DB_SCHEMA}`));
    });
    if (plan.takeUp) log.info('database taken up into the schema codex (tables formerly in public)', { pending: plan.pending });
  } catch (err) {
    await client.close().catch(() => {});
    throw err;
  }
  await installCompanions(client);
  return db;
}

/** What to do with a PGlite database that cannot be opened by this code (start over: the data is lost, the files kept). */
function pgliteRemedy(target: string | undefined): string {
  if (!target || target.startsWith('memory://')) return 'start over with an empty database';
  // Application Mac and images: CODEX_DATA_DIR names the data directory (~/Library/Application Support/Codex/data, /data).
  return process.env.CODEX_DATA_DIR
    ? `stop Codex, delete ${target} (the uploaded files beside it are kept; the data of that database is lost unless exported first with the version that made it), then start it again`
    : `npm run db:reset (deletes ${target}), or restore a backup made with this version (npm run restore)`;
}

/** The functions, triggers and collation every start lays (statements above), in that order. */
async function installCompanions(q: SqlQueryable): Promise<void> {
  await q.exec(AUDIT_APPEND_ONLY);
  await q.exec(DOCUMENT_VERSION);
  await q.exec(documentSearch(await foldCollation(q)));
}

/**
 * The collation under which codex_fold lowers case, chosen at every start by what the database has: pg_unicode_fast
 * (PostgreSQL 18, PGlite 0.5), else the ICU root collation "und-x-icu" (PostgreSQL 16 and 17 built with ICU, which
 * codex_fr needs anyway). Both apply Unicode's full case mapping with the final sigma, as JavaScript's toLowerCase;
 * pg_c_utf8 (PostgreSQL 17) and the libc collations map one code point to one and know no final sigma: never used.
 * They part from lib/search.ts only on code points their version of Unicode does not assign yet (ICU 72 of Debian 12:
 * Unicode 15.0, against 16.0 in Node 22 and PGlite 0.5), which the database folds alike in the query and the values
 * (docs/postgres.md, « Repli de la recherche »).
 */
async function foldCollation(q: SqlQueryable): Promise<string> {
  const { rows: [c] } = await q.query<{ fast: boolean; icu: boolean }>(`select
    exists (select from pg_collation where collname = 'pg_unicode_fast' and collnamespace = 'pg_catalog'::regnamespace) as fast,
    exists (select from pg_collation where collname = 'und-x-icu' and collnamespace = 'pg_catalog'::regnamespace) as icu`);
  if (c.fast) return 'pg_catalog.pg_unicode_fast';
  if (c.icu) return 'pg_catalog."und-x-icu"';
  throw new Error('the database has neither the pg_unicode_fast collation (PostgreSQL 18) nor the ICU collation "und-x-icu": Codex needs a PostgreSQL server built with ICU');
}

/**
 * PostgreSQL 16 at least (the shared EPC2I server, Matrix decision P-01): normalize() (13), the ICU collations
 * codex_fr and "und-x-icu" whose lower() codex_fold uses below 18, and what the migrations and queries use.
 */
const SERVER_MIN_VERSION = 160000;

/**
 * Key of the session lock under which one Codex process at a time migrates a server and lays its functions. Derived from
 * the schema's name, as every tool of the shared server derives its own (Matrix, docs/architecture-postgres.md § 4.3).
 */
const MIGRATION_LOCK_KEY = `${DB_SCHEMA}.migrations`;

/**
 * A PostgreSQL server (DATABASE_URL): a pool of connections whose search_path is codex, the same migrations and the
 * same functions and triggers as PGlite. Several Codex processes may start on the same database at once: the first
 * takes a session lock (advisory), checks and migrates the database and lays the functions, the others wait for it,
 * then find nothing left to do. Needs PostgreSQL 16 or later, ICU (the codex_fr collation, codex_fold below 18), the
 * schema codex, which Codex may create objects in but never creates (the shared server: Matrix, infra/postgres/init/02-schemas.sql), and
 * the pg_trgm extension (contrib): already installed (on the shared server, by its superuser), or created here in the
 * schema codex when the role may (the owner of a database of one's own).
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
    if (Number(v) < SERVER_MIN_VERSION) throw new Error(`Codex needs PostgreSQL 16 or later (the server of DATABASE_URL is ${Math.floor(Number(v) / 10000)})`);
    const [own] = (await conn.query<{ found: boolean; usable: boolean }>(`select exists (select from pg_namespace where nspname = $1) as found,
      coalesce(has_schema_privilege($1, 'USAGE') and has_schema_privilege($1, 'CREATE'), false) as usable`, [DB_SCHEMA])).rows;
    if (!own.found || !own.usable) {
      throw new Error(own.found
        ? `the role of DATABASE_URL (${redactUrl(url)}) may not create objects in the schema ${DB_SCHEMA}: it must own it (shared server: role codex_app, Matrix infra/postgres/init/02-schemas.sql)`
        : `the database of DATABASE_URL (${redactUrl(url)}) has no schema ${DB_SCHEMA}. Codex never creates it: on the shared EPC2I server it is laid by Matrix (infra/postgres/init/02-schemas.sql); on a server of one's own, run CREATE SCHEMA ${DB_SCHEMA} AUTHORIZATION <Codex's role> once`);
    }
    await conn.query(`select pg_advisory_lock(hashtext($1))`, [MIGRATION_LOCK_KEY]);
    const locked: SqlQueryable = { query: async <T,>(text: string, params?: unknown[]) => ({ rows: (await conn.query(text, params)).rows as T[] }), exec: (text: string) => conn.query(text) };
    const plan = planFor(await readLayout(locked), await readMigrations(MIGRATIONS_DIR), SERVER_PLAN);
    if (plan.pending.length && opts.beforeMigrate) await opts.beforeMigrate(client, plan);
    if (plan.pending.length) {
      await locked.exec('begin');
      try {
        await applyMigrations(locked, MIGRATIONS_DIR, plan, () => trigramsReady(locked));
        await locked.exec('commit');
      } catch (err) {
        await locked.exec('rollback').catch(() => {});
        throw err;
      }
    }
    await installCompanions(locked);
    await conn.query(`select pg_advisory_unlock(hashtext($1))`, [MIGRATION_LOCK_KEY]);
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
 * pg_trgm for the migrations (gin_trgm_ops of document_terms), in the migration's transaction. Installed already: its
 * schema is added to this transaction's search_path when it is not codex (the shared server: a schema `extensions` of
 * its superuser, which Codex's role may use; in codex, its functions would be open to every tool, which
 * droits.verifier() refuses). Missing: created in the schema codex when the role may (a database of one's own); the
 * shared server's codex_app may not (no CREATE on the database): its superuser installs it once.
 */
async function trigramsReady(tx: SqlQueryable): Promise<void> {
  const [ext] = (await tx.query<{ schema: string; usable: boolean }>(`select n.nspname as schema, has_schema_privilege(n.oid, 'USAGE') as usable
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm'`)).rows;
  if (ext) {
    if (ext.schema === DB_SCHEMA) return;
    if (!ext.usable) throw new Error(`the pg_trgm extension is installed in the schema ${ext.schema}, which Codex's role may not use: as superuser, ALTER EXTENSION pg_trgm SET SCHEMA ${DB_SCHEMA}, or GRANT USAGE ON SCHEMA ${ext.schema} to Codex's role`);
    await tx.exec(`set local search_path to ${DB_SCHEMA}, ${ext.schema}`);
    return;
  }
  await tx.exec('savepoint codex_trgm');
  try {
    await tx.exec(`create extension pg_trgm schema ${DB_SCHEMA}`);
  } catch (err) {
    await tx.exec('rollback to savepoint codex_trgm');
    throw new Error(`the pg_trgm extension is missing from the database of DATABASE_URL and Codex's role may not create it (${err instanceof Error ? err.message : String(err)}). As superuser, once: CREATE SCHEMA IF NOT EXISTS extensions; REVOKE ALL ON SCHEMA extensions FROM PUBLIC; GRANT USAGE ON SCHEMA extensions TO <Codex's role>; CREATE EXTENSION pg_trgm SCHEMA extensions; (docs/postgres.md, « Serveur commun »)`, { cause: err });
  }
}

/**
 * A new, empty database on the server of `adminUrl` (CODEX_TEST_DATABASE_URL), for one test file, laid out as the
 * shared EPC2I server lays Codex's (Matrix, infra/postgres/init): a role of its own that owns the schema codex and
 * nothing else, without CREATE on the database nor TEMPORARY, public closed, search_path codex, pg_trgm in a schema
 * `extensions` of the superuser that the role may use (docs/postgres.md). Its
 * address (that role's), and drop() which removes database and role (WITH (FORCE): connections a failed test left open
 * are closed). The admin user must be a superuser (role, extension); otherwise the test connects as that user, to a
 * schema codex it owns.
 */
async function throwawayDatabase(adminUrl: string): Promise<{ url: string; drop: () => Promise<void> }> {
  const tag = `${process.pid}_${Math.random().toString(36).slice(2, 10)}`;
  const name = `codex_test_${tag}`;
  const role = `codex_app_${tag}`;
  const password = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const admin = async (statements: string, database?: string) => {
    const u = new URL(adminUrl);
    if (database) u.pathname = `/${database}`;
    const c = new pg.Client({ connectionString: u.toString() });
    await c.connect();
    try {
      await c.query(statements);
    } finally {
      await c.end();
    }
  };
  await admin(`create database ${name}`);
  const u = new URL(adminUrl);
  u.pathname = `/${name}`;
  let roleMade = false;
  try {
    await admin(`create role ${role} login password '${password}' nosuperuser nocreatedb nocreaterole`);
    roleMade = true;
    await admin(`revoke all on database ${name} from public; grant connect on database ${name} to ${role};
      alter role ${role} in database ${name} set search_path to ${DB_SCHEMA}`);
    await admin(`revoke all on schema public from public; create schema ${DB_SCHEMA} authorization ${role};
      create schema extensions; revoke all on schema extensions from public; grant usage on schema extensions to ${role};
      create extension pg_trgm schema extensions`, name);
    u.username = role;
    u.password = password;
  } catch {
    // Not a superuser: the schema codex, owned by the admin user, in the new database.
    await admin(`create schema if not exists ${DB_SCHEMA}`, name);
  }
  return {
    url: u.toString(),
    drop: async () => {
      await admin(`drop database if exists ${name} with (force)`);
      if (roleMade) await admin(`drop role if exists ${role}`);
    },
  };
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
  // `next build` never opens the shared server (nor declares anything to Matrix): DATABASE_URL is a run-time variable.
  const url = BUILDING ? null : databaseUrlOf(process.env);
  if (url) log.info('database: PostgreSQL server', { url: redactUrl(url) });
  const db = await openDb(url ? { url } : path.join(DATA_DIR, 'pglite'), {
    beforeMigrate: async (client, plan) => {
      before.archive = await backUpBeforeMigrating(client, plan);
      before.pending = plan.pending;
    },
  });
  if (before.archive) await journal(db.$client, 'backup_created', before.archive.name, before.archive.data, `migration ${before.pending.join(', ')}`);
  // Declares the schema to Matrix (src/lib/matrix.ts, contract matrix.schema/1) right after the migrations, without
  // holding the start back: never awaited, never failing (a warning at most); without MATRIX_URL nor
  // MATRIX_DECLARATIONS_DIR, nothing is read nor sent. It reads current_schema(): codex, in both modes. The first
  // request, or the scheduler's first look (lib/scheduler.ts), opens the database, and so declares it, once per process.
  if (!BUILDING) void declarerSchemaCodex(<T,>(q: string) => db.$client.query<T>(q).then((r) => r.rows)).catch(() => {});
  await seedIfEmpty(db);
  return db;
}

/**
 * Seeded once, when nothing is there yet: neither a person nor a type (CODEX_SEED, CODEX_SEED_DEMO: lib/seed-mode.ts).
 * Mode none (a server without either): left empty, said in the log; every page then says how to fill it (EmptyDatabase).
 * On a server, under a session lock, so that two processes starting on a new database do not both seed it.
 */
export async function seedIfEmpty(db: Db): Promise<void> {
  const run = async () => {
    const [{ n }] = (await db.$client.query<{ n: number }>('select ((select count(*) from users) + (select count(*) from doc_types))::int as n')).rows;
    if (Number(n) !== 0) return;
    const mode = seedModeOf(process.env);
    if (!mode) throw new Error(`CODEX_SEED="${process.env.CODEX_SEED}" is neither demo nor minimal, or contradicts CODEX_SEED_DEMO=1: the new database was left empty`);
    if (mode === 'none') {
      log.warn('new database left empty: set CODEX_SEED=minimal (reference data and an initial administrator) or CODEX_SEED=demo (CODEX_SEED_DEMO=1), then restart');
      return;
    }
    await seed(db, mode);
    log.info('new database seeded', { mode });
  };
  if (!(db.$client instanceof PgServerClient)) return run();
  const s = await db.$client.session();
  let failed = true;
  try {
    await s.exec(`select pg_advisory_lock(hashtext('${DB_SCHEMA}.seed'))`);
    await run();
    await s.exec(`select pg_advisory_unlock(hashtext('${DB_SCHEMA}.seed'))`);
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
