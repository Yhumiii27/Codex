#!/usr/bin/env node
// @ts-check
// Integrity check of the stored files from the command line (src/lib/integrity-core.mjs, point 31 of
// docs/reste-a-faire.md):
//
//   npm run integrity        reads every stored file again and compares it with its recorded SHA-256 (server stopped)
//
// The data directory is CODEX_DATA_DIR (default .data). Variables are read as Next reads them (@next/env), like
// scripts/codex-export.mjs; --dev reads those of `next dev`. Files kept by SharePoint are not read from here (counted as
// out of reach): from the application, Administration › Journal d'audit › Intégrité des fichiers reads them. The check
// is journaled in the database under the system actor Codex. Exit status: 0 when every file read matches, 1 when one is
// altered or missing, or the check failed.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import nextEnv from '@next/env';
import { pgliteOptions } from '../src/lib/pglite-options.mjs';
import { BackupError, LOCK_FILE, lockForCommand, lockPid, serverDatabaseRefusal, unlock } from '../src/lib/backup-core.mjs';
import { checkIntegrity, INTEGRITY_LIST_MAX } from '../src/lib/integrity-core.mjs';

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
      ? `Le serveur Codex tourne (processus ${lockPid(lock)}) et tient la base de ${DATA_DIR}.\nArrêtez-le (npm run dev, npm run start ou l'app Mac), ou lancez la vérification depuis Administration › Journal d'audit › Intégrité des fichiers.\nSi aucun serveur ne tourne plus, supprimez ${path.join(DATA_DIR, LOCK_FILE)}.`
      : `Une autre commande (${lock?.kind ?? err.detail}) travaille sur ${DATA_DIR} (processus ${lockPid(lock)}).\nSi aucune commande ne tourne plus, supprimez ${path.join(DATA_DIR, LOCK_FILE)} (sinon il est ignoré 10 minutes après son dernier rafraîchissement).`;
  }
  return `Erreur : ${err instanceof Error ? err.message : String(err)}`;
}

/**
 * A local file as a stream; null when the store has none; SharePoint is not reached from here.
 * @type {import('../src/lib/integrity-core.mjs').IntegrityOpener}
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

/** @param {{ doc: string, label: string }[]} xs @param {number} n */
const named = (xs, n) => `${xs.map((x) => `${x.doc} ${x.label}`).join(', ')}${n > xs.length ? ` … et ${n - xs.length} de plus` : ''}`;

async function check() {
  const refusal = serverDatabaseRefusal(process.env, 'npm run integrity', "Le contrôle se fait serveur en marche : Administration › Journal d'audit › Intégrité des fichiers.");
  if (refusal) throw new Error(refusal);
  const dbDir = path.join(DATA_DIR, 'pglite');
  if (!(await stat(path.join(dbDir, 'PG_VERSION')).then(() => true, () => false))) throw new Error(`aucune base Codex dans ${DATA_DIR} : rien à vérifier.`);
  await lockForCommand(DATA_DIR, 'integrity');
  try {
    const pg = new PGlite(pgliteOptions(dbDir));
    try {
      await pg.waitReady;
      const actor = (await pg.query(`select 1 from users where id = 'codex'`)).rows.length ? 'codex' : null;
      const res = await checkIntegrity({ pg, openFile, actor, by: 'cli' });
      const lines = [`Fichiers vérifiés : ${res.checked} (${size(res.bytes)})`];
      if (res.alteredCount) lines.push(`  ALTÉRÉS (contenu différent de l'empreinte SHA-256 enregistrée) : ${res.alteredCount} : ${named(res.altered, res.alteredCount)}`);
      if (res.missingCount) lines.push(`  ABSENTS du stockage : ${res.missingCount} : ${named(res.missing, res.missingCount)}`);
      if (res.filled) lines.push(`  Empreintes enregistrées pour des fichiers déposés avant leur calcul : ${res.filled}`);
      if (res.skipped) lines.push(`  Fichiers conservés sur SharePoint, non lus par la commande : ${res.skipped} (vérifiez depuis l'application)`);
      if (!res.alteredCount && !res.missingCount) lines.push('  Aucun écart.');
      if (res.alteredCount > INTEGRITY_LIST_MAX || res.missingCount > INTEGRITY_LIST_MAX) lines.push(`  (le journal nomme les ${INTEGRITY_LIST_MAX} premiers de chaque liste)`);
      if (!actor) lines.push('  (journal non écrit : la base n\'a pas d\'acteur système Codex)');
      console.log(lines.join('\n'));
      if (res.alteredCount || res.missingCount) process.exitCode = 1;
    } finally {
      await pg.close();
    }
  } finally {
    await unlock(DATA_DIR);
  }
}

async function main() {
  const [cmd = 'check', ...rest] = process.argv.slice(2).filter((a) => a !== '--dev');
  if (rest.length || cmd !== 'check') {
    console.error('Usage : codex-integrity.mjs [check] [--dev]');
    process.exitCode = 2;
    return;
  }
  header();
  await check();
}

main().catch((err) => {
  console.error(explain(err));
  process.exitCode = 1;
});
