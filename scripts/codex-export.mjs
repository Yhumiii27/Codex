#!/usr/bin/env node
// @ts-check
// Full export of Codex's data from the command line (src/lib/export-core.mjs; format: docs/export.md).
//
//   npm run export [-- --out <file or directory>]   archive of every table and every file (server stopped)
//   npm run export:check -- <archive>               checks an archive: entries, CRC-32 and SHA-256, manifest
//
// The data directory is CODEX_DATA_DIR (default .data); the archive goes, unless --out says otherwise, beside it, in
// <data directory>-exports (.data-exports), outside the data directory so that `npm run db:reset` leaves it. Variables
// are read as Next reads them (@next/env), like scripts/codex-backup.mjs; --dev reads those of `next dev`. The server
// holds the database while it runs: from the application, Administration › Journal d'audit › Export complet gives the
// same archive. The export is journaled in the database under the system actor Codex.

import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import nextEnv from '@next/env';
import { pgliteOptions } from '../src/lib/pglite-options.mjs';
import { BackupError, LOCK_FILE, lockForCommand, lockPid, readMigrations, serverDatabaseRefusal, unlock } from '../src/lib/backup-core.mjs';
import { ExportError, exportArchive, exportName, verifyExport } from '../src/lib/export-core.mjs';

const DEV = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
const MODE = process.env.NODE_ENV === 'test' ? 'test' : DEV ? 'development' : 'production';
const { loadedEnvFiles } = nextEnv.loadEnvConfig(process.cwd(), DEV, { info: () => {}, error: (...a) => console.error(...a) });

const DATA_DIR = path.resolve(process.env.CODEX_DATA_DIR ?? '.data');
const FILES_DIR = path.join(DATA_DIR, 'files');

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

function header() {
  const files = loadedEnvFiles.map((f) => path.relative(process.cwd(), f.path) || f.path);
  const mode = MODE === 'development' ? 'développement' : MODE;
  console.log([
    `Dossier de données : ${DATA_DIR}`,
    files.length ? `Variables : environnement, puis ${files.join(', ')} (mode ${mode})` : `Variables : environnement seul (aucun fichier .env du mode ${mode})`,
  ].join('\n'));
}

/** @param {unknown} err */
function explain(err) {
  if (err instanceof BackupError && err.code === 'busy') {
    const lock = /** @type {{ lock?: { kind: string, pid: number } }} */ (/** @type {unknown} */ (err)).lock;
    return lock?.kind === 'server'
      ? `Le serveur Codex tourne (processus ${lockPid(lock)}) et tient la base de ${DATA_DIR}.\nArrêtez-le (npm run dev, npm run start ou l'app Mac), ou téléchargez l'export depuis Administration › Journal d'audit › Export complet.\nSi aucun serveur ne tourne plus, supprimez ${path.join(DATA_DIR, LOCK_FILE)}.`
      : `Une autre commande (${lock?.kind ?? err.detail}) travaille sur ${DATA_DIR} (processus ${lockPid(lock)}).\nSi aucune commande ne tourne plus, supprimez ${path.join(DATA_DIR, LOCK_FILE)} (sinon il est ignoré 10 minutes après son dernier rafraîchissement).`;
  }
  if (err instanceof ExportError) {
    const d = err.detail;
    switch (err.code) {
      case 'not_zip': return `Ce fichier n'est pas une archive ZIP lisible${d ? ` (${d})` : ''}.`;
      case 'truncated': return 'Archive tronquée : elle s\'arrête avant sa fin.';
      case 'unsupported': return `Archive refusée : ${d}. Un export de Codex n'est ni compressé, ni chiffré, ni découpé.`;
      case 'format': return `Ce n'est pas un export Codex lisible par cette version (${d}).`;
      case 'entry_missing': return `Archive incomplète : « ${d} » manque.`;
      case 'entry_unexpected': return `Archive refusée : « ${d} » n'est pas listée par le manifeste.`;
      case 'entry_corrupt': return `Archive altérée : « ${d} » ne correspond pas à sa taille, à son CRC-32 ou à son empreinte SHA-256.`;
      case 'sums_mismatch': return 'Archive altérée : SHA256SUMS ne correspond pas au manifeste.';
      case 'entry_too_large': return `Le fichier « ${d} » atteint 4 Go : un export ZIP ne peut pas le contenir.`;
      default: return err.message;
    }
  }
  return `Erreur : ${err instanceof Error ? err.message : String(err)}`;
}

/** @param {import('../src/lib/export-core.mjs').Manifest} m */
function describe(m) {
  const lines = [
    `  ${m.counts.documents ?? 0} documents, ${m.counts.revisions ?? 0} révisions, ${m.counts.working_versions ?? 0} versions de travail, ${m.counts.workflows ?? 0} circuits, ${m.counts.change_requests ?? 0} demandes Vigie, ${m.counts.audit_log ?? 0} entrées de journal`,
    `  ${m.files.count} fichiers (${size(m.files.bytes)}), migration ${m.schema.migration ?? m.schema.hash?.slice(0, 12) ?? '?'}, ${m.schema.postgres}`,
  ];
  if (m.files.missing.length) lines.push(`  Attention : ${m.files.missing.length} fichier(s) référencé(s) par la base manquaient au stockage : ${m.files.missing.map((x) => x.path).join(', ')}`);
  if (m.files.altered?.length) lines.push(`  Attention : ${m.files.altered.length} fichier(s) ne correspondent plus à l'empreinte SHA-256 enregistrée à leur dépôt (archivés tels quels) : ${m.files.altered.map((x) => x.path).join(', ')}`);
  if (m.files.skipped.length) lines.push(`  Attention : ${m.files.skipped.length} fichier(s) stocké(s) sur SharePoint ne sont pas dans l'archive (exportez depuis l'application pour les inclure).`);
  return lines.join('\n');
}

/**
 * A local file as a stream; null when the store has none; SharePoint is not reached from here.
 * @type {import('../src/lib/export-core.mjs').FileOpener}
 */
async function openFile(f) {
  if (f.storage === 'sharepoint') return 'skipped';
  const file = path.join(FILES_DIR, path.basename(f.fileKey));
  try {
    if (!(await stat(file)).isFile()) return null;
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return null;
    throw err;
  }
  return createReadStream(file);
}

/**
 * Where the archive goes: --out (a file, or a directory to put it in), else <data directory>-exports.
 * @param {string | undefined} out
 * @param {string} name
 */
async function target(out, name) {
  if (!out) return path.join(`${DATA_DIR}-exports`, name);
  const p = path.resolve(out);
  const isDir = out.endsWith('/') || out.endsWith(path.sep) || (await stat(p).then((st) => st.isDirectory(), () => false));
  return isDir ? path.join(p, name) : p;
}

/** @param {string | undefined} out */
async function create(out) {
  const refusal = serverDatabaseRefusal(process.env, 'npm run export', "L'export complet se fait serveur en marche : Administration › Journal d'audit › Export complet.");
  if (refusal) throw new Error(refusal);
  const dbDir = path.join(DATA_DIR, 'pglite');
  if (!(await stat(path.join(dbDir, 'PG_VERSION')).then(() => true, () => false))) throw new Error(`aucune base Codex dans ${DATA_DIR} : rien à exporter.`);
  const now = new Date();
  const file = await target(out, exportName(now));
  const rel = path.relative(DATA_DIR, file);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw new Error(`l'archive ne peut pas être écrite dans le dossier de données (${file}).`);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await lockForCommand(DATA_DIR, 'export');
  const partial = `${file}.partial`;
  try {
    const pg = new PGlite(pgliteOptions(dbDir));
    try {
      await pg.waitReady;
      const actor = (await pg.query(`select 1 from users where id = 'codex'`)).rows.length ? 'codex' : null;
      const fh = await open(partial, 'wx', 0o600);
      /** @type {import('../src/lib/export-core.mjs').ExportResult | undefined} */
      let res;
      try {
        const it = exportArchive({ pg, openFile, actor, mode: 'offline', by: 'cli', now, migrations: await readMigrations(path.resolve('drizzle')), app: await appVersion() });
        for (let r = await it.next(); ; r = await it.next()) {
          if (r.done) {
            res = r.value;
            break;
          }
          for (let off = 0; off < r.value.length;) off += (await fh.write(r.value, off, r.value.length - off)).bytesWritten;
        }
        await fh.sync();
      } finally {
        await fh.close();
      }
      // Read back whole before it takes its name.
      const check = await open(partial, 'r');
      try {
        await verifyExport(check);
      } finally {
        await check.close();
      }
      await rename(partial, file);
      if (!res) throw new Error('export inachevé');
      console.log(`Export écrit et vérifié : ${file}\n  ${size(res.size)}, SHA-256 ${res.sha256}\n${describe(res.manifest)}`);
      if (!actor) console.log('  (journal non écrit : la base n\'a pas d\'acteur système Codex)');
      console.log('  Il contient tous les documents, brouillons et confidentiels compris : à conserver en lieu sûr.');
    } finally {
      await pg.close();
    }
  } catch (err) {
    await rm(partial, { force: true });
    throw err;
  } finally {
    await unlock(DATA_DIR);
  }
}

/** @param {string | undefined} arg */
async function check(arg) {
  if (!arg) throw new Error('indiquez l\'archive à vérifier.');
  const file = path.resolve(arg);
  const fh = await open(file, 'r').catch((err) => {
    throw err.code === 'ENOENT' ? new Error(`archive introuvable : ${file}`) : err;
  });
  try {
    const m = await verifyExport(fh);
    console.log(`Archive intacte : ${file}\n  faite le ${new Date(m.createdAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}, ${m.mode === 'online' ? `depuis l'application (${m.by})` : 'en ligne de commande'}, Codex ${m.app ?? '?'}\n${describe(m)}`);
  } finally {
    await fh.close();
  }
}

async function appVersion() {
  try {
    return JSON.parse(await readFile('package.json', 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  /** @type {string | undefined} */
  let out;
  /** @type {string[]} */
  const args = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--out' && cmd === 'create') out = rest[++i];
    else if (rest[i] === '--dev') continue;
    else if (rest[i].startsWith('--')) throw new Error(`option inconnue : ${rest[i]}`);
    else args.push(rest[i]);
  }
  if (cmd === 'create' && rest.includes('--out') && !out) throw new Error('--out attend un fichier ou un dossier.');
  switch (cmd) {
    case 'create':
      header();
      return create(out);
    case 'check':
      return check(args[0]);
    default:
      console.error('Usage : codex-export.mjs create [--out <fichier ou dossier>] | check <archive>  [--dev]');
      process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(explain(err));
  process.exitCode = 1;
});
