// Applies the register of the code to an existing database (src/lib/registry-apply.ts, point 60 of
// docs/reste-a-faire.md), server stopped:
//
//   npm run registry:apply              simulation: what would change, nothing written
//   npm run registry:apply -- --apply   writes it, after a backup of the database and its files (npm run backup)
//
// The data directory is CODEX_DATA_DIR (default .data), variables read as Next reads them (@next/env), --dev for those
// of `next dev`, like the other commands. With DATABASE_URL (a PostgreSQL server, docs/postgres.md) it works on that
// server; Codex cannot back a server up, so --apply there needs --no-backup, said once the server's own backup is made. Refuses a database whose schema this code would still migrate: start Codex
// once first. Exit status: 0 when done (or nothing to do), 1 on an error, 2 on a wrong usage.

import { stat } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import nextEnv from '@next/env';
import { drizzle as drizzleServer } from 'drizzle-orm/node-postgres';
import { drizzle } from 'drizzle-orm/pglite';
import type { Db } from '../src/db';
import { appliedMigrations, migrationPlan } from '../src/db/migrations';
import * as schema from '../src/db/schema';
import { databaseUrlOf, PgServerClient, redactUrl, serverPool } from '../src/db/sql-client';
import { BackupError, backupDirOf, createBackup, journal, journalData, keepOf, LOCK_FILE, lockForCommand, lockPid, readMigrations, unlock } from '../src/lib/backup-core.mjs';
import { applyRegistry, type RegistryNote, type RegistryStep } from '../src/lib/registry-apply';

const args = process.argv.slice(2);
const DEV = args.includes('--dev') || process.env.NODE_ENV === 'development';
const WRITE = args.includes('--apply');
const NO_BACKUP = args.includes('--no-backup');
const MODE = process.env.NODE_ENV === 'test' ? 'test' : DEV ? 'development' : 'production';
const { loadedEnvFiles } = nextEnv.loadEnvConfig(process.cwd(), DEV, { info: () => {}, error: (...a: unknown[]) => console.error(...a) });

const DATA_DIR = path.resolve(process.env.CODEX_DATA_DIR ?? '.data');
const DB_DIR = path.join(DATA_DIR, 'pglite');
const MIGRATIONS = path.resolve('drizzle');

const KIND = { family: 'Famille', function: 'Fonction', type: 'Type' } as const;
const OP = { add: 'ajout', update: 'mise à jour', deactivate: 'désactivation (absent du registre)' } as const;

const show = (v: unknown) => {
  const text = v == null ? '—' : typeof v === 'string' ? v : JSON.stringify(v);
  return text.length > 70 ? `${text.slice(0, 67)}…` : text;
};

function stepLines(x: RegistryStep): string[] {
  const head = `  ${KIND[x.kind]} ${x.key} : ${OP[x.op]}`;
  if (x.op === 'add') return [head];
  return [head, ...x.changes.map((c) => `      ${c.field} : ${show(c.before)} → ${show(c.after)}`)];
}

function noteLine(n: RegistryNote): string {
  const what = `${KIND[n.kind]} ${n.key}`;
  switch (n.why) {
    case 'admin_fields': return `  ${what} : réglé dans l'administration, conservé (${n.fields?.join(', ')})`;
    case 'admin_added': return `  ${what} : créé dans l'administration, laissé tel quel`;
    case 'admin_removed': return `  ${what} : supprimé dans l'administration, non rétabli`;
    case 'admin_renamed': return `  ${what} : renommé ${n.to} dans l'administration, le registre s'applique sous ce code`;
    case 'code_clash': return `  ${what} : code déjà pris (${n.detail}), non ajouté : à arbitrer (O-05)`;
    case 'narrowing': return `  ${what} : ${n.fields?.join(', ')} non appliqué(s), ${n.count} document(s) en sortiraient : à confirmer dans Administration › Registre des types`;
    case 'invalid': return `  ${what} : réglage invalide (${n.detail}), rien appliqué`;
    case 'scope_locked': return `  ${what} : portée conservée (titulaires nommés ou fonction des règles de Codex)`;
    case 'absent': return `  ${what} : absent du registre du code${n.kind === 'type' ? '' : ', conservé'}`;
    case 'retention_docs': return `  ${what} : durée de conservation changée ; les documents gardent la leur (appliquer depuis l'administration si voulu)`;
  }
}

function explain(err: unknown): string {
  if (err instanceof BackupError && err.code === 'busy') {
    const lock = (err as unknown as { lock?: { kind: string; pid: number } }).lock;
    return lock?.kind === 'server'
      ? `Le serveur Codex tourne (processus ${lockPid(lock)}) et tient la base de ${DATA_DIR}.\nArrêtez-le (npm run dev, npm run start ou l'app Mac), puis relancez la commande.\nSi aucun serveur ne tourne plus, supprimez ${path.join(DATA_DIR, LOCK_FILE)}.`
      : `Une autre commande (${lock?.kind ?? err.detail}) travaille sur ${DATA_DIR} (processus ${lockPid(lock)}).\nSi aucune commande ne tourne plus, supprimez ${path.join(DATA_DIR, LOCK_FILE)}.`;
  }
  return `Erreur : ${err instanceof Error ? err.message : String(err)}`;
}

/** Simulation, then the changes when --apply: on the database `db` (PGlite's or a server's), `backUp` first. */
async function report(db: Db, backUp: () => Promise<void>) {
  const report = await applyRegistry(db, { write: false });
  const lines = [WRITE ? 'Registre du code → base :' : 'Simulation (rien n\'est écrit ; ajoutez -- --apply pour appliquer) :'];
  lines.push(report.steps.length ? `Changements (${report.steps.length}) :` : 'Aucun changement : la base suit déjà le registre du code.');
  report.steps.forEach((x) => lines.push(...stepLines(x)));
  if (report.notes.length) {
    lines.push(`Non appliqué ou à savoir (${report.notes.length}) :`);
    report.notes.forEach((n) => lines.push(noteLine(n)));
  }
  console.log(lines.join('\n'));
  if (!WRITE || !report.steps.length) return;
  await backUp();
  const done = await applyRegistry(db, { write: true });
  console.log(`Appliqué : ${done.steps.length} changement(s), chacun journalisé par Codex (« npm run registry:apply »).`);
}

/** The same on a PostgreSQL server (DATABASE_URL): no lock file, no archive (pg_dump first, then --no-backup). */
async function runServer(url: string) {
  console.log(`Base : serveur PostgreSQL ${redactUrl(url)}`);
  if (WRITE && !NO_BACKUP) throw new Error('Codex ne sait pas sauvegarder un serveur PostgreSQL : sauvegardez la base (pg_dump), puis relancez avec -- --apply --no-backup. Arrêtez Codex pendant l\'application, comme avec la base intégrée.');
  const pool = serverPool(url, 2);
  const client = new PgServerClient(pool);
  try {
    const plan = migrationPlan(await appliedMigrations(client), await readMigrations(MIGRATIONS));
    if (plan.fresh) throw new Error('la base du serveur est vide : démarrez Codex une fois pour la créer.');
    if (plan.pending.length) throw new Error(`la base n'a pas encore les migrations ${plan.pending.join(', ')} : appliquez-les (npm run db:migrate -- --no-backup, une fois le pg_dump fait), puis relancez la commande.`);
    const db = drizzleServer(pool, { schema }) as unknown as Db;
    await report(db, async () => {});
  } finally {
    await client.close();
  }
}

async function run() {
  const url = databaseUrlOf(process.env);
  if (url) return runServer(url);
  if (!(await stat(path.join(DB_DIR, 'PG_VERSION')).then(() => true, () => false))) throw new Error(`aucune base Codex dans ${DATA_DIR} : démarrez Codex une fois pour la créer (elle reçoit alors le registre du code).`);
  await lockForCommand(DATA_DIR, 'registry');
  try {
    const pg = new PGlite({ dataDir: DB_DIR, extensions: { pg_trgm } });
    try {
      await pg.waitReady;
      const code = await readMigrations(MIGRATIONS);
      const plan = migrationPlan(await appliedMigrations(pg), code);
      if (plan.fresh) throw new Error(`la base de ${DATA_DIR} est vide : démarrez Codex une fois pour la créer.`);
      if (plan.pending.length) throw new Error(`la base n'a pas encore les migrations ${plan.pending.join(', ')} : appliquez-les (npm run db:migrate, après une sauvegarde), puis relancez la commande.`);
      const db = drizzle(pg, { schema }) as unknown as Db;
      await report(db, async () => {
        if (NO_BACKUP) return;
        const res = await createBackup({
          pg, filesDir: path.join(DATA_DIR, 'files'), dbDir: DB_DIR, backupDir: backupDirOf(DATA_DIR, process.env), keep: keepOf(process.env),
          mode: 'offline', by: 'cli', migrations: code, app: null,
        });
        await journal(pg, 'backup_created', res.name, journalData(res.manifest, res), 'npm run registry:apply');
        console.log(`Sauvegarde avant écriture : ${res.path}`);
      });
    } finally {
      await pg.close();
    }
  } finally {
    await unlock(DATA_DIR);
  }
}

async function main() {
  const unknown = args.filter((a) => !['--dev', '--apply', '--no-backup'].includes(a));
  if (unknown.length) {
    console.error('Usage : npm run registry:apply [-- --apply [--no-backup]] [--dev]');
    process.exitCode = 2;
    return;
  }
  const files = loadedEnvFiles.map((f) => path.relative(process.cwd(), f.path) || f.path);
  console.log([
    `Dossier de données : ${DATA_DIR}`,
    files.length ? `Variables : environnement, puis ${files.join(', ')} (mode ${MODE === 'development' ? 'développement' : MODE})` : `Variables : environnement seul (aucun fichier .env du mode ${MODE === 'development' ? 'développement' : MODE})`,
  ].join('\n'));
  await run();
}

main().catch((err) => {
  console.error(explain(err));
  process.exitCode = 1;
});
