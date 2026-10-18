#!/usr/bin/env node
// @ts-check
// Backup and restore of Codex's data from the command line (src/lib/backup-core.mjs; runbook: docs/sauvegarde.md).
//
//   npm run backup                              archive of the database and of the files it points to (server stopped)
//   npm run backup:list                         archives of the backup directory, newest first
//   npm run backup:check -- <archive>           checks an archive: manifest, SHA-256 of every entry, schema of this code
//   npm run restore -- <archive> [--replace]    restores an archive into the data directory (server stopped)
//
// <archive>: a path, the name of an archive of the backup directory, or "latest". The data directory is CODEX_DATA_DIR
// (default .data), the backup directory CODEX_BACKUP_DIR (default: beside it, .data-backups), rotation CODEX_BACKUP_KEEP
// (default 7). They are read as Next reads them (@next/env): the environment first, then the .env files of `next start`
// and of the Mac app (.env.production.local, .env.local, .env.production, .env), or with --dev (or NODE_ENV=development)
// those of `next dev` (.env.development.local, .env.local, .env.development, .env). Every command first says which
// directories it works on and which files it read. Messages are in French, like the application.

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import nextEnv from '@next/env';
import {
  BackupError, LOCK_FILE, backupDirOf, createBackup, journal, journalData, keepOf, listBackups, lockForCommand, lockPid, pendingMigrations,
  readMigrations, restoreBackup, serverDatabaseRefusal, unlock, verifyArchive,
} from '../src/lib/backup-core.mjs';

const DEV = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
const MODE = process.env.NODE_ENV === 'test' ? 'test' : DEV ? 'development' : 'production';
const { loadedEnvFiles } = nextEnv.loadEnvConfig(process.cwd(), DEV, { info: () => {}, error: (...a) => console.error(...a) });

const env = process.env;
const DATA_DIR = path.resolve(env.CODEX_DATA_DIR ?? '.data');
const BACKUP_DIR = backupDirOf(DATA_DIR, env);
const MIGRATIONS = path.resolve('drizzle');

/** Which directories the command works on, and where their settings come from. */
function header() {
  const files = loadedEnvFiles.map((f) => path.relative(process.cwd(), f.path) || f.path);
  const mode = MODE === 'development' ? 'développement' : MODE;
  console.log([
    `Dossier de données : ${DATA_DIR}`,
    `Dossier des sauvegardes : ${BACKUP_DIR}`,
    files.length ? `Variables : environnement, puis ${files.join(', ')} (mode ${mode})` : `Variables : environnement seul (aucun fichier .env du mode ${mode})`,
  ].join('\n'));
}

/** What rotation keeps (lib/backup-core.mjs rotate). */
function rotation() {
  const n = keepOf(env);
  return `les ${n} plus récentes et la plus récente de chacun des ${n} derniers jours`;
}

/** @param {number} n */
function size(n) {
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i ? v.toFixed(1).replace('.', ',') : v} ${units[i]}`;
}

/** @param {string} iso */
function when(iso) {
  return new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'medium' });
}

/** @param {unknown} err */
function explain(err) {
  if (!(err instanceof BackupError)) return `Erreur : ${err instanceof Error ? err.message : String(err)}`;
  const d = err.detail;
  switch (err.code) {
    case 'busy': {
      const lock = /** @type {{ lock?: { kind: string, pid: number } }} */ (/** @type {unknown} */ (err)).lock;
      return lock?.kind === 'server'
        ? `Le serveur Codex tourne (processus ${lockPid(lock)}) et tient la base de ${DATA_DIR}.\nArrêtez-le (npm run dev, npm run start ou l'app Mac), ou sauvegardez depuis Administration › Journal d'audit › Sauvegardes.\nSi aucun serveur ne tourne plus, supprimez ${path.join(DATA_DIR, LOCK_FILE)}.`
        : `Une autre commande (${lock?.kind ?? d}) travaille sur ${DATA_DIR} (processus ${lockPid(lock)}).\nSi aucune commande ne tourne plus, supprimez ${path.join(DATA_DIR, LOCK_FILE)} (sinon il est ignoré 10 minutes après son dernier rafraîchissement).`;
    }
    case 'no_database': return `Aucune base Codex dans ${DATA_DIR} : rien à sauvegarder${d ? ` (${d})` : ''}.`;
    case 'backup_dir': return `Le dossier des sauvegardes (${d}) ne peut pas être dans la base ni dans les fichiers, ni les contenir : choisissez un autre CODEX_BACKUP_DIR.`;
    case 'target_exists': return `${d} contient déjà une base ou des fichiers.\nPour les remplacer, relancez avec --replace : ils seront déplacés dans ${path.join(d, 'replaced-<date>')}, pas supprimés.`;
    case 'not_found': return `Archive introuvable : ${d}`;
    case 'not_archive': return `Ce fichier n'est pas une archive tar lisible${d ? ` (${d})` : ''}.`;
    case 'truncated': return 'Archive tronquée : elle s\'arrête avant sa fin.';
    case 'format': return `Ce n'est pas une sauvegarde Codex lisible par cette version (${d}).`;
    case 'entry_name': return `Archive refusée : entrée inattendue « ${d} ».`;
    case 'entry_missing': return `Archive incomplète : « ${d} », listée par le manifeste, manque.`;
    case 'entry_unexpected': return `Archive refusée : « ${d} » n'est pas listée par le manifeste.`;
    case 'entry_corrupt': return `Archive altérée : « ${d} » ne correspond pas à sa taille ou à son empreinte SHA-256.`;
    case 'schema_mismatch': return `L'archive a été faite avec une migration du schéma (${d}) que ce code ne connaît pas (drizzle/).\nRestaurez-la avec la version de Codex qui l'a produite (git), qui appliquera ensuite les migrations suivantes.`;
    case 'content_mismatch': return `La base restaurée ne correspond pas au manifeste (${d}) : rien n'a été remplacé.`;
    case 'swap_failed': return `La mise en place de la restauration a échoué (${d}).\nLa base et les fichiers d'origine ont été remis en place : rien n'a été remplacé.`;
    case 'swap_incomplete': {
      const x = /** @type {{ reason?: string, staging?: string, aside?: string | null, left?: { from: string, to: string }[] }} */ (/** @type {unknown} */ (err));
      return [
        `La mise en place de la restauration a échoué (${x.reason ?? d}), et le retour arrière n'a pas abouti.`,
        `Ne relancez pas le serveur avant d'avoir remis ${DATA_DIR} en ordre :`,
        `  contenu extrait de l'archive, gardé : ${x.staging ?? '?'}`,
        x.aside ? `  base et fichiers d'origine mis de côté : ${x.aside}` : '',
        '  entrées à remettre à leur place (où elles sont → où elles étaient) :',
        ...(x.left ?? []).map((m) => `    ${m.to} → ${m.from}`),
      ].filter(Boolean).join('\n');
    }
    default: return err.message;
  }
}

/** @param {string | undefined} arg */
async function archivePath(arg) {
  if (!arg) throw new Error('indiquez l\'archive : un chemin, un nom du dossier des sauvegardes, ou latest.');
  if (arg === 'latest') {
    const [last] = await listBackups(BACKUP_DIR, { manifests: false });
    if (!last) throw new Error(`aucune sauvegarde dans ${BACKUP_DIR}.`);
    return last.path;
  }
  if (!arg.includes('/') && !arg.includes(path.sep)) {
    const inDir = path.join(BACKUP_DIR, arg);
    if (await stat(inDir).then((st) => st.isFile(), () => false)) return inDir;
  }
  return path.resolve(arg);
}

/** @param {import('../src/lib/backup-core.mjs').Manifest} m */
function describe(m) {
  const origin = m.mode === 'online' ? `depuis l'application (${m.by})` : 'en ligne de commande, serveur arrêté';
  const lines = [
    `  faite le ${when(m.createdAt)}, ${origin}, Codex ${m.app ?? '?'}`,
    `  ${m.counts.documents} documents, ${m.counts.revisions} révisions, ${m.counts.workingVersions} versions de travail, ${m.counts.auditEntries} entrées de journal`,
    `  ${m.files.count} fichiers (${size(m.files.bytes)}), migration ${m.database.migration.tag ?? m.database.migration.hash.slice(0, 12)}, ${m.database.postgres}`,
  ];
  if (m.files.missing.length) lines.push(`  Attention : ${m.files.missing.length} fichier(s) référencé(s) par la base manquaient au stockage : ${m.files.missing.join(', ')}`);
  if (m.files.sharepoint) lines.push(`  Attention : ${m.files.sharepoint} fichier(s) stocké(s) sur SharePoint ne sont pas dans l'archive.`);
  return lines.join('\n');
}

async function appVersion() {
  try {
    return JSON.parse(await readFile('package.json', 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

async function create() {
  const refusal = serverDatabaseRefusal(process.env, 'npm run backup', "Sauvegardez la base avec les outils du serveur (pg_dump, instantanés de l'hébergeur) et le dossier des fichiers à part.");
  if (refusal) throw new Error(refusal);
  const dbDir = path.join(DATA_DIR, 'pglite');
  if (!(await stat(path.join(dbDir, 'PG_VERSION')).then(() => true, () => false))) throw new BackupError('no_database');
  await lockForCommand(DATA_DIR, 'backup');
  try {
    const pg = new PGlite({ dataDir: dbDir, extensions: { pg_trgm } });
    try {
      await pg.waitReady;
      const res = await createBackup({
        pg, filesDir: path.join(DATA_DIR, 'files'), dbDir, backupDir: BACKUP_DIR, keep: keepOf(env), mode: 'offline', by: 'cli',
        migrations: await readMigrations(MIGRATIONS), app: await appVersion(),
      });
      await journal(pg, 'backup_created', res.name, journalData(res.manifest, res));
      console.log(`Sauvegarde créée : ${res.path}\n  ${size(res.size)}, SHA-256 ${res.sha256}\n${describe(res.manifest)}`);
      if (res.removed.length) console.log(`Rotation (${rotation()}) : supprimé ${res.removed.join(', ')}`);
    } finally {
      await pg.close();
    }
  } finally {
    await unlock(DATA_DIR);
  }
}

/** @param {string | undefined} arg */
async function check(arg) {
  const file = await archivePath(arg);
  const m = await verifyArchive(file);
  console.log(`Archive intacte : ${file}\n${describe(m)}`);
  const pending = pendingMigrations(m, await readMigrations(MIGRATIONS));
  console.log(pending.length ? `  Restaurable par ce code ; migrations appliquées au démarrage : ${pending.join(', ')}` : '  Restaurable par ce code (même schéma).');
}

/**
 * @param {string | undefined} arg
 * @param {boolean} replace
 */
async function restore(arg, replace) {
  const refusal = serverDatabaseRefusal(process.env, 'npm run restore', 'Une archive de Codex contient une base PGlite : elle ne se restaure pas dans un serveur. Restaurez la sauvegarde du serveur (pg_restore).');
  if (refusal) throw new Error(refusal);
  const file = await archivePath(arg);
  await lockForCommand(DATA_DIR, 'restore');
  try {
    const res = await restoreBackup({ archive: file, dataDir: DATA_DIR, replace, PGlite, extensions: { pg_trgm }, migrations: await readMigrations(MIGRATIONS) });
    console.log(`Base et fichiers restaurés dans ${DATA_DIR} depuis ${file}\n${describe(res.manifest)}`);
    if (res.aside) console.log(`  Base et fichiers remplacés mis de côté dans ${res.aside} (à supprimer une fois la restauration vérifiée).`);
    if (res.pending.length) console.log(`  Migrations appliquées au prochain démarrage : ${res.pending.join(', ')}`);
    if (!res.journaled) console.log('  (journal non écrit : la base n\'a pas d\'acteur système Codex)');
    console.log('Relancez le serveur (npm run dev, npm run start ou l\'app Mac).');
  } finally {
    await unlock(DATA_DIR);
  }
}

async function list() {
  const items = await listBackups(BACKUP_DIR);
  if (!items.length) {
    console.log(`Aucune sauvegarde dans ${BACKUP_DIR}.`);
    return;
  }
  console.log(`${BACKUP_DIR} (rotation : ${rotation()}) :`);
  for (const x of items) {
    const m = x.manifest;
    console.log(`  ${x.name}  ${size(x.size)}  ${m ? `${m.counts.documents} documents, ${m.files.count} fichiers, ${m.mode === 'online' ? m.by : 'ligne de commande'}` : 'manifeste illisible'}`);
  }
}

const COMMANDS = ['create', 'list', 'check', 'restore'];

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const args = rest.filter((a) => !a.startsWith('--'));
  const unknown = [...flags].filter((f) => f !== '--dev' && !(cmd === 'restore' && f === '--replace'));
  if (unknown.length) throw new Error(`option inconnue : ${unknown.join(' ')}`);
  if (COMMANDS.includes(cmd)) header();
  switch (cmd) {
    case 'create': return create();
    case 'list': return list();
    case 'check': return check(args[0]);
    case 'restore': return restore(args[0], flags.has('--replace'));
    default:
      console.error('Usage : codex-backup.mjs create | list | check <archive> | restore <archive> [--replace]  [--dev]');
      process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(explain(err));
  process.exitCode = 1;
});
