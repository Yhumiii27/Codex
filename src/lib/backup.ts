import 'server-only';
import path from 'node:path';
import { DATA_DIR, FILES_DIR, getDb } from '@/db';
import { embedded } from '@/db/sql-client';
import { backupDirOf, createBackup, journalData, keepOf, listBackups, readMigrations, type BackupResult } from './backup-core.mjs';
import { audit } from './lifecycle';
import { logger } from './log';
import { appVersion } from './version';

// Backups while the server runs (Administration › Journal d'audit › Sauvegardes): the archive of lib/backup-core.mjs,
// made from this process, which holds the database. Restoring needs the server stopped: npm run restore
// (docs/sauvegarde.md). Nothing is scheduled: how often, and where archives should live, are not decided.

const log = logger('backup');

/**
 * The application backs up again only this long after the latest archive, whatever made it: a run of clicks cannot
 * push the archives made before it out of the rotation (which also keeps the latest of each of the last days).
 */
export const ONLINE_MIN_INTERVAL_MS = 15 * 60_000;

/** Where archives go and how many rotation keeps (CODEX_BACKUP_DIR, CODEX_BACKUP_KEEP). */
export function backupSettings(env: Record<string, string | undefined> = process.env) {
  return { dir: backupDirOf(DATA_DIR, env), keep: keepOf(env) };
}

/**
 * Archives of the backup directory, newest first, with their manifest when `manifests` (not checked whole); null when
 * the directory cannot be read (logged): the Journal tab still shows.
 */
export async function backupList(manifests = true) {
  try {
    return await listBackups(backupSettings().dir, { manifests });
  } catch (err) {
    log.error('backup directory not readable', { dir: backupSettings().dir, err });
    return null;
  }
}

let running = false;

/**
 * Writes an archive now, journals it by `userId` (action 'backup_created', target the archive: its size, SHA-256 and
 * counts, no document named), and rotates the oldest out. 'busy' while another backup runs in this process; `recent`
 * (the latest archive's instant, and from when the next may be made) within ONLINE_MIN_INTERVAL_MS of the latest
 * archive. Writes wait while the database is dumped (seconds); the files are read afterwards. 'server' on a PostgreSQL
 * server (DATABASE_URL): Codex's archives copy PGlite's data directory, a server is backed up by its own tools
 * (docs/postgres.md).
 */
export async function backUpNow(userId: string): Promise<BackupResult | 'busy' | 'server' | { recent: string; next: string }> {
  if (running) return 'busy';
  const db = await getDb();
  const pglite = embedded(db.$client);
  if (!pglite) return 'server';
  running = true;
  try {
    const { dir, keep } = backupSettings();
    const latest = (await listBackups(dir, { manifests: false }))[0]?.createdAt;
    const age = latest ? Date.now() - Date.parse(latest) : NaN;
    // An archive dated in the future (a clock set back) does not hold the next one.
    if (latest && age >= 0 && age < ONLINE_MIN_INTERVAL_MS) return { recent: latest, next: new Date(Date.parse(latest) + ONLINE_MIN_INTERVAL_MS).toISOString() };
    const res = await createBackup({
      pg: pglite, filesDir: FILES_DIR, dbDir: path.join(DATA_DIR, 'pglite'), backupDir: dir, keep, mode: 'online', by: userId,
      migrations: await readMigrations(path.join(/*turbopackIgnore: true*/ process.cwd(), 'drizzle')), app: await appVersion(),
    });
    await audit(db, userId, 'backup_created', { kind: 'backup', id: res.name }, '', null, { backup: journalData(res.manifest, res) });
    log.info('backup created', { path: res.path, size: res.size, sha256: res.sha256, rotatedOut: res.removed.length ? res.removed : undefined });
    return res;
  } finally {
    running = false;
  }
}
