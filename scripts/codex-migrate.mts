// Applies the pending migrations of drizzle/ to the database, at deployment rather than at the first request of the
// server (point 51 of docs/reste-a-faire.md; docs/exploitation.md):
//
//   npm run db:migrate                 the pending migrations, after a backup of the database and its files
//   npm run db:migrate -- --check      says which are pending, changes nothing (exit status 1 when some are)
//   npm run db:migrate -- --no-backup  without the backup (as CODEX_MIGRATION_BACKUP=off)
//
// The same work as the start of the server (src/db/index.ts openDb): the database is checked against the code's
// migrations (one made by another schema is refused), the pending ones are applied in one transaction, then the
// functions and triggers are laid; the server, started afterwards, finds nothing left to do. It still migrates by
// itself when the command was not run. Nothing is seeded: a new database gets its data at the first start (CODEX_SEED).
//
// PGlite (CODEX_DATA_DIR, default .data): server stopped (the lock of the data directory refuses otherwise), backup
// written as by `npm run backup` and journaled. A PostgreSQL server (DATABASE_URL): Codex cannot back it up, so a
// database that holds data is migrated only with --no-backup (or CODEX_MIGRATION_BACKUP=off), once pg_dump is done;
// several processes may run it at once (advisory lock). Variables are read as Next reads them (@next/env), --dev for
// those of `next dev`. Exit status: 0 done or nothing to do, 1 an error (or, with --check, migrations pending), 2 a
// wrong usage.

import { stat } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import nextEnv from '@next/env';

const args = process.argv.slice(2);
const DEV = args.includes('--dev') || process.env.NODE_ENV === 'development';
const CHECK = args.includes('--check');
const NO_BACKUP = args.includes('--no-backup') || /^(0|false|off|no)$/i.test(process.env.CODEX_MIGRATION_BACKUP?.trim() ?? '');
nextEnv.loadEnvConfig(process.cwd(), DEV, { info: () => {}, error: (...a: unknown[]) => console.error(...a) });

// Imported once the variables are loaded: src/db reads CODEX_DATA_DIR when it is loaded.
const { DATA_DIR, FILES_DIR, MIGRATIONS_DIR, openDb } = await import('../src/db/index');
const { appliedMigrations, migrationPlan } = await import('../src/db/migrations');
const { databaseUrlOf, PgServerClient, redactUrl, serverPool } = await import('../src/db/sql-client');
const { BackupError, backupDirOf, createBackup, journal, journalData, keepOf, LOCK_FILE, lockForCommand, lockPid, readMigrations, unlock } = await import('../src/lib/backup-core.mjs');

const DB_DIR = path.join(DATA_DIR, 'pglite');

function explain(err: unknown): string {
  if (err instanceof BackupError && err.code === 'busy') {
    const lock = (err as unknown as { lock?: { kind: string; pid: number } }).lock;
    return lock?.kind === 'server'
      ? `Le serveur Codex tourne (processus ${lockPid(lock)}) et tient la base de ${DATA_DIR}.\nArrêtez-le, appliquez les migrations, puis démarrez la nouvelle version.\nSi aucun serveur ne tourne plus, supprimez ${path.join(DATA_DIR, LOCK_FILE)}.`
      : `Une autre commande (${lock?.kind ?? err.detail}) travaille sur ${DATA_DIR} (processus ${lockPid(lock)}).\nSi aucune commande ne tourne plus, supprimez ${path.join(DATA_DIR, LOCK_FILE)}.`;
  }
  return `Erreur : ${err instanceof Error ? err.message : String(err)}`;
}

const say = (pending: string[], fresh: boolean) =>
  fresh ? `Base neuve : ${pending.length} migration(s) à appliquer (${pending.join(', ')}).`
    : pending.length ? `Migration(s) en attente : ${pending.join(', ')}.` : 'Aucune migration en attente : la base suit le schéma du code.';

async function runServer(url: string) {
  console.log(`Base : serveur PostgreSQL ${redactUrl(url)}`);
  const pool = serverPool(url, 2);
  const client = new PgServerClient(pool);
  let plan;
  try {
    plan = migrationPlan(await appliedMigrations(client), await readMigrations(MIGRATIONS_DIR));
  } finally {
    await client.close();
  }
  console.log(say(plan.pending, plan.fresh));
  if (CHECK) {
    if (plan.pending.length) process.exitCode = 1;
    return;
  }
  // Also lays the functions and triggers, which a new version of the code may have changed.
  const db = await openDb({ url }, {
    beforeMigrate: async (_client, p) => {
      if (p.fresh || NO_BACKUP) return;
      throw new Error(`Codex ne sait pas sauvegarder un serveur PostgreSQL (docs/postgres.md) : sauvegardez la base (pg_dump), puis relancez avec -- --no-backup. Rien n'a été changé.`);
    },
  });
  await db.$client.close();
  console.log(plan.pending.length ? `Appliquée(s) : ${plan.pending.join(', ')}.` : 'Fonctions et déclencheurs reposés.');
}

async function runPglite() {
  console.log(`Dossier de données : ${DATA_DIR}`);
  const exists = await stat(path.join(DB_DIR, 'PG_VERSION')).then(() => true, () => false);
  await lockForCommand(DATA_DIR, 'migrate');
  try {
    const code = await readMigrations(MIGRATIONS_DIR);
    let plan = { fresh: true, pending: code.map((m: { tag: string }) => m.tag) };
    if (exists) {
      const pg = new PGlite({ dataDir: DB_DIR, extensions: { pg_trgm } });
      try {
        await pg.waitReady;
        plan = migrationPlan(await appliedMigrations(pg), code);
        console.log(say(plan.pending, plan.fresh));
        if (CHECK) {
          if (plan.pending.length) process.exitCode = 1;
          return;
        }
        if (plan.pending.length && !plan.fresh && !NO_BACKUP) {
          const res = await createBackup({
            pg, filesDir: FILES_DIR, dbDir: DB_DIR, backupDir: backupDirOf(DATA_DIR, process.env), keep: keepOf(process.env),
            mode: 'offline', by: 'cli', migrations: code, app: null,
          });
          // Journaled once the migrations are applied (the journal's own table may change), as the server does.
          plan = Object.assign(plan, { archive: res });
          console.log(`Sauvegarde avant migration : ${res.path}`);
        }
      } finally {
        await pg.close();
      }
    } else {
      console.log(say(plan.pending, true));
      if (CHECK) {
        process.exitCode = 1;
        return;
      }
    }
    const db = await openDb(DB_DIR);
    try {
      const archive = (plan as { archive?: Awaited<ReturnType<typeof createBackup>> }).archive;
      if (archive) await journal(db.$client, 'backup_created', archive.name, journalData(archive.manifest, archive), `npm run db:migrate (${plan.pending.join(', ')})`);
    } finally {
      await db.$client.close();
    }
    console.log(plan.pending.length ? `Appliquée(s) : ${plan.pending.join(', ')}.` : 'Fonctions et déclencheurs reposés.');
  } finally {
    await unlock(DATA_DIR);
  }
}

async function main() {
  const unknown = args.filter((a) => !['--dev', '--check', '--no-backup'].includes(a));
  if (unknown.length) {
    console.error('Usage : npm run db:migrate [-- --check | --no-backup] [--dev]');
    process.exitCode = 2;
    return;
  }
  const url = databaseUrlOf(process.env);
  if (url) await runServer(url);
  else await runPglite();
}

main().catch((err) => {
  console.error(explain(err));
  process.exitCode = 1;
});
