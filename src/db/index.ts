import 'server-only';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { count, sql } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { Pool } from 'pg';
import { declarerSchemaCodex } from '@/lib/matrix';
import { migrateSchema } from './migrate';
import * as schema from './schema';
import { DB_SCHEMA } from './schema';
import { seed } from './seed';
import type { DB } from './types';

export type Db = DB;

// Runtime data (uploaded files, fallback PGlite database) lives outside the build output.
export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.CODEX_DATA_DIR ?? path.join(process.cwd(), '.data'));
export const FILES_DIR = path.join(DATA_DIR, 'files');
const MIGRATIONS = path.join(process.cwd(), 'drizzle');

/** `next build` ne doit jamais ouvrir le serveur commun ni déclarer quoi que ce soit à Matrix. */
const BUILDING = process.env.NEXT_PHASE === 'phase-production-build';

/**
 * Serveur PostgreSQL commun EPC2I (rôle codex_app, schéma codex). Chaque transaction prend d'abord le verrou
 * d'écriture de Codex : les écritures passent l'une après l'autre, comme dans PGlite ; les lectures restent parallèles.
 */
async function openServer(url: string): Promise<DB> {
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.CODEX_DB_POOL) || 10,
    application_name: 'codex',
    options: `-c search_path=${DB_SCHEMA}`,
  });
  pool.on('error', (err) => console.error('[db] connexion inactive perdue', err));
  const db: DB = drizzlePg(pool, { schema });
  const transaction = db.transaction.bind(db);
  db.transaction = ((fn, config) =>
    transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${DB_SCHEMA}.ecritures`}))`);
      return fn(tx);
    }, config)) as DB['transaction'];
  return db;
}

/** PGlite dans $CODEX_DATA_DIR/pglite (développement, application Mac, repli). Une base antérieure au schéma est refusée. */
async function openEmbedded(): Promise<DB> {
  const dir = path.join(DATA_DIR, 'pglite');
  const client = new PGlite(dir);
  const { rows } = await client.query<{ ancienne: boolean }>(
    `select to_regclass('public.users') is not null and to_regclass('${DB_SCHEMA}.users') is null as ancienne`,
  );
  if (rows[0].ancienne) {
    await client.close();
    // Application Mac : CODEX_DATA_DIR pointe vers ~/Library/Application Support/Codex/data.
    const remede = process.env.CODEX_DATA_DIR ? `quittez l'application et supprimez ${dir}` : 'npm run db:reset';
    throw new Error(`Base PGlite antérieure au schéma ${DB_SCHEMA} dans ${dir} : ${remede} (voir README).`);
  }
  await client.exec(`create schema if not exists ${DB_SCHEMA}; set search_path to ${DB_SCHEMA}`);
  return drizzlePglite(client, { schema });
}

async function init(): Promise<DB> {
  await mkdir(FILES_DIR, { recursive: true });
  // Une valeur vide (application Mac) vaut absence.
  const url = BUILDING ? undefined : process.env.DATABASE_URL || undefined;
  const db = url ? await openServer(url) : await openEmbedded();
  await migrateSchema(db, MIGRATIONS);
  // Déclare le schéma à Matrix (src/lib/matrix.ts) sans retarder le démarrage ; sans MATRIX_URL, rien n'est envoyé.
  // L'introspection lit current_schema() : le search_path codex est posé dans les deux modes.
  if (!BUILDING) {
    void declarerSchemaCodex(<T,>(q: string) => db.execute(sql.raw(q)).then((r) => r.rows as T[])).catch(() => {});
  }
  if (!url || process.env.CODEX_SEED_DEMO === '1') {
    const [{ n }] = await db.select({ n: count() }).from(schema.users);
    if (n === 0) await seed(db);
  }
  return db;
}

// One database handle per server process; kept on globalThis so dev hot reloads reuse it.
const g = globalThis as unknown as { __codexDb?: Promise<DB> };

export function getDb(): Promise<DB> {
  g.__codexDb ??= init().catch((err) => {
    g.__codexDb = undefined;
    throw err;
  });
  return g.__codexDb;
}

export { schema };
