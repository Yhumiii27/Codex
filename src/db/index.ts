import 'server-only';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { backupDirOf, createBackup, journal, journalData, keepOf, lockForServer, readMigrations } from '../lib/backup-core.mjs';
import { logger } from '../lib/log';
import { seedModeOf } from '../lib/seed-mode';
import { appVersion } from '../lib/version';
import { appliedMigrations, migrationPlan, type MigrationPlan } from './migrations';
import * as schema from './schema';
import { seed } from './seed';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

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

/**
 * Opens a database with the schema of drizzle/, the append-only journal, the version of documents and their search
 * terms, but no data: on disk under `dataDir`, or in memory without one. getDb() opens the application's database with
 * it and seeds it; integration tests (tests/integration) open throwaway in-memory databases with it, so they run
 * against the same schema and triggers.
 */
export async function openDb(dataDir?: string, opts: { beforeMigrate?: (client: PGlite, plan: MigrationPlan) => Promise<void> } = {}): Promise<Db> {
  const client = new PGlite({ dataDir, extensions: { pg_trgm } });
  const db = drizzle(client, { schema });
  try {
    await client.exec('create extension if not exists pg_trgm');
    // Refuses a database made by another schema before drizzle replays anything on it (src/db/migrations.ts).
    const plan = migrationPlan(await appliedMigrations(client), await readMigrations(MIGRATIONS_DIR));
    if (plan.pending.length && opts.beforeMigrate) await opts.beforeMigrate(client, plan);
    // All pending migrations in one transaction: a failure leaves the database as it was.
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } catch (err) {
    await client.close().catch(() => {});
    throw err;
  }
  await client.exec(AUDIT_APPEND_ONLY);
  await client.exec(DOCUMENT_VERSION);
  await client.exec(DOCUMENT_SEARCH);
  return db;
}

/**
 * Before migrating a database that holds data, an archive of it and of its files (lib/backup-core.mjs, as
 * Administration › Sauvegardes writes them): the way back from a migration that went through but turned out wrong is
 * `npm run restore` of that archive with the version of Codex that made it (docs/sauvegarde.md). A failed migration
 * needs none: drizzle applies them in one transaction. When the archive cannot be written, the server does not start
 * and the database is left as it was; CODEX_MIGRATION_BACKUP=off migrates without it.
 */
async function backUpBeforeMigrating(client: PGlite, plan: MigrationPlan): Promise<{ name: string; data: Record<string, unknown> } | null> {
  if (plan.fresh) return null;
  if (/^(0|false|off|no)$/i.test(process.env.CODEX_MIGRATION_BACKUP?.trim() ?? '')) {
    log.warn('migrating without a backup (CODEX_MIGRATION_BACKUP=off)', { pending: plan.pending });
    return null;
  }
  const res = await createBackup({
    pg: client, filesDir: FILES_DIR, dbDir: path.join(DATA_DIR, 'pglite'), backupDir: backupDirOf(DATA_DIR, process.env), keep: keepOf(process.env),
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
  const db = await openDb(path.join(DATA_DIR, 'pglite'), {
    beforeMigrate: async (client, plan) => {
      before.archive = await backUpBeforeMigrating(client, plan);
      before.pending = plan.pending;
    },
  });
  if (before.archive) await journal(db.$client, 'backup_created', before.archive.name, before.archive.data, `migration ${before.pending.join(', ')}`);
  // Seeded once, when nothing is there yet: neither a person nor a type (CODEX_SEED, lib/seed-mode.ts).
  const [{ n }] = (await db.$client.query<{ n: number }>('select ((select count(*) from users) + (select count(*) from doc_types))::int as n')).rows;
  if (Number(n) === 0) {
    const mode = seedModeOf(process.env);
    if (!mode) throw new Error(`CODEX_SEED="${process.env.CODEX_SEED}" is neither demo nor minimal: the new database was left empty`);
    await seed(db, mode);
    log.info('new database seeded', { mode });
  }
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
