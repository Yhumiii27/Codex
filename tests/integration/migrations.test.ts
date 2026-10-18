import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { afterAll, describe, expect, it } from 'vitest';
import { openDb, schema, type SqlClient } from '@/db';
import type { SqlQueryable } from '@/db/sql-client';
import { vocabKey } from '@/lib/vocab-rules';

// Versioned migrations (point 41 of docs/reste-a-faire.md, src/db/migrations.ts):
// - every change of src/db/schema.ts has its migration: the schema equals the last snapshot of drizzle/meta;
// - a database made by the chain of migrations, 0000_init then each incremental one, has the structure of a database
//   made at once from the schema: same tables, columns, constraints and indexes, as Postgres itself writes them;
// - a database made by another schema is refused before anything is replayed on it.
// `npm run db:check` (drizzle-kit check, in the CI) checks the folder itself: snapshots chained, no collision.

type DrizzleKitApi = typeof import('drizzle-kit/api');
const kit = (): Promise<DrizzleKitApi> => import('drizzle-kit/api');
const imports = schema as unknown as Record<string, unknown>;

async function lastSnapshot() {
  const files = (await readdir('drizzle/meta')).filter((f) => /^\d{4}_snapshot\.json$/.test(f)).sort();
  return JSON.parse(await readFile(path.join('drizzle/meta', files[files.length - 1]), 'utf8'));
}

/** Tables, columns, constraints and indexes of the public schema, as the catalogue writes them. */
async function structure(pg: Pick<SqlQueryable, 'query'>) {
  // Sorted here, not by the server: its collation (C, en_US…) orders "document_terms" and "documents" differently.
  const q = async (sql: string) => (await pg.query<Record<string, unknown>>(sql)).rows.map((r) => Object.values(r).join(' | ')).sort();
  return {
    columns: await q(`select table_name, column_name, data_type, udt_name, is_nullable, coalesce(column_default, '') from information_schema.columns where table_schema = 'public' order by 1, 2`),
    constraints: await q(`select conrelid::regclass::text, conname, pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`),
    indexes: await q(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2`),
  };
}

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
    const direct = new PGlite({ extensions: { pg_trgm } });
    opened.push(direct);
    await direct.exec('create extension if not exists pg_trgm');
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
      for (const st of (await readFile(path.join('drizzle', file), 'utf8')).split('--> statement-breakpoint')) if (st.trim()) await pg.exec(st);
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

  it('refuse a database made by another schema, and leave it as it was', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'codex-migrations-'));
    dirs.push(dir);
    const db = await openDb(dir);
    // As a database made before 17 October 2026 by a regenerated 0000_init: another file, an older instant.
    const applied = `select id, hash, created_at::text from drizzle.__drizzle_migrations order by id`;
    await db.$client.query(`update drizzle.__drizzle_migrations set hash = 'regenerated-' || id, created_at = created_at - 1000`);
    const before = (await db.$client.query(applied)).rows;
    await db.$client.close();
    await expect(openDb(dir)).rejects.toThrow(/another version of Codex's schema/);
    const pg = new PGlite({ dataDir: dir, extensions: { pg_trgm } });
    opened.push(pg);
    expect((await pg.query(applied)).rows).toEqual(before);
  }, 60_000);
});
