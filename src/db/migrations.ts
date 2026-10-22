import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { LEGACY_PUBLIC_CHAIN } from '../lib/backup-core.mjs';
import { DB_SCHEMA } from './schema';
import type { SqlQueryable } from './sql-client';

// Versioned migrations (drizzle/, point 41 of docs/reste-a-faire.md). Since 22 October 2026 (lot 11, decision M-01: one
// shared EPC2I PostgreSQL database, one schema per tool) every table, function, trigger and collation of Codex lives in
// the schema `codex`, in PGlite as on the shared server, and so does the journal of the migrations
// (codex.__drizzle_migrations). 0000_init is the base, equal to src/db/schema.ts on that day, 0001_partage the
// prerequisites and `pub_` views of the shared data (Matrix, infra/postgres/partage/40-codex.sql); each later change of
// the schema adds the next file (npm run db:generate), never rewrites one that a database may have applied.
//
// The migrations are applied here rather than by drizzle's migrate(): it starts with CREATE SCHEMA IF NOT EXISTS, which
// the codex_app role of the shared server may not run (no CREATE on the database), and it only compares instants: it
// would replay 0000_init on a database made by another 0000_init (and fail half-way), skip a migration generated on
// another branch with an older instant, and say nothing of a database made by a newer Codex. migrationPlan() checks first
// that the database's migrations are the code's first ones, the same files (SHA-256, as drizzle hashes them).
//
// A PGlite database made before lot 11 by this branch (tables in `public`, journal drizzle.__drizzle_migrations, the six
// migrations 0000_init … 0005_index_acces_validations of 17–21 October, LEGACY_PUBLIC_CHAIN) is taken up: its schema
// `public` becomes `codex` (tables, data, sequences, functions, collation and pg_trgm move with it), its journal is
// replaced by the new 0000_init, whose structure is that of those six migrations, and 0001_partage follows. Any other
// database whose tables are in `public` (an earlier chain, the demo of main before 17 October) is refused with its remedy.

/** Qualified name of the journal of the migrations. */
export const JOURNAL = `${DB_SCHEMA}.__drizzle_migrations`;

/** A migration of the code (lib/backup-core.mjs readMigrations): its tag, the instant of the journal, its SHA-256. */
export type CodeMigration = { tag: string; hash: string; createdAt: number };
/** A migration a database applied (codex.__drizzle_migrations). */
export type AppliedMigration = { hash: string; createdAt: number };
/**
 * `fresh`: the database has applied nothing (new); `pending`: tags of the code's migrations it still lacks, in order;
 * `takeUp`: a database of this branch made before lot 11, in `public`, to move into `codex` first (only then is 0000_init
 * counted as applied).
 */
export type MigrationPlan = { fresh: boolean; pending: string[]; takeUp?: boolean };

export class MigrationMismatch extends Error {
  constructor(readonly code: 'order' | 'unknown' | 'layout', message: string) {
    super(message);
    this.name = 'MigrationMismatch';
  }
}

/**
 * Which of the code's migrations a database lacks. Refuses (MigrationMismatch) when the code's journal is not in
 * increasing order of instants, or when a migration the database applied is not the code's at the same rank: a
 * database made by another schema (an earlier 0000_init, a newer Codex, a migration file edited after it was applied).
 */
export function migrationPlan(applied: AppliedMigration[], code: CodeMigration[]): MigrationPlan {
  code.forEach((m, i) => {
    if (i && m.createdAt <= code[i - 1].createdAt) {
      throw new MigrationMismatch('order', `migration ${m.tag} is dated before ${code[i - 1].tag} in drizzle/meta/_journal.json: it would never be applied`);
    }
  });
  const done = [...applied].sort((a, b) => a.createdAt - b.createdAt);
  done.forEach((m, i) => {
    const mine = code[i];
    if (!mine || mine.hash !== m.hash || mine.createdAt !== m.createdAt) {
      const known = code.find((x) => x.hash === m.hash && x.createdAt === m.createdAt);
      throw new MigrationMismatch('unknown', known
        ? `the database applied ${known.tag} out of order`
        : `the database applied a migration this code does not have (instant ${m.createdAt}, sha256 ${m.hash.slice(0, 12)}…): it was made by another version of Codex's schema. Run the version that made it, restore a backup made with this one (npm run restore), or start over (npm run db:reset, which deletes the data)`);
    }
  });
  return { fresh: !done.length, pending: code.slice(done.length).map((m) => m.tag) };
}

/** Where a database keeps Codex's tables and its journal, read before anything is changed. */
export type Layout = {
  /** codex.__drizzle_migrations exists. */
  journal: boolean;
  /** The migrations it holds, oldest first. */
  applied: AppliedMigration[];
  /** Codex's tables are in `public` (a database made before lot 11, or by the main branch before 17 October). */
  legacy: boolean;
  /** The migrations of drizzle.__drizzle_migrations (the journal before lot 11), oldest first. */
  legacyApplied: AppliedMigration[];
  /** The schema codex exists, and holds tables. */
  schema: boolean;
  tables: number;
};

/** planFor() options for a PostgreSQL server: never taken up (Codex does not rename a server's schemas). */
export const SERVER_PLAN = {
  embedded: false,
  remedy: 'Codex only takes up a PGlite database; on a server, export the data with the version that made it, then start from an empty schema codex',
} as const;

/**
 * Reads the layout of a database: every name qualified, nothing created (search_path does not matter); the former
 * layout is looked up in the catalogue, which needs no privilege (the shared server closes public to every tool).
 */
export async function readLayout(client: Pick<SqlQueryable, 'query'>): Promise<Layout> {
  const [r] = (await client.query<{ journal: boolean; legacy: boolean; old_journal: boolean; schema: boolean; tables: number }>(`select
      to_regclass('${JOURNAL}') is not null as journal,
      (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('users', 'documents') and c.relkind = 'r') = 2 as legacy,
      exists (select from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'drizzle' and c.relname = '__drizzle_migrations') as old_journal,
      exists (select from pg_namespace where nspname = '${DB_SCHEMA}') as schema,
      (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = '${DB_SCHEMA}' and c.relkind in ('r', 'p') and c.relname <> '__drizzle_migrations')::int as tables`)).rows;
  const legacyApplied = r.old_journal
    ? (await client.query<{ hash: string; created_at: string }>('select hash, created_at::text as created_at from drizzle.__drizzle_migrations order by created_at')).rows.map((x) => ({ hash: x.hash, createdAt: Number(x.created_at) }))
    : [];
  const applied = r.journal ? await appliedMigrations(client) : [];
  return { journal: r.journal, applied, legacy: r.legacy, legacyApplied, schema: r.schema, tables: Number(r.tables) };
}

/** The migrations a database applied, oldest first; none for a database just created. */
export async function appliedMigrations(client: Pick<SqlQueryable, 'query'>): Promise<AppliedMigration[]> {
  const [{ t }] = (await client.query<{ t: string | null }>(`select to_regclass('${JOURNAL}')::text as t`)).rows;
  if (!t) return [];
  const { rows } = await client.query<{ hash: string; created_at: string }>(`select hash, created_at::text as created_at from ${JOURNAL} order by created_at`);
  return rows.map((r) => ({ hash: r.hash, createdAt: Number(r.created_at) }));
}

/** True when `applied` is exactly the chain of this branch before lot 11 (LEGACY_PUBLIC_CHAIN), complete. */
export function isLegacyChain(applied: AppliedMigration[]): boolean {
  return applied.length === LEGACY_PUBLIC_CHAIN.length && applied.every((m, i) => m.hash === LEGACY_PUBLIC_CHAIN[i].hash && m.createdAt === LEGACY_PUBLIC_CHAIN[i].createdAt);
}

/**
 * What to do with a database: the plan of migrationPlan(), or a take-up of an older PGlite layout (`embedded`: only
 * PGlite is taken up; a server is never renamed by Codex). Refuses (MigrationMismatch 'layout') a database whose tables
 * are in `public` and that cannot be taken up, and a schema codex holding tables without a journal; `remedy` ends the
 * message (where the data directory is, how to start over).
 */
export function planFor(layout: Layout, code: CodeMigration[], opts: { embedded: boolean; remedy: string }): MigrationPlan {
  if (layout.journal) return migrationPlan(layout.applied, code);
  if (layout.legacy) {
    if (opts.embedded && isLegacyChain(layout.legacyApplied) && !layout.tables && code[0]) {
      const rest = migrationPlan([{ hash: code[0].hash, createdAt: code[0].createdAt }], code);
      return { fresh: false, pending: rest.pending, takeUp: true };
    }
    const n = layout.legacyApplied.length;
    const chain = isLegacyChain(layout.legacyApplied);
    const detail = n ? `, ${n} migration(s) in drizzle.__drizzle_migrations${chain ? '' : ', an earlier chain'}` : ', no journal';
    const prefix = layout.legacyApplied.every((m, i) => LEGACY_PUBLIC_CHAIN[i]?.hash === m.hash && LEGACY_PUBLIC_CHAIN[i]?.createdAt === m.createdAt);
    const hint = n && prefix && !chain && opts.embedded ? 'start the version of Codex of 21 October 2026 once (it brings the database to 0005_index_acces_validations, which this version takes up), or ' : '';
    throw new MigrationMismatch('layout', `database made before the schema ${DB_SCHEMA} (tables in public${detail}): ${hint}${opts.remedy}`);
  }
  if (layout.tables) throw new MigrationMismatch('layout', `the schema ${DB_SCHEMA} holds ${layout.tables} table(s) but no journal of migrations (${JOURNAL}): not a database made by Codex. ${opts.remedy}`);
  return migrationPlan([], code);
}

/**
 * Applies `plan` in the transaction `tx`: the take-up of a database of the former layout (public → codex), then the
 * code's pending migrations, each recorded in codex.__drizzle_migrations (the table drizzle's migrator would write:
 * id, hash, created_at). `prepare` runs once the journal is there, before the migrations. The schema codex must exist
 * (server: created by the socle; PGlite: by openDb). Never runs CREATE SCHEMA, never names public but to rename it.
 */
export async function applyMigrations(tx: SqlQueryable, folder: string, plan: MigrationPlan, prepare?: () => Promise<unknown>): Promise<void> {
  const files = readMigrationFiles({ migrationsFolder: folder });
  if (plan.takeUp) {
    // The schema codex was not created for this database (openDb skips it on a take-up). public becomes codex, with every
    // object in it, pg_trgm's operators included; a new, empty public takes its place, as PGlite makes it.
    await tx.exec(`alter schema public rename to ${DB_SCHEMA};
      create schema public;
      alter table drizzle.__drizzle_migrations set schema ${DB_SCHEMA};
      delete from ${JOURNAL};
      drop schema drizzle;`);
    await tx.query(`insert into ${JOURNAL} (hash, created_at) values ($1, $2)`, [files[0].hash, files[0].folderMillis]);
  } else {
    await tx.exec(`create table if not exists ${JOURNAL} (id serial primary key, hash text not null, created_at bigint)`);
  }
  // What the migrations need beyond the schema (pg_trgm, whose gin_trgm_ops 0000_init uses).
  await prepare?.();
  const tags = new Set(plan.pending);
  const byTag = await tagsOf(folder);
  for (const m of files) {
    if (!tags.has(byTag.get(m.folderMillis) ?? '')) continue;
    for (const st of m.sql) if (st.trim()) await tx.exec(st);
    await tx.query(`insert into ${JOURNAL} (hash, created_at) values ($1, $2)`, [m.hash, m.folderMillis]);
  }
}

async function tagsOf(folder: string): Promise<Map<number, string>> {
  const journal = JSON.parse(await readFile(path.join(folder, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string; when: number }[] };
  return new Map(journal.entries.map((e) => [e.when, e.tag]));
}
