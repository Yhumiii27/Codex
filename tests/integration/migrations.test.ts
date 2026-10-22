import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { afterAll, describe, expect, it } from 'vitest';
import { openDb, schema, type SqlClient } from '@/db';
import type { SqlQueryable } from '@/db/sql-client';
import { LEGACY_PUBLIC_CHAIN, readMigrations } from '@/lib/backup-core.mjs';
import { pgliteOptions } from '@/lib/pglite-options.mjs';
import { vocabKey } from '@/lib/vocab-rules';

// Versioned migrations (point 41 of docs/reste-a-faire.md, src/db/migrations.ts):
// - every change of src/db/schema.ts has its migration: the schema equals the last snapshot of drizzle/meta;
// - a database made by the chain of migrations, 0000_init then each incremental one, has the structure of a database
//   made at once from the schema: same tables, columns, constraints and indexes, as Postgres itself writes them, all in
//   the schema codex (decision M-01), with the views pub_ of the shared data (0001_partage);
// - a database made by another schema is refused before anything is replayed on it; a PGlite database of the last
//   chain before the schema codex (tables in public, tests/fixtures/drizzle-public) is taken up into it.
// The migrations of that former chain (0003_vocabulaires, 0004_modele_source took up data) are tested from the fixtures.
// `npm run db:check` (drizzle-kit check, in the CI) checks the folder itself: snapshots chained, no collision.

type DrizzleKitApi = typeof import('drizzle-kit/api');
const kit = (): Promise<DrizzleKitApi> => import('drizzle-kit/api');
const imports = schema as unknown as Record<string, unknown>;

async function lastSnapshot() {
  const files = (await readdir('drizzle/meta')).filter((f) => /^\d{4}_snapshot\.json$/.test(f)).sort();
  return JSON.parse(await readFile(path.join('drizzle/meta', files[files.length - 1]), 'utf8'));
}

/** Tables, columns, constraints and indexes of a schema (codex by default), as the catalogue writes them. */
async function structure(pg: Pick<SqlQueryable, 'query'>, nsp = 'codex') {
  // Sorted here, not by the server: its collation (C, en_US…) orders "document_terms" and "documents" differently.
  // pg_trgm's operator class is written with its schema when it is not on the search_path: `extensions` on a server laid
  // out as the shared one (docs/postgres.md), codex in PGlite. The same index either way.
  // NOT NULL constraints (contype n) are rows of pg_constraint from PostgreSQL 18 only (PGlite 0.5), not on a
  // PostgreSQL 16 server (npm run test:pg): left out, the columns' is_nullable compares them on both.
  const q = async (sql: string) => (await pg.query<Record<string, unknown>>(sql)).rows.map((r) => Object.values(r).join(' | ').replace(/\b\w+\.gin_trgm_ops\b/g, 'gin_trgm_ops')).sort();
  return {
    columns: await q(`select table_name, column_name, data_type, udt_name, is_nullable, coalesce(column_default, '') from information_schema.columns where table_schema = '${nsp}' and table_name not like 'pub\\_%' and table_name <> '__drizzle_migrations' order by 1, 2`),
    constraints: await q(`select conrelid::regclass::text, conname, pg_get_constraintdef(oid) from pg_constraint where connamespace = '${nsp}'::regnamespace and contype <> 'n' and conrelid::regclass::text not like '%\\_\\_drizzle\\_migrations' order by 1, 2`),
    indexes: await q(`select tablename, indexname, indexdef from pg_indexes where schemaname = '${nsp}' and tablename <> '__drizzle_migrations' order by 1, 2`),
  };
}

/** The chain of migrations before the schema codex (tables in public), as 21 October 2026 left it. */
const LEGACY = path.join('tests', 'fixtures', 'drizzle-public');

const opened: (PGlite | SqlClient)[] = [];
const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(opened.map((pg) => pg.close().catch(() => {})));
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe('migrations', () => {
  it('cover src/db/schema.ts: the schema equals the last snapshot (npm run db:generate would write nothing)', async () => {
    const api = await kit();
    const prev = await lastSnapshot();
    expect(await api.generateMigration(prev, api.generateDrizzleJson(imports, prev.id))).toEqual([]);
  });

  it('give a database the structure of the schema', async () => {
    const api = await kit();
    const migrated = await openDb();
    opened.push(migrated.$client);
    const direct = new PGlite(pgliteOptions(undefined));
    opened.push(direct);
    await direct.exec('create schema codex; create extension if not exists pg_trgm schema codex');
    const statements = await api.generateMigration(api.generateDrizzleJson({}), api.generateDrizzleJson(imports));
    for (const st of statements.flatMap((x) => x.split('--> statement-breakpoint'))) if (st.trim()) await direct.exec(st);
    const [a, b] = await Promise.all([structure(migrated.$client), structure(direct)]);
    expect(a.columns.length).toBeGreaterThan(100);
    expect(a).toEqual(b);
  }, 60_000);

  it('take up the existing source organisations, keywords and languages into the vocabularies (0003_vocabulaires)', async () => {
    const pg = new PGlite({ extensions: { pg_trgm } });
    opened.push(pg);
    await pg.exec('create extension if not exists pg_trgm');
    const run = async (file: string) => {
      for (const st of (await readFile(path.join(LEGACY, file), 'utf8')).split('--> statement-breakpoint')) if (st.trim()) await pg.exec(st);
    };
    for (const f of ['0000_init.sql', '0001_planificateur_signatures.sql', '0002_apercu_office.sql']) await run(f);
    // Documents as a database of 17 October left them (foreign keys aside: only these columns matter here).
    await pg.transaction(async (tx) => {
      await tx.exec('set local session_replication_role = replica');
      const q = (id: string, org: string | null, keywords: string[], lang: string | null, created: string) => tx.query(
        `insert into documents (id, title, origin, attachment, family, type_code, department, owner_id, conf, keywords, lang, status, retention_trigger, retention_disposition, created_at, modified_at, source_org)
         values ($1, $1, 'externe', 'none', 'f', 'COR', 'QUA', 'u', 'interne', $2, $3, 'in_force', 'creation', 'destroy', $4, $4, $5)`,
        [id, JSON.stringify(keywords), lang, created, org],
      );
      await q('D1', 'Siemens', ['Sécurité', 'levage'], 'fr', '2026-01-03');
      await q('D2', 'Siemens', ['SECURITE'], 'FR', '2026-01-01');
      await q('D3', ' SIEMENS\u00a0 ', [' levage '], ' en', '2026-01-02');
      await q('D4', 'Électricité de France', [], 'de', '2026-02-01');
      await q('D5', null, [], null, '2026-02-02');
    });
    await run('0003_vocabulaires.sql');
    const rows = async (table: string) => (await pg.query<{ name: string; key: string; created_at: string }>(`select name, key, created_at::text from ${table} order by key`)).rows;
    expect(await rows('source_orgs')).toEqual([
      { name: 'Électricité de France', key: 'electricite de france', created_at: '2026-02-01' },
      { name: 'Siemens', key: 'siemens', created_at: '2026-01-01' },
    ]);
    expect(await rows('keyword_terms')).toEqual([
      { name: 'levage', key: 'levage', created_at: '2026-01-02' },
      { name: 'SECURITE', key: 'securite', created_at: '2026-01-01' },
    ]);
    // The database folds as lib/vocab-rules.ts vocabKey does.
    for (const r of [...(await rows('source_orgs')), ...(await rows('keyword_terms'))]) expect(r.key).toBe(vocabKey(r.name));
    // Languages: fr and en whatever their case and blanks; another value is left for its next edit to correct.
    expect((await pg.query<{ id: string; lang: string | null }>(`select id, lang from documents order by id`)).rows.map((r) => r.lang)).toEqual(['fr', 'fr', 'en', 'de', null]);
  }, 60_000);

  it('take up the template of documents created from one, only when it reads for sure (0004_modele_source)', async () => {
    const pg = new PGlite({ extensions: { pg_trgm } });
    opened.push(pg);
    await pg.exec('create extension if not exists pg_trgm');
    const run = async (file: string) => {
      for (const st of (await readFile(path.join(LEGACY, file), 'utf8')).split('--> statement-breakpoint')) if (st.trim()) await pg.exec(st);
    };
    for (const f of ['0000_init.sql', '0001_planificateur_signatures.sql', '0002_apercu_office.sql', '0003_vocabulaires.sql']) await run(f);
    // Documents as a database of 18 October left them (foreign keys aside: only these columns matter here).
    await pg.transaction(async (tx) => {
      await tx.exec('set local session_replication_role = replica');
      let rev = 0;
      const doc = async (id: string, type: string, aliases: string[] = []) => tx.query(
        `insert into documents (id, aliases, title, origin, attachment, family, type_code, department, owner_id, conf, keywords, status, retention_trigger, retention_disposition, created_at, modified_at)
         values ($1, $2, $1, 'interne', 'none', 'f', $3, 'QUA', 'u', 'interne', '[]', 'draft', 'creation', 'destroy', '2026-10-01', '2026-10-01')`,
        [id, JSON.stringify(aliases), type],
      );
      const created = async (id: string, comment: unknown, journalId: string | null, detail: string) => {
        rev++;
        await tx.query(`insert into revisions (id, doc_id, letter, status, created_at) values ($1, $2, 'A', 'draft', '2026-10-01')`, [rev, id]);
        await tx.query(`insert into working_versions (revision_id, doc_id, n, comment, author_id, date) values ($1, $2, 1, $3, 'u', '2026-10-01')`, [rev, id, JSON.stringify(comment)]);
        if (journalId) await tx.query(`insert into audit_log (at, user_id, action, doc_id, detail) values (now(), 'u', 'upload', $1, $2)`, [journalId, detail]);
      };
      const from = (tpl: string) => ({ fr: `Créé depuis le modèle ${tpl} « Modèle »`, en: `Created from template ${tpl} “Modèle”` });
      await doc('FRM-QMS-001', 'FRM');
      await doc('PRO-QUA-0001', 'PRO');
      await created('PRO-QUA-0001', from('FRM-QMS-001'), 'PRO-QUA-0001', 'A.1 · 12 Ko · FRM-QMS-001');
      // Reclassified since: the journal names it under its former ID.
      await doc('PRO-ING-0001', 'PRO', ['PRO-QUA-0002']);
      await created('PRO-ING-0001', from('FRM-QMS-001'), 'PRO-QUA-0002', 'A.1 · FRM-QMS-001');
      // The journal does not name the template.
      await doc('PRO-QUA-0003', 'PRO');
      await created('PRO-QUA-0003', from('FRM-QMS-001'), 'PRO-QUA-0003', 'A.1 · 12 Ko');
      // A template that is not one, or no longer exists.
      await doc('PRO-QUA-0004', 'PRO');
      await created('PRO-QUA-0004', from('PRO-QUA-0001'), 'PRO-QUA-0004', 'A.1 · PRO-QUA-0001');
      await doc('PRO-QUA-0005', 'PRO');
      await created('PRO-QUA-0005', from('FRM-QMS-404'), 'PRO-QUA-0005', 'A.1 · FRM-QMS-404');
      // A comment of another wording (an import, a hand-written one), or whose two languages disagree.
      await doc('PRO-QUA-0006', 'PRO');
      await created('PRO-QUA-0006', 'Créé depuis le modèle FRM-QMS-001 « Modèle »', 'PRO-QUA-0006', 'A.1 · FRM-QMS-001');
      await doc('PRO-QUA-0007', 'PRO');
      await created('PRO-QUA-0007', { ...from('FRM-QMS-001'), en: 'Created from template FRM-QMS-002 “x”' }, 'PRO-QUA-0007', 'A.1 · FRM-QMS-001');
    });
    await run('0004_modele_source.sql');
    const rows = (await pg.query<{ id: string; template_id: string | null }>(`select id, template_id from documents order by id`)).rows;
    expect(Object.fromEntries(rows.map((r) => [r.id, r.template_id]))).toEqual({
      'FRM-QMS-001': null, 'PRO-ING-0001': 'FRM-QMS-001', 'PRO-QUA-0001': 'FRM-QMS-001', 'PRO-QUA-0003': null, 'PRO-QUA-0004': null,
      'PRO-QUA-0005': null, 'PRO-QUA-0006': null, 'PRO-QUA-0007': null,
    });
    // The register's types get an empty English basis.
    expect((await pg.query(`select column_default from information_schema.columns where table_name = 'doc_types' and column_name = 'retention_basis_en'`)).rows).toEqual([{ column_default: "''::text" }]);
  }, 60_000);

  it('refuse a database made by another schema, and leave it as it was', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'codex-migrations-'));
    dirs.push(dir);
    const db = await openDb(dir);
    // As a database made before 17 October 2026 by a regenerated 0000_init: another file, an older instant.
    const applied = `select id, hash, created_at::text from codex.__drizzle_migrations order by id`;
    await db.$client.query(`update codex.__drizzle_migrations set hash = 'regenerated-' || id, created_at = created_at - 1000`);
    const before = (await db.$client.query(applied)).rows;
    await db.$client.close();
    await expect(openDb(dir)).rejects.toThrow(/another version of Codex's schema/);
    const pg = new PGlite(pgliteOptions(dir));
    opened.push(pg);
    expect((await pg.query(applied)).rows).toEqual(before);
  }, 60_000);

  it('take up a PGlite database of the last chain before the schema codex, data and all, into the structure of a new one', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'codex-takeup-'));
    dirs.push(dir);
    // As this branch left a database on 21 October 2026: tables in public, journal drizzle.__drizzle_migrations.
    const old = new PGlite({ dataDir: dir, extensions: { pg_trgm } });
    await old.exec('create extension if not exists pg_trgm');
    const legacy = await readMigrations(LEGACY);
    for (const m of legacy) {
      for (const st of (await readFile(path.join(LEGACY, `${m.tag}.sql`), 'utf8')).split('--> statement-breakpoint')) if (st.trim()) await old.exec(st);
    }
    await old.exec(`create schema drizzle; create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`);
    for (const m of legacy) await old.query('insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)', [m.hash, m.createdAt]);
    await old.exec(`insert into departments (code, label_fr, label_en) values ('QUA', 'Qualité', 'Quality');
      insert into users (id, name, initials, role, department) values ('p1', 'Personne Un', 'PU', 'collaborateur', 'QUA');`);
    await old.close();
    expect(legacy).toEqual(LEGACY_PUBLIC_CHAIN);

    const db = await openDb(dir);
    opened.push(db.$client);
    const q = async <T,>(text: string) => (await db.$client.query<T>(text)).rows;
    // The data moved with its tables; public is empty, the former journal gone, the new one holds the code's chain.
    expect(await q(`select id, name, department from codex.users`)).toEqual([{ id: 'p1', name: 'Personne Un', department: 'QUA' }]);
    expect(await q(`select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'`)).toEqual([{ n: 0 }]);
    expect(await q(`select to_regnamespace('drizzle') as d`)).toEqual([{ d: null }]);
    const code = await readMigrations('drizzle');
    expect((await q<{ hash: string }>(`select hash from codex.__drizzle_migrations order by created_at`)).map((r) => r.hash)).toEqual(code.map((m) => m.hash));
    expect(await q(`select extnamespace::regnamespace::text as s from pg_extension where extname = 'pg_trgm'`)).toEqual([{ s: 'codex' }]);
    // The same structure as a database made by the code's migrations, views of the shared data included.
    const fresh = await openDb();
    opened.push(fresh.$client);
    const [a, b] = await Promise.all([structure(db.$client), structure(fresh.$client)]);
    expect(a).toEqual(b);
    const views = `select table_name from information_schema.views where table_schema = 'codex' order by 1`;
    expect(await q(views)).toEqual((await fresh.$client.query(views)).rows);
    // Opened again: nothing left to do.
    await db.$client.close();
    const again = await openDb(dir);
    opened.push(again.$client);
    expect((await again.$client.query(`select count(*)::int as n from codex.__drizzle_migrations`)).rows).toEqual([{ n: code.length }]);
  }, 120_000);

  it('refuse a PGlite database of main before the schema codex (tables in public, no journal of this chain), unchanged', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'codex-oldmain-'));
    dirs.push(dir);
    const old = new PGlite({ dataDir: dir });
    await old.exec(`create table users (id text primary key); create table documents (id text primary key); insert into users values ('u');`);
    await old.close();
    await expect(openDb(dir)).rejects.toThrow(/made before the schema codex \(tables in public, no journal\)/);
    const pg = new PGlite({ dataDir: dir });
    opened.push(pg);
    expect((await pg.query(`select to_regnamespace('codex') as c, (select count(*)::int from public.users) as n`)).rows).toEqual([{ c: null, n: 1 }]);
  }, 60_000);
});
