import 'server-only';
import path from 'node:path';
import { DATA_DIR, FILES_DIR, getDb } from '@/db';
import { embedded } from '@/db/sql-client';
import { backupDirOf, createBackup, journalData, keepOf, listBackups, readMigrations, type BackupResult } from './backup-core.mjs';
import { createFilesBackup, listFilesBackups, restoreFiles, type FilesBackupResult, type FilesRestoreResult } from './files-backup-core.mjs';
import { audit } from './lifecycle';
import { logger } from './log';
import { appVersion } from './version';

// Backups while the server runs (Administration › Journal d'audit › Sauvegardes): the archive of lib/backup-core.mjs,
// made from this process, which holds the database. Restoring needs the server stopped: npm run restore
// (docs/sauvegarde.md). Scheduled only when CODEX_SCHEDULE_BACKUP says how often (lib/scheduler.ts).
// On a PostgreSQL server (DATABASE_URL), the database is backed up by the server's own tools (pg_dump, dépôt Matrix) and
// Codex backs up the files only: an incremental copy of the files the database points to, with a state per run
// (lib/files-backup-core.mjs), which Administration can put back into the store (docs/stockage-serveur.md).

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

/** What a backup of this Codex holds: 'archive' (PGlite: the database and its files), 'files' (a server's database). */
export async function backupKind(): Promise<'archive' | 'files'> {
  return embedded((await getDb()).$client) ? 'archive' : 'files';
}

/** States of the files backup (a server's database), newest first; null when the directory cannot be read (logged). */
export async function filesBackupList(states = true) {
  try {
    return await listFilesBackups(backupSettings().dir, { states });
  } catch (err) {
    log.error('backup directory not readable', { dir: backupSettings().dir, err });
    return null;
  }
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

// On globalThis: the scheduler (lib/scheduler.ts) runs in the bundle of src/instrumentation.ts, apart from the Server
// Actions; both must see a run in progress.
const busy = ((globalThis as unknown as { __codexBusy?: Set<string> }).__codexBusy ??= new Set<string>());

/**
 * Writes an archive now, journals it by `userId` (action 'backup_created', target the archive: its size, SHA-256 and
 * counts, no document named), and rotates the oldest out. 'busy' while another backup runs in this process; `recent`
 * (the latest archive's instant, and from when the next may be made) within ONLINE_MIN_INTERVAL_MS of the latest
 * archive. Writes wait while the database is dumped (seconds); the files are read afterwards. On a PostgreSQL server
 * (DATABASE_URL), whose database is backed up by its own tools (docs/postgres.md): the files backup (backUpFiles).
 */
export async function backUpNow(userId: string): Promise<BackupResult | FilesBackup | 'busy' | { recent: string; next: string }> {
  if (busy.has('backup')) return 'busy';
  const db = await getDb();
  const pglite = embedded(db.$client);
  if (!pglite) return backUpFiles(db, userId);
  busy.add('backup');
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
    busy.delete('backup');
  }
}

/** A files backup made (a server's database): the state written, what it copied, what rotation removed. */
export type FilesBackup = FilesBackupResult & { kind: 'files' };

type Db = Awaited<ReturnType<typeof getDb>>;

/** The files part of backUpNow on a server's database: same wait between two runs, same journal entry. */
async function backUpFiles(db: Db, userId: string): Promise<FilesBackup | 'busy' | { recent: string; next: string }> {
  busy.add('backup');
  try {
    const { dir, keep } = backupSettings();
    const latest = (await listFilesBackups(dir))[0]?.createdAt;
    const age = latest ? Date.now() - Date.parse(latest) : NaN;
    if (latest && age >= 0 && age < ONLINE_MIN_INTERVAL_MS) return { recent: latest, next: new Date(Date.parse(latest) + ONLINE_MIN_INTERVAL_MS).toISOString() };
    const res = await createFilesBackup({ pg: db.$client, filesDir: FILES_DIR, backupDir: dir, keep, by: userId, app: await appVersion() });
    const f = res.state.files;
    await audit(db, userId, 'backup_created', { kind: 'backup', id: res.name }, '', null, {
      backup: {
        scope: 'files', archive: res.name, size: f.copiedBytes, documents: res.state.counts.documents, files: f.count, bytes: f.bytes,
        missing: f.missing.length, sharepoint: f.sharepoint, copied: f.copied, altered: f.altered.length,
      },
    });
    const level = f.missing.length || f.altered.length ? 'warn' : 'info';
    log[level]('files backup created', {
      path: res.path, files: f.count, bytes: f.bytes, copied: f.copied, copiedBytes: f.copiedBytes, missing: f.missing.length || undefined,
      altered: f.altered.length || undefined, rotatedOut: res.removed.length || undefined, pruned: res.pruned || undefined,
    });
    return { ...res, kind: 'files' };
  } finally {
    busy.delete('backup');
  }
}

/**
 * Puts back into the store, from the files backup, the files the database points to that the store lacks (after the
 * database was restored, or the volume of the files lost); journaled 'files_restored' by `userId`. Never replaces nor
 * removes a file: safe while the server runs. 'archive' with the embedded database: its archives are restored whole,
 * server stopped (npm run restore); 'busy' while a backup or another restore runs in this process.
 */
export async function restoreFilesNow(userId: string): Promise<FilesRestoreResult | 'busy' | 'archive'> {
  const db = await getDb();
  if (embedded(db.$client)) return 'archive';
  if (busy.has('backup') || busy.has('files-restore')) return 'busy';
  busy.add('files-restore');
  try {
    const res = await restoreFiles({ pg: db.$client, filesDir: FILES_DIR, backupDir: backupSettings().dir });
    await audit(db, userId, 'files_restored', { kind: 'backup', id: 'fichiers' }, '', null, {
      backup: {
        scope: 'files', archive: 'fichiers', size: res.restoredBytes, documents: 0, files: res.restored.length, bytes: res.restoredBytes,
        missing: res.notInBackup.length, sharepoint: 0, altered: res.altered.length,
      },
    });
    const level = res.notInBackup.length || res.altered.length ? 'warn' : 'info';
    log[level]('files restored', {
      referenced: res.referenced, present: res.present, restored: res.restored.length, bytes: res.restoredBytes,
      notInBackup: res.notInBackup.length || undefined, altered: res.altered.length || undefined,
    });
    return res;
  } finally {
    busy.delete('files-restore');
  }
}
