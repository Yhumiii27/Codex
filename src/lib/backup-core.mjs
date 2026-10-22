// @ts-check
// Backup and restore of Codex's data: the PGlite database and the files its records point to (point 48 of
// docs/reste-a-faire.md; runbook: docs/sauvegarde.md).
//
// Plain JavaScript, Node built-ins only, so that the npm commands (scripts/codex-backup.mjs) run it with Node alone,
// without a TypeScript loader; the server uses it through lib/backup.ts (Administration) and src/db/index.ts (lock).
//
// An archive is one uncompressed tar file, codex-backup-<UTC instant>.tar, written under a temporary name, synced, then
// renamed and read back before older ones are rotated out:
//   database/pglite.tar.gz  the data directory as PGlite dumps it (dumpDataDir), taken under the database's lock
//   files/<key>             each local file a working version points to in that dump, under the key it records
//   manifest.json           last: format, date, origin, schema migration, counts, the SHA-256 of every other entry
//
// Consistency: the database is dumped while its one connection is held (a PGlite transaction: no other query or
// transaction in flight), after a CHECKPOINT. The files are read afterwards, which is safe because a stored file is
// never written again (lib/storage.ts writes with 'wx') and a file a record points to is removed only after the record
// stopped pointing to it: a rename (nameStoredFile) links the new key, updates the record, then removes the old key.
// A key of the dump already removed when the copy reaches it is read under its new key, the same UUID and the same
// bytes. Files no record of the dump points to (orphans, uploads whose record was not committed) are left out.

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { cp, lstat, mkdir, open, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';

export const FORMAT = 'codex-backup';
export const FORMAT_VERSION = 1;
export const DB_ENTRY = 'database/pglite.tar.gz';
export const MANIFEST_ENTRY = 'manifest.json';
const FILES_PREFIX = 'files/';
export const DEFAULT_KEEP = 7;
export const LOCK_FILE = 'codex.lock';

const ARCHIVE_RE = /^codex-backup-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.tar$/;
/** A file name the archive may carry under files/: one path segment. */
const SAFE_FILE = /^files\/(?!\.\.?$)[^/\\\0]{1,255}$/;
/** Local keys start with a random UUID (lib/storage.ts), kept when the file is renamed. */
const UUID_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/;
const BLOCK = 512;
const CHUNK = 1 << 20;
const MAX_OCTAL = 0o77777777777;
const MAX_MANIFEST = 256 * 1024 * 1024;
/** The server and the commands (backup, restore, export...) refresh their lock this often while they run... */
const BEAT_MS = 30_000;
/** ...and a command's lock, or any lock of another process space, lapses when not refreshed for this long (killed,
 * number reused), whatever its process number. */
const COMMAND_STALE_MS = 10 * 60_000;

/**
 * @typedef {'busy' | 'no_database' | 'backup_dir' | 'target_exists' | 'not_found' | 'not_archive' | 'truncated' | 'format'
 *   | 'entry_name' | 'entry_missing' | 'entry_unexpected' | 'entry_corrupt' | 'schema_mismatch' | 'content_mismatch'
 *   | 'swap_failed' | 'swap_incomplete'} BackupErrorCode
 */

/** A refusal or a damaged archive, with a code the command line and Administration put into words. */
export class BackupError extends Error {
  /**
   * @param {BackupErrorCode} code
   * @param {string} [detail]
   */
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'BackupError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * @typedef {object} Manifest
 * @property {string} format
 * @property {number} version
 * @property {string} createdAt UTC instant of the dump
 * @property {'online' | 'offline'} mode online: Administration, server running; offline: npm run backup, server stopped
 * @property {string} by the user who asked (online), 'cli' (offline)
 * @property {string | null} app version of Codex (package.json)
 * @property {{ entry: string, postgres: string, migration: { tag: string | null, hash: string, createdAt: number } }} database
 * @property {{ documents: number, revisions: number, workingVersions: number, auditEntries: number, people: number }} counts
 * @property {{ count: number, bytes: number, missing: string[], sharepoint: number }} files local files in the
 *   archive, their size; keys the dump points to that the store did not have; files kept by SharePoint, not archived
 * @property {{ name: string, size: number, sha256: string }[]} entries every entry but the manifest
 */

/** @typedef {{ tag: string, hash: string, createdAt: number }} Migration */
/** @typedef {{ query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }} Queryable */

// ── Settings ────────────────────────────────────────────────────────────

/**
 * The refusal of a command that works on PGlite's data directory (npm run backup, restore, export, integrity) when
 * DATABASE_URL names a PostgreSQL server (docs/postgres.md): it would read or replace a database Codex no longer uses.
 * Null with the embedded database.
 * @param {Readonly<Record<string, string | undefined>>} env
 * @param {string} what the command, as the message names it
 * @param {string} instead what to do on a server
 */
export function serverDatabaseRefusal(env, what, instead) {
  if (!env.DATABASE_URL?.trim()) return null;
  return `${what} : DATABASE_URL désigne un serveur PostgreSQL, et cette commande ne travaille que sur la base intégrée (PGlite) du dossier de données.\n${instead}\nVoir docs/postgres.md.`;
}


/**
 * Where archives go: CODEX_BACKUP_DIR, else beside the data directory (`.data` → `.data-backups`), outside it so that
 * `npm run db:reset` (rm -rf .data) leaves them. Where they should live in production is not decided (hosting).
 * @param {string} dataDir
 * @param {Record<string, string | undefined>} env
 */
export function backupDirOf(dataDir, env) {
  const v = env.CODEX_BACKUP_DIR?.trim();
  return v ? path.resolve(v) : `${path.resolve(dataDir)}-backups`;
}

/**
 * How many archives rotation keeps: CODEX_BACKUP_KEEP, a whole number from 1, 7 by default or when the value is not one.
 * @param {Record<string, string | undefined>} env
 */
export function keepOf(env) {
  const raw = env.CODEX_BACKUP_KEEP?.trim();
  if (!raw) return DEFAULT_KEEP;
  if (!/^\d{1,4}$/.test(raw) || Number(raw) < 1) {
    console.warn(`[backup] CODEX_BACKUP_KEEP=${raw} is not a whole number from 1: ${DEFAULT_KEEP}`);
    return DEFAULT_KEEP;
  }
  return Number(raw);
}

/** @param {Date} date */
export function archiveName(date) {
  return `codex-backup-${date.toISOString().replace(/[:.]/g, '-')}.tar`;
}

/** @param {string} name */
export function isArchiveName(name) {
  return ARCHIVE_RE.test(name);
}

/**
 * The instant an archive's name gives, or null.
 * @param {string} name
 */
export function archiveDate(name) {
  const m = ARCHIVE_RE.exec(name);
  return m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : null;
}

/**
 * @param {string} child
 * @param {string} parent
 */
function inside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// ── Lock of the data directory ──────────────────────────────────────────
// PGlite cannot share a data directory between processes, and its own postmaster.pid always says -42. The server
// writes codex.lock when it opens the database; the commands refuse to run while that process lives, and write their
// own lock, which the server respects. Both refresh their lock every 30 s while they run.
//
// A process number only means something in the process space (pid namespace) it was given in: two containers on one
// volume both run as pid 1 (lot 10, étape 7). So a lock also records a random id of the process that wrote it (« mine »
// is that id, never the pid) and its process space. A lock of another space is never judged by its pid: it holds while
// refreshed and lapses 10 minutes after its last refresh. A lock of the former format (pid, kind, since, beat only) is
// judged by its pid as before, but is never this process's own.

/**
 * @typedef {{ pid: number, kind: 'server' | 'backup' | 'restore' | 'export' | 'integrity' | 'registry' | 'seed' | 'migrate', since: string, beat?: string,
 *   id?: string, space?: string }} DataDirLock
 */

const LOCK_ID_KEY = Symbol.for('codex.lock.id');
/** @type {string | undefined} */
let lockSpace;

/**
 * Who this process is to the lock: a random id drawn once per process (kept on globalThis, so that every copy of this
 * module in a bundle shares it), and its process space. Under Linux, the space is the boot (random per boot, shared
 * by the containers of one kernel) and the pid namespace (one per container, unless --pid=host): two processes with the
 * same space see the same process numbers. The kernel reuses the number of a namespace once it is gone (seen: a
 * container started after a killed one got its number), so the start of the namespace's first process is added.
 * Elsewhere (macOS), the host name.
 * @returns {{ id: string, space: string }}
 */
export function lockIdentity() {
  const g = /** @type {Record<symbol, string | undefined>} */ (/** @type {unknown} */ (globalThis));
  const id = (g[LOCK_ID_KEY] ??= randomUUID());
  if (lockSpace === undefined) {
    try {
      const boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
      lockSpace = `boot:${boot}/${readlinkSync('/proc/self/ns/pid')}${initStart()}`;
    } catch {
      lockSpace = `host:${hostname()}`;
    }
  }
  return { id, space: lockSpace };
}

/** When the first process of this pid namespace started (clock ticks since boot, /proc/1/stat), or '' if unreadable. */
function initStart() {
  try {
    const stat = readFileSync('/proc/1/stat', 'utf8');
    const start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
    return /^\d+$/.test(start ?? '') ? `/init:${start}` : '';
  } catch {
    return '';
  }
}

/**
 * Was the lock written in another process space (another container, another machine sharing the volume)? A lock of the
 * former format, without a space, cannot tell: false.
 * @param {DataDirLock | null} lock
 */
export function foreignLock(lock) {
  return !!lock && typeof lock.space === 'string' && lock.space !== lockIdentity().space;
}

/**
 * The holder's process number, for the commands' messages (French), saying when it is another container's or machine's.
 * @param {{ pid: number, space?: string } | null | undefined} lock
 */
export function lockPid(lock) {
  if (!lock) return '?';
  return `${lock.pid}${foreignLock(/** @type {DataDirLock} */ (lock)) ? ', dans un autre conteneur ou sur une autre machine' : ''}`;
}

/**
 * @param {string} dataDir
 * @returns {Promise<DataDirLock | null>}
 */
export async function readLock(dataDir) {
  try {
    const v = JSON.parse(await readFile(path.join(dataDir, LOCK_FILE), 'utf8'));
    return v && Number.isInteger(v.pid) && v.pid > 0 && ['server', 'backup', 'restore', 'export', 'integrity', 'registry', 'seed', 'migrate'].includes(v.kind) ? v : null;
  } catch {
    return null;
  }
}

/** @param {number} pid */
export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return /** @type {NodeJS.ErrnoException} */ (err).code === 'EPERM';
  }
}

/**
 * Is this lock this process's own? Only by its id: a lock of the former format never is.
 * @param {DataDirLock | null} lock
 */
function ownLock(lock) {
  return !!lock && typeof lock.id === 'string' && lock.id === lockIdentity().id;
}

/**
 * Is the directory held by another live process?
 * - This process's own lock: no.
 * - Another process space: yes while refreshed, for 10 minutes after the last refresh, whatever its pid.
 * - The same space: a command's lock lapses when not refreshed for 10 minutes (killed, its number reused); otherwise it
 *   holds while its process lives. A lock of the same space with this process's pid but another id was left by a
 *   process that is gone (its number reused by this one).
 * - The former format: judged by its pid as in the same space, but held even when its pid is this process's (written by
 *   a former version, here or in another container: there is no telling).
 * @param {DataDirLock | null} lock
 * @param {number} [now]
 */
export function lockHeld(lock, now = Date.now()) {
  if (!lock || ownLock(lock)) return false;
  const fresh = now - Date.parse(lock.beat ?? lock.since) < COMMAND_STALE_MS;
  if (foreignLock(lock)) return fresh;
  if (lock.kind !== 'server' && !fresh) return false;
  if (typeof lock.id === 'string' && lock.pid === process.pid) return false;
  return pidAlive(lock.pid);
}

/**
 * @param {DataDirLock['kind']} kind
 * @param {string} since
 */
function lockRecord(kind, since) {
  return JSON.stringify({ pid: process.pid, kind, since, beat: new Date().toISOString(), ...lockIdentity() });
}

/**
 * @param {string} dataDir
 * @param {DataDirLock['kind']} kind
 * @param {string} since
 */
async function writeLock(dataDir, kind, since) {
  const file = path.join(dataDir, LOCK_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, lockRecord(kind, since));
  await rename(tmp, file);
}

/** Refresh timers of this process's locks, by data directory. @type {Map<string, NodeJS.Timeout>} */
const beats = new Map();

/**
 * Refreshes this process's lock every 30 s until unlock(). Written synchronously: no write still in flight once
 * unlock() has stopped the timer and removed the file.
 * @param {string} dataDir
 * @param {DataDirLock['kind']} kind
 * @param {string} since
 */
function keepLock(dataDir, kind, since) {
  const file = path.join(dataDir, LOCK_FILE);
  const timer = setInterval(() => {
    try {
      writeFileSync(`${file}.${process.pid}.tmp`, lockRecord(kind, since));
      renameSync(`${file}.${process.pid}.tmp`, file);
    } catch (err) {
      console.warn('[backup] could not refresh the lock of', dataDir, err);
    }
  }, BEAT_MS);
  timer.unref();
  clearInterval(beats.get(path.resolve(dataDir)));
  beats.set(path.resolve(dataDir), timer);
}

/**
 * The server, opening the database: refuses while a backup, restore, export or integrity command works on the directory, then
 * writes its own lock, refreshed every 30 s and removed when the process exits. A lock it cannot write never stops it (a warning).
 * @param {string} dataDir
 */
export async function lockForServer(dataDir) {
  const held = await readLock(dataDir);
  if (held && held.kind !== 'server' && lockHeld(held)) {
    const file = path.join(dataDir, LOCK_FILE);
    const where = foreignLock(held) ? ' in another container or on another machine' : '';
    throw new BackupError('busy', `a ${held.kind} command (pid ${held.pid}${where}) holds ${file}; if no backup, restore, export, integrity, registry or migrate command is running, delete that file`);
  }
  try {
    const since = new Date().toISOString();
    await writeLock(dataDir, 'server', since);
    keepLock(dataDir, 'server', since);
    process.once('exit', () => releaseSync(dataDir));
  } catch (err) {
    console.warn('[backup] could not write the lock of', dataDir, err);
  }
}

/**
 * A command (backup, restore, export: scripts/codex-export.mjs, integrity: scripts/codex-integrity.mjs, registry:
 * scripts/codex-registry.mts, seed: scripts/codex-seed-large.mts): refuses while another live process holds the
 * directory (BackupError 'busy', with the lock), then holds it, refreshing the lock every 30 s until unlock().
 * @param {string} dataDir
 * @param {'backup' | 'restore' | 'export' | 'integrity' | 'registry' | 'seed' | 'migrate'} kind
 */
export async function lockForCommand(dataDir, kind) {
  const held = await readLock(dataDir);
  if (held && lockHeld(held)) {
    const err = new BackupError('busy', `${held.kind} (pid ${held.pid}${foreignLock(held) ? ', another container or machine' : ''})`);
    Object.assign(err, { lock: held });
    throw err;
  }
  await mkdir(dataDir, { recursive: true });
  const since = new Date().toISOString();
  await writeLock(dataDir, kind, since);
  keepLock(dataDir, kind, since);
}

/**
 * Removes this process's lock (another process's stays) and stops refreshing it.
 * @param {string} dataDir
 */
export async function unlock(dataDir) {
  clearInterval(beats.get(path.resolve(dataDir)));
  beats.delete(path.resolve(dataDir));
  if (ownLock(await readLock(dataDir))) await rm(path.join(dataDir, LOCK_FILE), { force: true });
}

/** @param {string} dataDir */
function releaseSync(dataDir) {
  try {
    const file = path.join(dataDir, LOCK_FILE);
    clearInterval(beats.get(path.resolve(dataDir)));
    if (ownLock(JSON.parse(readFileSync(file, 'utf8')))) rmSync(file, { force: true });
  } catch {
    // Gone, or another process's: nothing to release.
  }
}

// ── Tar (POSIX ustar, pax for long names) ───────────────────────────────

/**
 * @param {number} n
 * @param {number} width
 */
function octal(n, width) {
  return `${n.toString(8).padStart(width - 1, '0')}\0`;
}

/** @param {Buffer} h */
function checksum(h) {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
  return sum;
}

/**
 * @param {string} name
 * @param {number} size
 * @param {number} mtime seconds
 * @param {string} type
 */
function ustarHeader(name, size, mtime, type) {
  const h = Buffer.alloc(BLOCK);
  h.write(name, 0, 100, 'utf8');
  h.write(octal(0o600, 8), 100, 'ascii');
  h.write(octal(0, 8), 108, 'ascii');
  h.write(octal(0, 8), 116, 'ascii');
  h.write(octal(size, 12), 124, 'ascii');
  h.write(octal(Math.max(0, Math.min(mtime, MAX_OCTAL)), 12), 136, 'ascii');
  h.write(type, 156, 'ascii');
  h.write('ustar\0', 257, 'ascii');
  h.write('00', 263, 'ascii');
  h.write(`${octal(checksum(h), 7)} `, 148, 'ascii');
  return h;
}

/**
 * One pax record, "<length> <key>=<value>\n", the length counting its own digits.
 * @param {string} key
 * @param {string} value
 */
function paxRecord(key, value) {
  const body = Buffer.byteLength(` ${key}=${value}\n`);
  let digits = String(body).length;
  while (String(body + digits).length !== digits) digits++;
  return `${body + digits} ${key}=${value}\n`;
}

/** Writes a tar file sequentially and hashes every byte it writes. */
class TarWriter {
  /** @param {import('node:fs/promises').FileHandle} fh */
  constructor(fh) {
    this.fh = fh;
    this.hash = createHash('sha256');
    this.size = 0;
  }

  /** @param {Buffer} buf */
  async put(buf) {
    for (let off = 0; off < buf.length;) off += (await this.fh.write(buf, off, buf.length - off)).bytesWritten;
    this.hash.update(buf);
    this.size += buf.length;
  }

  /** @param {number} size */
  async pad(size) {
    if (size % BLOCK) await this.put(Buffer.alloc(BLOCK - (size % BLOCK)));
  }

  /**
   * @param {string} name
   * @param {number} size
   * @param {number} mtime
   */
  async header(name, size, mtime) {
    const pax = [];
    if (Buffer.byteLength(name) > 100) pax.push(paxRecord('path', name));
    if (size > MAX_OCTAL) pax.push(paxRecord('size', String(size)));
    if (pax.length) {
      const data = Buffer.from(pax.join(''));
      await this.put(ustarHeader('PaxHeader', data.length, mtime, 'x'));
      await this.put(data);
      await this.pad(data.length);
    }
    await this.put(ustarHeader(name, size > MAX_OCTAL ? 0 : size, mtime, '0'));
  }

  /**
   * @param {string} name
   * @param {Buffer} buf
   * @param {number} mtime
   */
  async addBuffer(name, buf, mtime) {
    await this.header(name, buf.length, mtime);
    await this.put(buf);
    await this.pad(buf.length);
    return { name, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
  }

  /**
   * Copies `size` bytes of an open file, hashing what it reads; a file shorter than that is an error.
   * @param {string} name
   * @param {import('node:fs/promises').FileHandle} src
   * @param {number} size
   * @param {number} mtime
   */
  async addFile(name, src, size, mtime) {
    await this.header(name, size, mtime);
    const h = createHash('sha256');
    const buf = Buffer.alloc(Math.max(1, Math.min(CHUNK, size)));
    for (let done = 0; done < size;) {
      const { bytesRead } = await src.read(buf, 0, Math.min(buf.length, size - done), done);
      if (!bytesRead) throw new Error(`${name}: shorter than ${size} bytes`);
      const part = buf.subarray(0, bytesRead);
      h.update(part);
      await this.put(part);
      done += bytesRead;
    }
    await this.pad(size);
    return { name, size, sha256: h.digest('hex') };
  }

  async end() {
    await this.put(Buffer.alloc(BLOCK * 2));
    return { size: this.size, sha256: this.hash.digest('hex') };
  }
}

/**
 * @param {import('node:fs/promises').FileHandle} fh
 * @param {number} length
 * @param {number} position
 */
async function readExactly(fh, length, position) {
  const buf = Buffer.alloc(length);
  for (let off = 0; off < length;) {
    const { bytesRead } = await fh.read(buf, off, length - off, position + off);
    if (!bytesRead) throw new BackupError('truncated');
    off += bytesRead;
  }
  return buf;
}

/**
 * @param {Buffer} h
 * @param {number} start
 * @param {number} len
 */
function field(h, start, len) {
  const end = h.indexOf(0, start);
  return h.toString('utf8', start, end >= start && end < start + len ? end : start + len);
}

/**
 * @param {Buffer} h
 * @param {number} start
 * @param {number} len
 */
function parseOctal(h, start, len) {
  const v = field(h, start, len).trim();
  if (!/^[0-7]{1,12}$/.test(v)) throw new BackupError('not_archive');
  return parseInt(v, 8);
}

/** @param {Buffer} buf */
function parsePax(buf) {
  /** @type {Record<string, string>} */
  const out = {};
  for (let pos = 0; pos < buf.length;) {
    const sp = buf.indexOf(0x20, pos);
    const len = Number(buf.toString('ascii', pos, sp));
    if (sp < 0 || !Number.isInteger(len) || len <= 0) break;
    const rec = buf.toString('utf8', sp + 1, pos + len - 1);
    const eq = rec.indexOf('=');
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    pos += len;
  }
  return out;
}

/** @typedef {{ name: string, size: number, offset: number }} TarEntry */

/**
 * The regular files of a tar archive, in order: name, size, where their bytes start. Directories and global pax
 * headers are skipped; links and devices refused (Codex writes none); a missing end, a bad checksum, a size that is not
 * a whole number or an entry beyond the end of the file is an error. Every header is past the previous one, so that
 * no archive, however altered, makes the reading loop.
 * @param {import('node:fs/promises').FileHandle} fh
 * @returns {Promise<TarEntry[]>}
 */
export async function tarEntries(fh) {
  const { size: total } = await fh.stat();
  /** @type {TarEntry[]} */
  const entries = [];
  /** @type {Record<string, string> | null} */
  let pax = null;
  let prev = -1;
  for (let pos = 0; ;) {
    if (pos <= prev) throw new BackupError('not_archive', `header at byte ${pos} read twice`);
    prev = pos;
    if (pos + BLOCK > total) throw new BackupError('truncated');
    const h = await readExactly(fh, BLOCK, pos);
    if (h.every((b) => b === 0)) break;
    if (parseOctal(h, 148, 8) !== checksum(h)) throw new BackupError('not_archive', `header at byte ${pos}`);
    const prefix = h.toString('ascii', 257, 262) === 'ustar' ? field(h, 345, 155) : '';
    let name = prefix ? `${prefix}/${field(h, 0, 100)}` : field(h, 0, 100);
    let size = parseOctal(h, 124, 12);
    const type = String.fromCharCode(h[156]);
    pos += BLOCK;
    if (type === 'x' || type === 'g') {
      if (pos + size > total) throw new BackupError('truncated');
      if (type === 'x') pax = parsePax(await readExactly(fh, size, pos));
      pos += Math.ceil(size / BLOCK) * BLOCK;
      continue;
    }
    if (pax?.path) name = pax.path;
    // An empty value deletes the record (POSIX): the header's size holds.
    if (pax?.size) {
      if (!/^\d{1,16}$/.test(pax.size)) throw new BackupError('not_archive', `size of ${name}`);
      size = Number(pax.size);
    }
    pax = null;
    if (!Number.isSafeInteger(size) || pos + size > total) throw new BackupError('truncated');
    if (type === '0' || type === '\0') entries.push({ name, size, offset: pos });
    else if (type !== '5') throw new BackupError('entry_name', name);
    pos += Math.ceil(size / BLOCK) * BLOCK;
  }
  return entries;
}

/**
 * SHA-256 of an entry, its bytes copied to `sink` on the way when given.
 * @param {import('node:fs/promises').FileHandle} fh
 * @param {TarEntry} e
 * @param {import('node:fs/promises').FileHandle} [sink]
 */
async function hashEntry(fh, e, sink) {
  const h = createHash('sha256');
  const buf = Buffer.alloc(Math.max(1, Math.min(CHUNK, e.size)));
  for (let done = 0; done < e.size;) {
    const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, e.size - done), e.offset + done);
    if (!bytesRead) throw new BackupError('truncated');
    const part = buf.subarray(0, bytesRead);
    h.update(part);
    if (sink) for (let off = 0; off < part.length;) off += (await sink.write(part, off, part.length - off)).bytesWritten;
    done += bytesRead;
  }
  return h.digest('hex');
}

// ── Manifest and checks ─────────────────────────────────────────────────

/**
 * May an archive carry an entry of this name? The database, the manifest, files under files/ (one segment).
 * @param {string} name
 */
export function entryNameOk(name) {
  return name === DB_ENTRY || name === MANIFEST_ENTRY || SAFE_FILE.test(name);
}

/**
 * @param {any} m
 * @returns {asserts m is Manifest}
 */
function checkManifest(m) {
  if (!m || typeof m !== 'object' || m.format !== FORMAT) throw new BackupError('format', 'not a Codex backup');
  if (m.version !== FORMAT_VERSION) throw new BackupError('format', `version ${m.version}`);
  const ok = typeof m.createdAt === 'string' && m.database && m.database.entry === DB_ENTRY && typeof m.database.migration?.hash === 'string'
    && Number.isFinite(m.database.migration?.createdAt) && m.counts && m.files && Array.isArray(m.files.missing) && Array.isArray(m.entries)
    && m.entries.every((/** @type {any} */ x) => x && typeof x.name === 'string' && Number.isSafeInteger(x.size) && typeof x.sha256 === 'string');
  if (!ok) throw new BackupError('format', 'incomplete manifest');
}

/**
 * @param {import('node:fs/promises').FileHandle} fh
 * @param {TarEntry[]} entries
 */
async function manifestOf(fh, entries) {
  const me = entries.find((e) => e.name === MANIFEST_ENTRY);
  if (!me) throw new BackupError('format', 'no manifest');
  if (me.size > MAX_MANIFEST) throw new BackupError('format', 'manifest too large');
  let m;
  try {
    m = JSON.parse((await readExactly(fh, me.size, me.offset)).toString('utf8'));
  } catch (err) {
    if (err instanceof BackupError) throw err;
    throw new BackupError('format', 'manifest is not JSON');
  }
  checkManifest(m);
  return m;
}

/**
 * @param {string} file
 */
async function openArchive(file) {
  try {
    return await open(file, 'r');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') throw new BackupError('not_found', file);
    throw err;
  }
}

/**
 * The manifest of an archive, without checking the entries (listing).
 * @param {string} file
 */
export async function readManifest(file) {
  const fh = await openArchive(file);
  try {
    return await manifestOf(fh, await tarEntries(fh));
  } finally {
    await fh.close();
  }
}

/**
 * Checks an archive whole: a well-formed tar, a Codex manifest of a known version, entries of allowed names each
 * present once, exactly those the manifest lists, of the size and SHA-256 it gives. Returns the manifest.
 * @param {string} file
 */
export async function verifyArchive(file) {
  const fh = await openArchive(file);
  try {
    const entries = await tarEntries(fh);
    const byName = new Map();
    for (const e of entries) {
      if (!entryNameOk(e.name)) throw new BackupError('entry_name', e.name);
      if (byName.has(e.name)) throw new BackupError('entry_name', `${e.name} (twice)`);
      byName.set(e.name, e);
    }
    const manifest = await manifestOf(fh, entries);
    const listed = new Map(manifest.entries.map((x) => [x.name, x]));
    if (!listed.has(DB_ENTRY)) throw new BackupError('entry_missing', DB_ENTRY);
    for (const name of listed.keys()) if (!byName.has(name)) throw new BackupError('entry_missing', name);
    for (const name of byName.keys()) if (name !== MANIFEST_ENTRY && !listed.has(name)) throw new BackupError('entry_unexpected', name);
    for (const [name, x] of listed) {
      const e = byName.get(name);
      if (e.size !== x.size || (await hashEntry(fh, e)) !== x.sha256) throw new BackupError('entry_corrupt', name);
    }
    return manifest;
  } finally {
    await fh.close();
  }
}

/**
 * The code's migrations (drizzle/), hashed as drizzle's migrator hashes them.
 * @param {string} folder
 * @returns {Promise<Migration[]>}
 */
export async function readMigrations(folder) {
  const journal = JSON.parse(await readFile(path.join(folder, 'meta', '_journal.json'), 'utf8'));
  return Promise.all(journal.entries.map(async (/** @type {{ tag: string, when: number }} */ e) => ({
    tag: e.tag,
    createdAt: e.when,
    hash: createHash('sha256').update(await readFile(path.join(folder, `${e.tag}.sql`), 'utf8')).digest('hex'),
  })));
}

/**
 * The migrations of this branch before lot 11 (22 October 2026), when Codex's tables were in the schema public and the
 * journal in drizzle.__drizzle_migrations (src/db/migrations.ts). A PGlite database (or an archive of one) that applied
 * exactly these is taken up into the schema codex when the server next opens it; its files are kept in
 * tests/fixtures/drizzle-public for the test of that take-up.
 * @type {readonly Migration[]}
 */
export const LEGACY_PUBLIC_CHAIN = Object.freeze([
  { tag: '0000_init', createdAt: 1792232472935, hash: '2ece15046c3b662eabc79aff6833050f215dc3e387a06c91e0506013e287f874' },
  { tag: '0001_planificateur_signatures', createdAt: 1792287567764, hash: '96fb91a795987d415203090fd18ed9d93c3aa8d2f436787e433e20517e1609aa' },
  { tag: '0002_apercu_office', createdAt: 1792289677284, hash: '99462e4c73a5312ba3bf97b2fefff14d3e7a35f6e377391f296b6aed176b0ae1' },
  { tag: '0003_vocabulaires', createdAt: 1792292401336, hash: '99f774e553121428f8951a0d79188aba5f75d21cade6a58fa0bd41de8d9279f7' },
  { tag: '0004_modele_source', createdAt: 1792295122437, hash: '61c8ea2d4723221551b3018f42e27e4eb811e7adb69d7739e74cac970c7fd760' },
  { tag: '0005_index_acces_validations', createdAt: 1792302725551, hash: '228733435c1d397798a7efb1ba300a2ab1d8d9978e95abd760093502ddb74dd4' },
]);

/**
 * Migrations of the code the restored database still lacks (applied when the server next opens it). Refuses an archive
 * whose last migration the code does not have: drizzle would replay a regenerated schema on top of the restored one.
 * An archive made at the end of the chain before lot 11 (LEGACY_PUBLIC_CHAIN) is taken up into the schema codex at the
 * next start: what remains is that take-up, then every migration after 0000_init.
 * @param {Manifest} manifest
 * @param {Migration[]} migrations
 */
export function pendingMigrations(manifest, migrations) {
  const m = manifest.database.migration;
  const last = LEGACY_PUBLIC_CHAIN[LEGACY_PUBLIC_CHAIN.length - 1];
  if (m.hash === last.hash && m.createdAt === last.createdAt) return ['public → codex', ...migrations.slice(1).map((x) => x.tag)];
  const i = migrations.findIndex((x) => x.hash === m.hash && x.createdAt === m.createdAt);
  if (i < 0) throw new BackupError('schema_mismatch', m.tag ?? m.hash);
  return migrations.slice(i + 1).map((x) => x.tag);
}

// ── Reading the database ────────────────────────────────────────────────

/**
 * What the manifest records of a database, and the local keys its working versions point to.
 * @param {Queryable} q
 */
async function readDbMeta(q) {
  const [c] = (await q.query(`select
    (select count(*) from documents)::int as documents, (select count(*) from revisions)::int as revisions,
    (select count(*) from working_versions)::int as working_versions, (select count(*) from audit_log)::int as audit_entries,
    (select count(*) from users where not is_system)::int as people, version() as postgres`)).rows;
  // codex.__drizzle_migrations since lot 11; drizzle.__drizzle_migrations in a database of the former layout (tables in
  // public), backed up before its take-up.
  const [{ journal }] = (await q.query(`select coalesce(to_regclass('codex.__drizzle_migrations'), to_regclass('drizzle.__drizzle_migrations'))::text as journal`)).rows;
  const [m] = journal ? (await q.query(`select hash, created_at::text as created_at from ${journal} order by created_at desc limit 1`)).rows : [];
  if (!m) throw new BackupError('no_database', 'no migration applied');
  const refs = (await q.query(`select coalesce(storage, 'local') as storage, file_key from working_versions where file_key is not null`)).rows;
  /** @type {Set<string>} */
  const local = new Set();
  let sharepoint = 0;
  for (const r of refs) {
    if (r.storage === 'sharepoint') sharepoint++;
    else local.add(path.basename(String(r.file_key)));
  }
  // PDF renderings of the preview (lib/office-preview.ts), always in the local store. Looked up only when the table
  // exists: the backup taken before a migration reads a database of an earlier schema.
  const [{ renders }] = (await q.query(`select to_regclass('version_previews') is not null as renders`)).rows;
  if (renders) {
    for (const r of (await q.query(`select file_key from version_previews where file_key is not null`)).rows) local.add(path.basename(String(r.file_key)));
  }
  return {
    counts: { documents: c.documents, revisions: c.revisions, workingVersions: c.working_versions, auditEntries: c.audit_entries, people: c.people },
    postgres: /^PostgreSQL \S+(?: \(PGlite [^)]+\))?/.exec(String(c.postgres))?.[0] ?? String(c.postgres),
    migration: { hash: String(m.hash), createdAt: Number(m.created_at) },
    local,
    sharepoint,
  };
}

/**
 * A stored file to copy, or null when the store has none: under its key, else (renamed since the dump) under the
 * other key of the same UUID, which holds the same bytes.
 * @param {string} filesDir
 * @param {string} file
 */
async function openStored(filesDir, file) {
  /** @param {string} name */
  const tryOpen = async (name) => {
    try {
      const fh = await open(path.join(filesDir, name), 'r');
      if ((await fh.stat()).isFile()) return fh;
      await fh.close();
      return null;
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return null;
      throw err;
    }
  };
  if (file === '.' || file === '..' || !SAFE_FILE.test(FILES_PREFIX + file)) return null;
  const direct = await tryOpen(file);
  if (direct || !UUID_KEY.test(file)) return direct;
  const uuid = file.slice(0, 37);
  for (const other of (await readdir(filesDir)).sort()) {
    if (other === file || !other.startsWith(uuid)) continue;
    const fh = await tryOpen(other);
    if (fh) return fh;
  }
  return null;
}

/**
 * Journals a backup or a restore in the database `q` (raw SQL, for the commands; the server uses lib/lifecycle.ts
 * audit), by the system actor Codex. False when the database has no such actor.
 * @param {Queryable} q
 * @param {'backup_created' | 'backup_restored'} action
 * @param {string} archive
 * @param {Record<string, unknown>} backup
 * @param {string} [detail] why it was made, when not asked for (the server's archive before migrating: src/db/index.ts)
 */
export async function journal(q, action, archive, backup, detail = '') {
  if (!(await q.query(`select 1 from users where id = 'codex'`)).rows.length) return false;
  await q.query(
    `insert into audit_log (at, user_id, action, target_kind, target_id, detail, data) values ($1, 'codex', $2, 'backup', $3, $4, $5::jsonb)`,
    [new Date().toISOString(), action, archive, detail, JSON.stringify({ backup })],
  );
  return true;
}

/**
 * What the journal keeps of a backup: the archive, its size and SHA-256, and counts (no document named).
 * @param {Manifest} m
 * @param {{ name: string, size: number, sha256: string }} archive
 */
export function journalData(m, archive) {
  return {
    archive: archive.name, size: archive.size, sha256: archive.sha256, documents: m.counts.documents, files: m.files.count,
    bytes: m.files.bytes, missing: m.files.missing.length, sharepoint: m.files.sharepoint,
  };
}

// ── Backup ──────────────────────────────────────────────────────────────

/**
 * @typedef {object} BackupResult
 * @property {string} name
 * @property {string} path
 * @property {number} size
 * @property {string} sha256 of the whole archive
 * @property {Manifest} manifest
 * @property {string[]} removed archives rotated out
 */

/**
 * Writes an archive of the database `pg` and of the local files its records point to, checks it, then removes the
 * oldest archives beyond `keep`. `pg` must be the one process holding the database: the server's (online), or one the
 * command opened while the server is stopped (offline).
 * @param {object} o
 * @param {import('@electric-sql/pglite').PGlite} o.pg
 * @param {string} o.filesDir
 * @param {string | null} o.dbDir the database's directory (null in memory): the archives may not go inside it
 * @param {string} o.backupDir
 * @param {number} o.keep
 * @param {'online' | 'offline'} o.mode
 * @param {string} o.by
 * @param {Migration[]} o.migrations the code's, to name the database's last migration
 * @param {string | null} [o.app]
 * @param {Date} [o.now]
 * @returns {Promise<BackupResult>}
 */
export async function createBackup(o) {
  for (const d of [o.filesDir, o.dbDir]) {
    if (d && (inside(o.backupDir, d) || inside(d, o.backupDir))) throw new BackupError('backup_dir', o.backupDir);
  }
  await mkdir(o.backupDir, { recursive: true, mode: 0o700 });
  const now = o.now ?? new Date();
  const snap = await o.pg.transaction(async (tx) => {
    // Held for the dump: no query or transaction in flight. The checkpoint writes what the WAL holds to the tables, so
    // that the restored copy has little to replay; the dump would be consistent without it.
    await tx.exec('checkpoint');
    const meta = await readDbMeta(tx);
    const dump = Buffer.from(await (await o.pg.dumpDataDir('gzip')).arrayBuffer());
    return { meta, dump };
  });
  const { meta, dump } = snap;
  const name = archiveName(now);
  const final = path.join(o.backupDir, name);
  const partial = `${final}.partial`;
  const fh = await open(partial, 'wx', 0o600);
  let written = false;
  try {
    const tar = new TarWriter(fh);
    const mtime = Math.floor(now.getTime() / 1000);
    const entries = [await tar.addBuffer(DB_ENTRY, dump, mtime)];
    /** @type {string[]} */
    const missing = [];
    let bytes = 0;
    for (const file of [...meta.local].sort()) {
      const src = await openStored(o.filesDir, file);
      if (!src) {
        missing.push(file);
        continue;
      }
      try {
        const st = await src.stat();
        const e = await tar.addFile(FILES_PREFIX + file, src, st.size, Math.floor(st.mtimeMs / 1000));
        entries.push(e);
        bytes += e.size;
      } finally {
        await src.close();
      }
    }
    const tag = o.migrations.find((x) => x.hash === meta.migration.hash && x.createdAt === meta.migration.createdAt)?.tag ?? null;
    /** @type {Manifest} */
    const manifest = {
      format: FORMAT, version: FORMAT_VERSION, createdAt: now.toISOString(), mode: o.mode, by: o.by, app: o.app ?? null,
      database: { entry: DB_ENTRY, postgres: meta.postgres, migration: { tag, ...meta.migration } },
      counts: meta.counts,
      files: { count: entries.length - 1, bytes, missing, sharepoint: meta.sharepoint },
      entries,
    };
    await tar.addBuffer(MANIFEST_ENTRY, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), mtime);
    const { size, sha256 } = await tar.end();
    await fh.sync();
    await fh.close();
    written = true;
    await rename(partial, final);
    try {
      await verifyArchive(final);
    } catch (err) {
      await rm(final, { force: true });
      throw err;
    }
    const removed = await rotate(o.backupDir, o.keep, name);
    return { name, path: final, size, sha256, manifest, removed };
  } catch (err) {
    if (!written) await fh.close().catch(() => {});
    await rm(partial, { force: true });
    throw err;
  }
}

/**
 * Keeps, of the archives of `dir` (by the instant in their name): the `keep` most recent, the most recent of each of the
 * `keep` latest days (UTC) that have one, and the one just written; removes the others. Backups made in a row (several
 * the same day) thus never push out the days before them. Only files named as Codex names its archives are considered.
 * @param {string} dir
 * @param {number} keep
 * @param {string} [newest]
 */
export async function rotate(dir, keep, newest) {
  const names = (await readdir(dir)).filter(isArchiveName).sort().reverse();
  const n = Math.max(1, keep);
  const kept = new Set(names.slice(0, n));
  if (newest) kept.add(newest);
  const days = new Set();
  for (const name of names) {
    const day = ARCHIVE_RE.exec(name)?.[1];
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
 * @typedef {object} ListedBackup
 * @property {string} name
 * @property {string} path
 * @property {number} size
 * @property {string | null} createdAt
 * @property {Manifest | null} manifest null when not read, or unreadable (`unreadable`)
 * @property {boolean} [unreadable]
 */

/**
 * Archives of `dir`, newest first; their manifest read when `manifests` (not checked against the entries).
 * @param {string} dir
 * @param {{ manifests?: boolean }} [opts]
 * @returns {Promise<ListedBackup[]>}
 */
export async function listBackups(dir, opts = {}) {
  let names;
  try {
    names = (await readdir(dir)).filter(isArchiveName).sort().reverse();
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const name of names) {
    const file = path.join(dir, name);
    const st = await stat(file).catch(() => null);
    if (!st?.isFile()) continue;
    /** @type {ListedBackup} */
    const item = { name, path: file, size: st.size, createdAt: archiveDate(name)?.toISOString() ?? null, manifest: null };
    if (opts.manifests !== false) {
      try {
        item.manifest = await readManifest(file);
        item.createdAt = item.manifest.createdAt;
      } catch {
        item.unreadable = true;
      }
    }
    out.push(item);
  }
  return out;
}

// ── Restore ─────────────────────────────────────────────────────────────

/**
 * @param {string} dir
 */
async function occupied(dir) {
  try {
    return (await readdir(dir)).length > 0;
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Moves an entry, never over another (rename would replace a file silently). Across file systems (files/ on another
 * volume, or a symbolic link to one), copies it, then removes the source; a copy that fails is removed.
 * @param {string} from
 * @param {string} to
 */
async function moveEntry(from, to) {
  if (await lstat(to).then(() => true, () => false)) throw Object.assign(new Error(`EEXIST: ${to} already exists`), { code: 'EEXIST' });
  try {
    await rename(from, to);
    return;
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'EXDEV') throw err;
  }
  try {
    await cp(from, to, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
    await rm(from, { recursive: true, force: true });
  } catch (err) {
    await rm(to, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Puts back, last first, entries moved by a restore that failed. Stops at the first that cannot be, so that the data
 * directory stays as the moves left it at that point, and returns the moves still done (empty: all undone).
 * @param {{ from: string, to: string }[]} moves
 */
async function undoMoves(moves) {
  for (let i = moves.length - 1; i >= 0; i--) {
    try {
      await moveEntry(moves[i].to, moves[i].from);
    } catch (err) {
      console.error('[backup] could not put back', moves[i].to, 'to', moves[i].from, err);
      return moves.slice(0, i + 1);
    }
  }
  return [];
}

/**
 * @typedef {object} RestoreResult
 * @property {Manifest} manifest
 * @property {string | null} aside where the database and files it replaced were moved (--replace), or null
 * @property {string[]} pending migrations of the code the server applies when it next opens the database
 * @property {boolean} journaled
 */

/**
 * Restores an archive into `dataDir` (pglite/ and files/), the server stopped: checks the archive whole, refuses one of a
 * schema the code does not know, and refuses to replace a database or files already there unless `replace`, in which
 * case they are moved to `dataDir/replaced-<instant>/`, never deleted. Everything is first written beside them
 * (`.restore-…`): the files with their SHA-256 checked again, the database loaded by PGlite, which replays its WAL, its
 * counts and migration compared with the manifest and every file its records point to found. The restore is journaled
 * in the restored database (system actor Codex) before it is moved into place.
 * Moving into place moves the entries of pglite/ and files/, not the directories, which may be mount points or symbolic
 * links (copied across file systems). If a move fails, those done are undone, last first, and nothing is replaced
 * (BackupError 'swap_failed'); if undoing fails too, the error ('swap_incomplete') carries what is where: the extracted
 * archive kept in `staging`, the replaced data in `aside`, and the entries `left` out of place.
 * @param {object} o
 * @param {string} o.archive
 * @param {string} o.dataDir
 * @param {boolean} [o.replace]
 * @param {typeof import('@electric-sql/pglite').PGlite} o.PGlite
 * @param {Record<string, any>} [o.options] options of the PGlite opened on the archive (lib/pglite-options.mjs
 *   pgliteOptions: extensions and search_path); its dataDir is the staging folder's
 * @param {Migration[]} o.migrations
 * @param {Date} [o.now]
 * @returns {Promise<RestoreResult>}
 */
export async function restoreBackup(o) {
  const manifest = await verifyArchive(o.archive);
  const pending = pendingMigrations(manifest, o.migrations);
  const dbDir = path.join(o.dataDir, 'pglite');
  const filesDir = path.join(o.dataDir, 'files');
  const taken = (await occupied(dbDir)) || (await occupied(filesDir));
  if (taken && !o.replace) throw new BackupError('target_exists', o.dataDir);
  const staging = path.join(o.dataDir, `.restore-${randomUUID()}`);
  await mkdir(path.join(staging, 'files'), { recursive: true });
  /** @type {import('@electric-sql/pglite').PGlite | null} */
  let pg = null;
  let keepStaging = false;
  try {
    const listed = new Map(manifest.entries.map((x) => [x.name, x]));
    /** @type {Buffer | null} */
    let dump = null;
    const fh = await openArchive(o.archive);
    try {
      for (const e of await tarEntries(fh)) {
        const x = listed.get(e.name);
        if (!x) continue;
        if (e.name === DB_ENTRY) {
          dump = await readExactly(fh, e.size, e.offset);
          if (createHash('sha256').update(dump).digest('hex') !== x.sha256) throw new BackupError('entry_corrupt', e.name);
          continue;
        }
        const out = await open(path.join(staging, 'files', e.name.slice(FILES_PREFIX.length)), 'wx', 0o644);
        try {
          if ((await hashEntry(fh, e, out)) !== x.sha256) throw new BackupError('entry_corrupt', e.name);
          await out.sync();
        } finally {
          await out.close();
        }
      }
    } finally {
      await fh.close();
    }
    if (!dump) throw new BackupError('entry_missing', DB_ENTRY);
    pg = new o.PGlite({ ...o.options, dataDir: path.join(staging, 'pglite'), loadDataDir: new File([new Uint8Array(dump)], 'pglite.tar.gz', { type: 'application/x-gzip' }) });
    await pg.waitReady;
    const meta = await readDbMeta(pg);
    const counts = /** @type {(keyof Manifest['counts'])[]} */ (Object.keys(manifest.counts));
    /** @type {string[]} */
    const differ = counts.filter((k) => meta.counts[k] !== manifest.counts[k]);
    if (meta.migration.hash !== manifest.database.migration.hash) differ.push('migration');
    const missingBefore = new Set(manifest.files.missing);
    const absent = [...meta.local].filter((k) => !missingBefore.has(k) && !listed.has(FILES_PREFIX + k));
    if (absent.length) differ.push(`files ${absent.slice(0, 3).join(', ')}`);
    if (differ.length) throw new BackupError('content_mismatch', differ.join(', '));
    const journaled = await journal(pg, 'backup_restored', path.basename(o.archive), {
      archive: path.basename(o.archive), size: (await stat(o.archive)).size, createdAt: manifest.createdAt, documents: manifest.counts.documents,
      files: manifest.files.count, bytes: manifest.files.bytes, missing: manifest.files.missing.length, sharepoint: manifest.files.sharepoint, replaced: taken,
    });
    await pg.close();
    pg = null;
    const aside = taken ? path.join(o.dataDir, `replaced-${(o.now ?? new Date()).toISOString().replace(/[:.]/g, '-')}`) : null;
    /** @type {{ from: string, to: string }[]} */
    const moves = [];
    try {
      if (aside) await mkdir(aside);
      for (const [dir, sub] of /** @type {const} */ ([[dbDir, 'pglite'], [filesDir, 'files']])) {
        // The directory stays where it is (it may be a mount point or a symbolic link): its entries move, not it.
        await mkdir(dir, { recursive: true });
        const current = await readdir(/*turbopackIgnore: true*/ dir);
        if (current.length) {
          if (!aside) throw new BackupError('target_exists', dir);
          await mkdir(path.join(/*turbopackIgnore: true*/ aside, sub));
          for (const e of current) {
            await moveEntry(path.join(dir, e), path.join(/*turbopackIgnore: true*/ aside, sub, e));
            moves.push({ from: path.join(dir, e), to: path.join(/*turbopackIgnore: true*/ aside, sub, e) });
          }
        }
        for (const e of await readdir(path.join(staging, sub))) {
          await moveEntry(path.join(staging, sub, e), path.join(dir, e));
          moves.push({ from: path.join(staging, sub, e), to: path.join(dir, e) });
        }
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const left = await undoMoves(moves);
      if (!left.length) {
        if (aside) for (const d of [path.join(aside, 'pglite'), path.join(aside, 'files'), aside]) await rmdir(d).catch(() => {});
        throw new BackupError('swap_failed', reason);
      }
      // Nothing more is moved or removed: the extracted archive stays in staging, the replaced data in aside.
      keepStaging = true;
      const e = new BackupError('swap_incomplete', `${reason}; ${left.length} entries not put back, the last ${left.at(-1)?.to}`);
      Object.assign(e, { reason, staging, aside, left });
      throw e;
    }
    return { manifest, aside, pending, journaled };
  } finally {
    if (pg) await pg.close().catch(() => {});
    if (!keepStaging) await rm(staging, { recursive: true, force: true });
  }
}
