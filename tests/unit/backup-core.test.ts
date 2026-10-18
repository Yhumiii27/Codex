import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  archiveDate, archiveName, backupDirOf, BackupError, DEFAULT_KEEP, entryNameOk, isArchiveName, keepOf, listBackups, LOCK_FILE, lockForCommand,
  lockForServer, lockHeld, pendingMigrations, readLock, readManifest, rotate, unlock, type Manifest,
} from '@/lib/backup-core.mjs';

// Rules of the backups (src/lib/backup-core.mjs, point 48 of docs/reste-a-faire.md): settings, archive names, entry
// names, schema check, rotation, lock of the data directory. tests/integration/backup.test.ts backs up and restores a
// real database.

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'codex-backup-unit-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  vi.useRealTimers();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A ustar header block, as tar writes one. */
function tarHeader(name: string, size: number, type: string): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100);
  h.write('0000600\0', 100);
  h.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  h.write('00000000000\0', 136);
  h.write(type, 156);
  h.write('ustar\0' + '00', 257);
  h.fill(0x20, 148, 156);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return h;
}

/** A pax extended header (type x) carrying one record, then a member named `name` of no content, then the end. */
function paxArchive(key: string, value: string, name = 'manifest.json'): Buffer {
  const body = ` ${key}=${value}\n`;
  let len = body.length + 1;
  while (String(len).length + body.length !== len) len++;
  const rec = Buffer.from(`${len}${body}`);
  const data = Buffer.concat([rec, Buffer.alloc(512 - rec.length)]);
  return Buffer.concat([tarHeader('PaxHeader', rec.length, 'x'), data, tarHeader(name, 0, '0'), Buffer.alloc(1024)]);
}

describe('settings', () => {
  it('puts archives beside the data directory, outside it, unless CODEX_BACKUP_DIR says where', () => {
    expect(backupDirOf('/srv/codex/.data', {})).toBe('/srv/codex/.data-backups');
    expect(backupDirOf('/srv/codex/.data/', {})).toBe('/srv/codex/.data-backups');
    expect(backupDirOf('/srv/codex/.data', { CODEX_BACKUP_DIR: ' /mnt/backups ' })).toBe('/mnt/backups');
  });

  it('keeps 7 archives by default, a whole number from 1 otherwise', () => {
    expect(keepOf({})).toBe(DEFAULT_KEEP);
    expect(DEFAULT_KEEP).toBe(7);
    expect(keepOf({ CODEX_BACKUP_KEEP: '30' })).toBe(30);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const v of ['0', '-1', '2.5', 'x']) expect(keepOf({ CODEX_BACKUP_KEEP: v }), v).toBe(7);
    expect(warn).toHaveBeenCalledTimes(4);
    warn.mockRestore();
  });
});

describe('archive names', () => {
  it('carry the UTC instant to the millisecond, sort in time order, and give it back', () => {
    const a = new Date('2026-10-15T09:05:03.007Z');
    const b = new Date('2026-10-15T10:00:00.000Z');
    expect(archiveName(a)).toBe('codex-backup-2026-10-15T09-05-03-007Z.tar');
    expect(archiveDate(archiveName(a))?.toISOString()).toBe(a.toISOString());
    expect([archiveName(b), archiveName(a)].sort()).toEqual([archiveName(a), archiveName(b)]);
    expect(isArchiveName('codex-backup-2026-10-15T09-05-03-007Z.tar.partial')).toBe(false);
    expect(isArchiveName('notes.tar')).toBe(false);
    expect(archiveDate('notes.tar')).toBeNull();
  });
});

describe('entry names', () => {
  it('admit the database, the manifest and one file name under files/, nothing that leaves the directory', () => {
    for (const ok of ['database/pglite.tar.gz', 'manifest.json', 'files/0a752ce3-b5e7-4330-a981-49c483e9655e-CTR-JUR-0001_A.7.pdf', 'files/.DS_Store']) expect(entryNameOk(ok), ok).toBe(true);
    for (const bad of ['files/../etc/passwd', 'files/..', 'files/.', 'files/a/b', 'files/a\\b', '../manifest.json', '/etc/passwd', 'database/other.tar', 'files/', 'pglite/PG_VERSION']) {
      expect(entryNameOk(bad), bad).toBe(false);
    }
  });
});

describe('pendingMigrations', () => {
  const code = [{ tag: '0000_init', hash: 'h0', createdAt: 1 }, { tag: '0001_more', hash: 'h1', createdAt: 2 }];
  const of = (hash: string, createdAt: number) => ({ database: { migration: { tag: null, hash, createdAt } } }) as unknown as Manifest;

  it('names the migrations the code has after the archive’s last one', () => {
    expect(pendingMigrations(of('h1', 2), code)).toEqual([]);
    expect(pendingMigrations(of('h0', 1), code)).toEqual(['0001_more']);
  });

  it('refuses a migration the code does not have (a regenerated schema, another version of Codex)', () => {
    for (const m of [of('h9', 1), of('h0', 3)]) expect(() => pendingMigrations(m, code)).toThrow(expect.objectContaining({ code: 'schema_mismatch' }));
  });
});

describe('reading an archive', () => {
  it('refuses a pax size that is not a whole number, rather than reading the same headers again and again', async () => {
    const d = tmp();
    for (const [i, size] of ['-1536', '1e3', ' 12', '0x10'].entries()) {
      const file = path.join(d, archiveName(new Date(Date.UTC(2026, 0, 1, 0, 0, i))));
      writeFileSync(file, paxArchive('size', size));
      await expect(readManifest(file), size).rejects.toMatchObject({ code: 'not_archive' });
    }
    // The Administration panel and npm run backup:list read every archive of the directory: each is flagged, none hangs.
    const listed = await listBackups(d);
    expect(listed).toHaveLength(4);
    expect(listed.every((b) => b.unreadable)).toBe(true);
  });

  it('still reads a pax size that is one, or empty (the header’s size then holds)', async () => {
    const d = tmp();
    const file = path.join(d, 'a.tar');
    for (const size of ['0', '']) {
      writeFileSync(file, paxArchive('size', size));
      // A tar it reads to the end: what it lacks is a Codex manifest, not a readable structure.
      await expect(readManifest(file), size).rejects.toMatchObject({ code: 'format' });
    }
  });
});

describe('rotate', () => {
  it('keeps the most recent archives and the one just written, and leaves any other file alone', async () => {
    const d = tmp();
    const names = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'].map((day) => archiveName(new Date(`${day}T08:00:00Z`)));
    for (const n of [...names, 'notes.txt', `${names[0]}.partial`]) writeFileSync(path.join(d, n), 'x');
    expect(await rotate(d, 2, names[3])).toEqual([names[1], names[0]]);
    expect(readdirSync(d).sort()).toEqual([names[2], names[3], `${names[0]}.partial`, 'notes.txt'].sort());
    // Written with a clock set back: kept although it is not among the most recent.
    expect(await rotate(d, 1, names[2])).toEqual([]);
    expect(await rotate(d, 1)).toEqual([names[2]]);
  });

  it('also keeps the latest archive of each of the last days: backups made in a row never push out the days before', async () => {
    const d = tmp();
    const at = (iso: string) => archiveName(new Date(iso));
    const older = [at('2026-10-12T08:00:00Z'), at('2026-10-13T08:00:00Z'), at('2026-10-14T07:00:00Z'), at('2026-10-14T16:00:00Z')];
    const burst = [0, 1, 2, 3, 4].map((i) => at(`2026-10-15T10:0${i}:00Z`));
    for (const n of [...older, ...burst]) writeFileSync(path.join(d, n), 'x');
    // Three kept by count (the burst's last three), and the latest of the 14th and of the 13th, the two days before.
    expect((await rotate(d, 3, burst[4])).sort()).toEqual([older[0], older[2], burst[0], burst[1]].sort());
    expect(readdirSync(d).sort()).toEqual([older[1], older[3], burst[2], burst[3], burst[4]].sort());
  });
});

describe('lock of the data directory', () => {
  const lock = (d: string, l: object) => writeFileSync(path.join(d, LOCK_FILE), JSON.stringify(l));
  const now = () => new Date().toISOString();

  it('is held by another live process only: not by this one, nor by a process that is gone', () => {
    expect(lockHeld(null)).toBe(false);
    expect(lockHeld({ pid: process.pid, kind: 'server', since: now() })).toBe(false);
    expect(lockHeld({ pid: process.ppid, kind: 'server', since: now() })).toBe(true);
    expect(lockHeld({ pid: 2 ** 22 + 12_345, kind: 'server', since: now() })).toBe(false);
  });

  it('lapses for a command not refreshed for 10 minutes (killed, then its process number reused), never for a server', () => {
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    expect(lockHeld({ pid: process.ppid, kind: 'restore', since: ago(11) })).toBe(false);
    expect(lockHeld({ pid: process.ppid, kind: 'restore', since: ago(9) })).toBe(true);
    expect(lockHeld({ pid: process.ppid, kind: 'backup', since: ago(600), beat: ago(11) })).toBe(false);
    // A command running for hours keeps its lock as long as it refreshes it.
    expect(lockHeld({ pid: process.ppid, kind: 'backup', since: ago(600), beat: ago(1) })).toBe(true);
    expect(lockHeld({ pid: process.ppid, kind: 'server', since: ago(60 * 24 * 30) })).toBe(true);
  });

  it('is refreshed every 30 s while the command runs, and no longer once released', async () => {
    const d = tmp();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-10-15T08:00:00Z'));
    await lockForCommand(d, 'backup');
    expect(await readLock(d)).toEqual({ pid: process.pid, kind: 'backup', since: '2026-10-15T08:00:00.000Z', beat: '2026-10-15T08:00:00.000Z' });
    vi.advanceTimersByTime(20 * 60_000);
    expect(await readLock(d)).toEqual({ pid: process.pid, kind: 'backup', since: '2026-10-15T08:00:00.000Z', beat: '2026-10-15T08:20:00.000Z' });
    await unlock(d);
    vi.advanceTimersByTime(60_000);
    expect(existsSync(path.join(d, LOCK_FILE))).toBe(false);
  });

  it('makes a command refuse while the server lives, and take the directory once it is gone', async () => {
    const d = tmp();
    lock(d, { pid: process.ppid, kind: 'server', since: now() });
    await expect(lockForCommand(d, 'backup')).rejects.toThrow(BackupError);
    await expect(lockForCommand(d, 'backup')).rejects.toMatchObject({ code: 'busy', lock: { kind: 'server', pid: process.ppid } });
    lock(d, { pid: 2 ** 22 + 12_345, kind: 'server', since: now() });
    await lockForCommand(d, 'restore');
    expect(await readLock(d)).toMatchObject({ pid: process.pid, kind: 'restore' });
    await unlock(d);
    expect(await readLock(d)).toBeNull();
  });

  it('makes the server refuse to open the database while a command works on it, not after', async () => {
    const d = tmp();
    lock(d, { pid: process.ppid, kind: 'restore', since: now() });
    // The server's log names the lock and what to do if no command runs any more.
    await expect(lockForServer(d)).rejects.toMatchObject({ code: 'busy', message: expect.stringContaining(`${path.join(d, LOCK_FILE)}; if no backup, restore, export, integrity or registry command is running, delete that file`) });
    // A server lock of another live process does not stop it (a second process of the same server, a stale pid).
    lock(d, { pid: process.ppid, kind: 'server', since: now() });
    await lockForServer(d);
    expect(await readLock(d)).toMatchObject({ pid: process.pid, kind: 'server' });
    await unlock(d);
  });

  it('never leaves another process’s lock behind it, and reads a damaged lock as none', async () => {
    const d = tmp();
    lock(d, { pid: process.ppid, kind: 'server', since: now() });
    await unlock(d);
    expect(await readLock(d)).toMatchObject({ pid: process.ppid });
    writeFileSync(path.join(d, LOCK_FILE), '{oops');
    expect(await readLock(d)).toBeNull();
    lock(d, { pid: -42, kind: 'server', since: now() });
    expect(await readLock(d)).toBeNull();
  });
});
