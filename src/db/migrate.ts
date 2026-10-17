import 'server-only';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { DB_SCHEMA } from './schema';
import type { DB } from './types';

const JOURNAL = sql`${sql.identifier(DB_SCHEMA)}.${sql.identifier('__drizzle_migrations')}`;

/**
 * Applique les migrations de `migrationsFolder` absentes du journal, dans une seule transaction. Même journal que
 * migrate() de Drizzle avec migrationsSchema, sans son CREATE SCHEMA : le schéma existe déjà (serveur : créé par le
 * socle ; PGlite : créé par le module d'ouverture). Le verrou est pris avant de créer le journal : deux instances qui
 * démarrent ensemble appliquent chaque migration une seule fois.
 */
export async function migrateSchema(db: DB, migrationsFolder: string): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder });
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${DB_SCHEMA}.migrations`}))`);
    await tx.execute(sql`create table if not exists ${JOURNAL} (id serial primary key, hash text not null, created_at bigint)`);
    const { rows } = await tx.execute<{ created_at: string | number }>(sql`select created_at from ${JOURNAL} order by created_at desc limit 1`);
    const last = rows[0] ? Number(rows[0].created_at) : -1;
    for (const m of migrations) {
      if (m.folderMillis <= last) continue;
      for (const stmt of m.sql) if (stmt.trim()) await tx.execute(sql.raw(stmt));
      await tx.execute(sql`insert into ${JOURNAL} (hash, created_at) values (${m.hash}, ${m.folderMillis})`);
    }
  });
}
