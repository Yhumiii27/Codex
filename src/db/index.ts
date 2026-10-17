import 'server-only';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { declarerSchemaCodex } from '@/lib/matrix';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './schema';
import { seed } from './seed';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

// Runtime data (database, uploaded files) lives outside the build output.
export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.CODEX_DATA_DIR ?? path.join(process.cwd(), '.data'));
export const FILES_DIR = path.join(DATA_DIR, 'files');

async function init(): Promise<Db> {
  await mkdir(FILES_DIR, { recursive: true });
  const client = new PGlite(path.join(DATA_DIR, 'pglite'));
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  // Déclare le schéma à Matrix (src/lib/matrix.ts) sans retarder le démarrage ; sans MATRIX_URL, rien n'est envoyé.
  void declarerSchemaCodex(<T,>(sql: string) => client.query<T>(sql).then((r) => r.rows)).catch(() => {});
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
