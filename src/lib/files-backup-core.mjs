// @ts-check
// Backup of the stored files when the database is on a PostgreSQL server (DATABASE_URL; decision of 2 November 2026:
// the document library is kept on our own server, docs/stockage-serveur.md). The server's database is backed up by
// the shared server's own tools (dépôt Matrix, infra/postgres/sauvegarde : pg_dump nightly); the files the database
// points to are not in it: they stay in the local store ($CODEX_DATA_DIR/files). This module copies them into the
// backup directory, incrementally:
//
//   <backup dir>/fichiers/objets/<key>                          one copy of each stored file, under the key the
//                                                               database records (a stored file is never written again:
//                                                               lib/storage.ts writes with 'wx')
//   <backup dir>/fichiers/codex-fichiers-<UTC instant>.json     a state: every file the database pointed to at that
//                                                               instant, with its size and SHA-256
//
// A file is copied once, when first seen, and checked against the SHA-256 recorded when it entered Codex; a later state
// only lists it. Rotation keeps the states as the archives of lib/backup-core.mjs are kept (the `keep` most recent and
// the most recent of each of the `keep` latest days), then removes the copies no kept state lists.
//
// Restoring puts back, into the store, the files the database points to now and the store lacks (after the database
// was restored from a pg_dump, or a volume lost): never replaces a file present, never removes one. Both run in the
// server (Administration, the scheduler: lib/backup.ts), which holds the database; plain JavaScript like
// lib/backup-core.mjs.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { link, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BackupError, inside, openStored, readDbMeta } from './backup-core.mjs';

export const FILES_FORMAT = 'codex-files-backup';
export const FILES_FORMAT_VERSION = 1;
/** Sub-folder of the backup directory. */
export const FILES_SUBDIR = 'fichiers';
const OBJECTS = 'objets';
const STATE_RE = /^codex-fichiers-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.json$/;
/** A key as lib/storage.ts makes them: one path segment, no dot file. */
const SAFE_KEY = /^(?!\.)[^/\\\0]{1,255}$/;
/** A key that starts with the UUID lib/storage.ts gives each stored file. */
const UUID_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/;
const CHUNK = 1 << 20;

/** @typedef {{ query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }} Queryable */

/**
 * @typedef {object} FilesState
 * @property {string} format
 * @property {number} version
 * @property {string} createdAt
 * @property {'online'} mode
 * @property {string} by
 * @property {string | null} app
 * @property {{ hash: string, createdAt: number }} migration the database's last migration
 * @property {{ documents: number, revisions: number, workingVersions: number, auditEntries: number, people: number }} counts
 * @property {{ count: number, bytes: number, copied: number, copiedBytes: number, missing: string[], altered: string[], sharepoint: number }} files
 *   files listed (present in the copy), their size; copied by this run; keys the store did not have; keys whose bytes no
 *   longer match their recorded SHA-256 (not copied: an earlier good copy stays, if any); files kept by SharePoint
 * @property {{ key: string, size: number, sha256: string }[]} entries
 */

/** @param {Date} d */
export function stateName(d) {
  return `codex-fichiers-${d.toISOString().replace(/:/g, '-').replace('.', '-')}.json`;
}

/** @param {string} name */
export function stateDate(name) {
  const m = STATE_RE.exec(name);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : null;
}

/** @param {string} backupDir */
export function filesBackupDir(backupDir) {
  return path.join(backupDir, FILES_SUBDIR);
}

/**
 * Local files the database points to, with the SHA-256 and size recorded for each (null when none was: a file stored
 * before fingerprints were computed).
 * @param {Queryable} q
 * @returns {Promise<Map<string, { sha256: string | null, size: number | null }>>}
 */
async function referencedFiles(q) {
  /** @type {Map<string, { sha256: string | null, size: number | null }>} */
  const out = new Map();
  const rows = (await q.query(`select file_key, sha256, size from working_versions where file_key is not null and coalesce(storage, 'local') = 'local'`)).rows;
  const [{ renders }] = (await q.query(`select to_regclass('version_previews') is not null as renders`)).rows;
  if (renders) rows.push(...(await q.query(`select file_key, sha256, size from version_previews where file_key is not null`)).rows);
  for (const r of rows) {
    const key = path.basename(String(r.file_key));
    if (!SAFE_KEY.test(key)) continue;
    out.set(key, { sha256: r.sha256 ? String(r.sha256) : out.get(key)?.sha256 ?? null, size: r.size == null ? null : Number(r.size) });
  }
  return out;
}

/**
 * Copies an open file to `dest` through a temporary name, hashing it; the copy is kept only when it matches `expect`
 * (a recorded SHA-256), and never replaces a file already at `dest`.
 * @param {import('node:fs/promises').FileHandle} src
 * @param {string} dest
 * @param {string | null} expect
 * @returns {Promise<{ sha256: string, size: number, kept: boolean }>}
 */
async function copyChecked(src, dest, expect) {
  const partial = path.join(path.dirname(dest), `.${path.basename(dest)}.partial`);
  await rm(partial, { force: true });
  const out = await open(partial, 'wx', 0o600);
  const h = createHash('sha256');
  let size = 0;
  try {
    const buf = Buffer.allocUnsafe(CHUNK);
    for (;;) {
      const { bytesRead } = await src.read(buf, 0, CHUNK, size);
      if (bytesRead === 0) break;
      h.update(buf.subarray(0, bytesRead));
      await out.write(buf, 0, bytesRead);
      size += bytesRead;
    }
    await out.sync();
  } finally {
    await out.close();
  }
  const sha256 = h.digest('hex');
  if (expect && expect !== sha256) {
    await rm(partial, { force: true });
    return { sha256, size, kept: false };
  }
  try {
    // link, not rename: a file that appeared at `dest` meanwhile is never replaced.
    await link(partial, dest);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'EEXIST') throw err;
  } finally {
    await rm(partial, { force: true });
  }
  return { sha256, size, kept: true };
}

/**
 * SHA-256 and size of a file on disk; null when absent.
 * @param {string} file
 */
async function hashFile(file) {
  let fh;
  try {
    fh = await open(file, 'r');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return null;
    throw err;
  }
  try {
    const h = createHash('sha256');
    let size = 0;
    const buf = Buffer.allocUnsafe(CHUNK);
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, CHUNK, size);
      if (bytesRead === 0) break;
      h.update(buf.subarray(0, bytesRead));
      size += bytesRead;
    }
    return { sha256: h.digest('hex'), size };
  } finally {
    await fh.close();
  }
}

/**
 * @typedef {object} FilesBackupResult
 * @property {string} name the state written
 * @property {string} path
 * @property {FilesState} state
 * @property {string[]} removed states rotated out
 * @property {number} pruned copies removed (no kept state lists them)
 */

/**
 * Copies into `<backupDir>/fichiers` the local files the database points to that are not copied yet, writes the state,
 * rotates. Files already copied are trusted by name and size (a stored file is never written again); a copy is checked
 * against the recorded SHA-256 when made. Refused (BackupError 'backup_dir') when the backup directory and the files
 * directory hold one another.
 * @param {object} o
 * @param {Queryable} o.pg
 * @param {string} o.filesDir
 * @param {string} o.backupDir
 * @param {number} o.keep
 * @param {string} o.by
 * @param {string | null} [o.app]
 * @param {Date} [o.now]
 * @returns {Promise<FilesBackupResult>}
 */
export async function createFilesBackup(o) {
  if (inside(o.backupDir, o.filesDir) || inside(o.filesDir, o.backupDir)) throw new BackupError('backup_dir', o.backupDir);
  const dir = filesBackupDir(o.backupDir);
  const objects = path.join(dir, OBJECTS);
  await mkdir(objects, { recursive: true, mode: 0o700 });
  const now = o.now ?? new Date();
  const meta = await readDbMeta(o.pg);
  const refs = await referencedFiles(o.pg);
  /** @type {FilesState['entries']} */
  const entries = [];
  /** @type {string[]} */
  const missing = [], altered = [];
  let bytes = 0, copied = 0, copiedBytes = 0;
  for (const key of [...refs.keys()].sort()) {
    const rec = /** @type {{ sha256: string | null, size: number | null }} */ (refs.get(key));
    const dest = path.join(objects, key);
    const have = await stat(dest).catch(() => null);
    if (have?.isFile() && (rec.size == null || have.size === rec.size)) {
      entries.push({ key, size: have.size, sha256: rec.sha256 ?? '' });
      bytes += have.size;
      continue;
    }
    const src = await openStored(o.filesDir, key);
    if (!src) {
      missing.push(key);
      continue;
    }
    try {
      if (have) await rm(dest, { force: true });
      const c = await copyChecked(src, dest, rec.sha256);
      if (!c.kept) {
        altered.push(key);
        continue;
      }
      entries.push({ key, size: c.size, sha256: c.sha256 });
      bytes += c.size;
      copied++;
      copiedBytes += c.size;
    } finally {
      await src.close();
    }
  }
  /** @type {FilesState} */
  const state = {
    format: FILES_FORMAT, version: FILES_FORMAT_VERSION, createdAt: now.toISOString(), mode: 'online', by: o.by, app: o.app ?? null,
    migration: meta.migration, counts: meta.counts,
    files: { count: entries.length, bytes, copied, copiedBytes, missing, altered, sharepoint: meta.sharepoint },
    entries,
  };
  const name = stateName(now);
  const final = path.join(dir, name);
  const partial = path.join(dir, `.${name}.partial`);
  await writeFile(partial, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: 'w' });
  await rename(partial, final);
  const removed = await rotateStates(dir, o.keep, name);
  const pruned = await pruneObjects(dir);
  return { name, path: final, state, removed, pruned };
}

/**
 * Keeps the `keep` most recent states, the most recent of each of the `keep` latest days (UTC) and `newest`; removes
 * the others (the rule of lib/backup-core.mjs rotate).
 * @param {string} dir
 * @param {number} keep
 * @param {string} [newest]
 */
export async function rotateStates(dir, keep, newest) {
  const names = (await readdir(dir)).filter((n) => STATE_RE.test(n)).sort().reverse();
  const n = Math.max(1, keep);
  const kept = new Set(names.slice(0, n));
  if (newest) kept.add(newest);
  const days = new Set();
  for (const name of names) {
    const day = STATE_RE.exec(name)?.[1];
    if (days.has(day)) continue;
    if (days.size >= n) break;
    days.add(day);
    kept.add(name);
  }
  /** @type {string[]} */
  const removed = [];
  for (const name of names) {
    if (kept.has(name)) continue;
    await rm(path.join(dir, name), { force: true });
    removed.push(name);
  }
  return removed;
}

/**
 * Removes the copies no state of `dir` lists, and temporary files left by an interrupted run. Nothing is removed when a
 * state cannot be read: its files might be the ones a restore needs.
 * @param {string} dir
 */
async function pruneObjects(dir) {
  const listed = new Set();
  for (const name of (await readdir(dir)).filter((n) => STATE_RE.test(n))) {
    const s = await readState(path.join(dir, name)).catch(() => null);
    if (!s) return 0;
    for (const e of s.entries) listed.add(e.key);
  }
  let pruned = 0;
  const objects = path.join(dir, OBJECTS);
  for (const name of await readdir(objects)) {
    if (listed.has(name)) continue;
    await rm(path.join(objects, name), { force: true });
    if (!name.endsWith('.partial')) pruned++;
  }
  return pruned;
}

/**
 * A state, checked for its format.
 * @param {string} file
 * @returns {Promise<FilesState>}
 */
export async function readState(file) {
  const s = JSON.parse(await readFile(file, 'utf8'));
  if (s?.format !== FILES_FORMAT || s.version !== FILES_FORMAT_VERSION || !Array.isArray(s.entries)) throw new BackupError('format', path.basename(file));
  return s;
}

/**
 * @typedef {object} ListedFilesBackup
 * @property {string} name
 * @property {string} path
 * @property {string | null} createdAt
 * @property {FilesState | null} state null when not read, or unreadable (`unreadable`)
 * @property {boolean} [unreadable]
 */

/**
 * States of `<backupDir>/fichiers`, newest first; [] when there is none yet.
 * @param {string} backupDir
 * @param {{ states?: boolean }} [opts]
 * @returns {Promise<ListedFilesBackup[]>}
 */
export async function listFilesBackups(backupDir, opts = {}) {
  const dir = filesBackupDir(backupDir);
  let names;
  try {
    names = (await readdir(dir)).filter((n) => STATE_RE.test(n)).sort().reverse();
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return [];
    throw err;
  }
  /** @type {ListedFilesBackup[]} */
  const out = [];
  for (const name of names) {
    const file = path.join(dir, name);
    if (!opts.states) {
      out.push({ name, path: file, createdAt: stateDate(name), state: null });
      continue;
    }
    const state = await readState(file).catch(() => null);
    out.push({ name, path: file, createdAt: stateDate(name), state, ...(state ? {} : { unreadable: true }) });
  }
  return out;
}

/**
 * @typedef {object} FilesRestoreResult
 * @property {number} referenced local files the database points to
 * @property {number} present already in the store (left as they are)
 * @property {string[]} restored put back from the copy
 * @property {number} restoredBytes
 * @property {string[]} notInBackup absent from the store and from the copy
 * @property {string[]} altered the copy no longer matches the recorded SHA-256 (not put back)
 */

/**
 * Puts back into the store the local files the database points to that the store lacks, from the copies of
 * `<backupDir>/fichiers`, each checked against its recorded SHA-256 (or, when none was recorded, against the SHA-256 a
 * state gives). Never replaces nor removes a file of the store: safe while the server runs.
 * @param {object} o
 * @param {Queryable} o.pg
 * @param {string} o.filesDir
 * @param {string} o.backupDir
 * @returns {Promise<FilesRestoreResult>}
 */
export async function restoreFiles(o) {
  const dir = filesBackupDir(o.backupDir);
  const objects = path.join(dir, OBJECTS);
  const refs = await referencedFiles(o.pg);
  // Fingerprints the states give, for files stored before Codex recorded one.
  /** @type {Map<string, string>} */
  const known = new Map();
  for (const b of await listFilesBackups(o.backupDir, { states: true })) for (const e of b.state?.entries ?? []) if (e.sha256 && !known.has(e.key)) known.set(e.key, e.sha256);
  await mkdir(o.filesDir, { recursive: true });
  // Copies by the UUID that leads their key: a file renamed between the database's dump and the files backup
  // (lib/storage.ts nameStoredFile: same UUID, same bytes) is put back under the key the database records.
  /** @type {Map<string, string>} */
  const byUuid = new Map();
  for (const name of await readdir(objects).catch(() => /** @type {string[]} */ ([]))) {
    if (UUID_KEY.test(name) && !byUuid.has(name.slice(0, 37))) byUuid.set(name.slice(0, 37), name);
  }
  /** @type {FilesRestoreResult} */
  const res = { referenced: refs.size, present: 0, restored: [], restoredBytes: 0, notInBackup: [], altered: [] };
  for (const key of [...refs.keys()].sort()) {
    const here = await openStored(o.filesDir, key);
    if (here) {
      await here.close();
      res.present++;
      continue;
    }
    const same = UUID_KEY.test(key) ? byUuid.get(key.slice(0, 37)) : undefined;
    const name = existsSync(path.join(objects, key)) || !same ? key : same;
    const expect = refs.get(key)?.sha256 ?? known.get(key) ?? known.get(name) ?? null;
    let src;
    try {
      src = await open(path.join(objects, name), 'r');
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') throw err;
      res.notInBackup.push(key);
      continue;
    }
    try {
      const c = await copyChecked(src, path.join(o.filesDir, key), expect);
      if (!c.kept) {
        res.altered.push(key);
        continue;
      }
      res.restored.push(key);
      res.restoredBytes += c.size;
    } finally {
      await src.close();
    }
  }
  return res;
}

/**
 * Checks every copy a state lists against its SHA-256 (for a test of the backup, or before relying on it).
 * @param {string} backupDir
 * @param {string} name a state of `<backupDir>/fichiers`
 * @returns {Promise<{ checked: number, bytes: number, altered: string[], missing: string[] }>}
 */
export async function verifyFilesBackup(backupDir, name) {
  const dir = filesBackupDir(backupDir);
  const s = await readState(path.join(dir, path.basename(name)));
  const out = { checked: 0, bytes: 0, altered: /** @type {string[]} */ ([]), missing: /** @type {string[]} */ ([]) };
  for (const e of s.entries) {
    const h = await hashFile(path.join(dir, OBJECTS, e.key));
    if (!h) {
      out.missing.push(e.key);
      continue;
    }
    out.checked++;
    out.bytes += h.size;
    if ((e.sha256 && h.sha256 !== e.sha256) || h.size !== e.size) out.altered.push(e.key);
  }
  return out;
}
