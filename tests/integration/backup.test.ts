import { createHash } from 'node:crypto';
import { closeSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync, writeSync, type PathLike } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_DIR, FILES_DIR, openDb, schema as s } from '@/db';
import { backUpData } from '@/lib/actions';
import { archiveName, createBackup, listBackups, readManifest, readMigrations, restoreBackup, verifyArchive, type Migration } from '@/lib/backup-core.mjs';
import type { Ctx } from '@/lib/context';
import { DICT } from '@/lib/i18n';
import { auditDetailL } from '@/lib/queries';
import { getCtx } from '@/lib/context';
import { addDoc, pgliteOf, setClock, setupDb } from '../support/db';
import { actAs } from '../support/session';

// Backup and restore (point 48 of docs/reste-a-faire.md, lib/backup-core.mjs): an archive of the test database and of
// the files its records point to, checked entry by entry, restored into a data directory on disk and opened again; the
// refusals (a database already there, a damaged archive, another schema, a content that differs from the manifest);
// the Administration action, reserved to records managers and journaled.

vi.mock('@/db', async (importOriginal) => {
  const { mkdtempSync: mk } = await import('node:fs');
  const { tmpdir: td } = await import('node:os');
  const { join } = await import('node:path');
  const data = mk(join(td(), 'codex-backup-data-'));
  return { ...(await importOriginal<typeof import('@/db')>()), DATA_DIR: data, FILES_DIR: join(data, 'files'), getDb: async () => (await import('../support/db')).currentDb() };
});
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));
// A rename that a test makes fail (a busy mount point, another file system), seen by lib/backup-core.mjs.
const fsHook = vi.hoisted(() => ({ rename: undefined as ((from: string, to: string) => void) | undefined }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  const rename = async (from: PathLike, to: PathLike) => {
    fsHook.rename?.(String(from), String(to));
    return real.rename(from, to);
  };
  return { ...real, rename, default: { ...real, rename } };
});
const fsError = (code: string, p: string) => Object.assign(new Error(`${code}: simulated, rename '${p}'`), { code });

const db = setupDb({ engine: 'pglite' });
const scratch = mkdtempSync(path.join(tmpdir(), 'codex-backup-'));
const BACKUPS = path.join(scratch, 'backups');
let migrations: Migration[];
let n = 0;

beforeEach(async () => {
  mkdirSync(FILES_DIR, { recursive: true });
  migrations ??= await readMigrations(path.join(process.cwd(), 'drizzle'));
});
afterEach(() => {
  fsHook.rename = undefined;
  vi.useRealTimers();
  rmSync(FILES_DIR, { recursive: true, force: true });
  rmSync(BACKUPS, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(DATA_DIR, { recursive: true, force: true });
  rmSync(`${DATA_DIR}-backups`, { recursive: true, force: true });
});

const key = (i: number, name: string) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}-${name}`;
const put = (k: string, bytes: string) => writeFileSync(path.join(FILES_DIR, k), bytes);

/** A document whose working version points to a stored file `k`. */
async function withFile(id: string, k: string, bytes: string, storage = 'local') {
  await addDoc(db(), { id });
  if (storage === 'local') put(k, bytes);
  await db().update(s.workingVersions).set({ storage, fileKey: k, fileName: 'f.pdf', mime: 'application/pdf', size: bytes.length }).where(eq(s.workingVersions.docId, id));
}

/** Two documents with files, an orphan, a document whose file is kept by SharePoint. */
async function fill() {
  await withFile('PRO-QUA-0001', key(1, 'PRO-QUA-0001_A.1.pdf'), '%PDF-one');
  await withFile('PRO-QUA-0002', key(2, 'PRO-QUA-0002_A.1.pdf'), '%PDF-two-two');
  await withFile('PRO-QUA-0003', 'sp-drive-item-id', '%PDF-sp', 'sharepoint');
  put(key(9, 'upload.pdf'), 'orphan');
}

type Pg = Parameters<typeof createBackup>[0]['pg'];

function backup(opts: Partial<Parameters<typeof createBackup>[0]> = {}) {
  n++;
  return createBackup({
    pg: pgliteOf(db()), filesDir: FILES_DIR, dbDir: null, backupDir: BACKUPS, keep: 7, mode: 'offline', by: 'cli', migrations,
    now: new Date(Date.UTC(2026, 9, 15, 8, 0, n)), ...opts,
  });
}

const restore = (archive: string, dataDir: string, extra: Partial<Parameters<typeof restoreBackup>[0]> = {}) =>
  restoreBackup({ archive, dataDir, PGlite, extensions: { pg_trgm }, migrations, ...extra });

/** Overwrites one byte of a file. */
function flip(file: string, at: number) {
  const fd = openSync(file, 'r+');
  writeSync(fd, Buffer.from('#'), 0, 1, at);
  closeSync(fd);
}

describe('createBackup', () => {
  it('archives the database and the local files its records point to, with a manifest that lists and hashes them', async () => {
    await fill();
    const res = await backup();
    expect(res.name).toBe(`codex-backup-${res.manifest.createdAt.replace(/[:.]/g, '-')}.tar`);
    const m = await verifyArchive(res.path);
    expect(m).toEqual(res.manifest);
    expect(m).toMatchObject({
      format: 'codex-backup', version: 1, mode: 'offline', by: 'cli', createdAt: expect.stringMatching(/^2026-10-15T08:00:\d{2}\.000Z$/),
      database: { entry: 'database/pglite.tar.gz', migration: { tag: migrations.at(-1)!.tag, hash: migrations.at(-1)!.hash } },
      counts: { documents: 3, revisions: 3, workingVersions: 3 },
      // The orphan is left out; the SharePoint file is counted, not archived.
      files: { count: 2, bytes: 8 + 12, missing: [], sharepoint: 1 },
    });
    expect(m.database.postgres).toMatch(/^PostgreSQL \d+/);
    expect(m.entries.map((e) => e.name)).toEqual(['database/pglite.tar.gz', `files/${key(1, 'PRO-QUA-0001_A.1.pdf')}`, `files/${key(2, 'PRO-QUA-0002_A.1.pdf')}`]);
    expect(m.entries[1]).toEqual({ name: `files/${key(1, 'PRO-QUA-0001_A.1.pdf')}`, size: 8, sha256: createHash('sha256').update('%PDF-one').digest('hex') });
    // Readable without Codex: a POSIX tar, owner-only.
    expect(readFileSync(res.path).subarray(257, 262).toString()).toBe('ustar');
    expect(readdirSync(BACKUPS)).toEqual([res.name]);
  });

  it('archives the PDF renderings of the preview (version_previews) with the files', async () => {
    await withFile('PRO-QUA-0001', key(1, 'PRO-QUA-0001_A.1.pdf'), '%PDF-one');
    const render = key(5, 'PRO-QUA-0001_A.apercu.pdf');
    put(render, '%PDF-render');
    const [v] = await db().select().from(s.workingVersions).where(eq(s.workingVersions.docId, 'PRO-QUA-0001'));
    await db().insert(s.versionPreviews).values({ workingVersionId: v.id, status: 'ready', fileKey: render, size: 11, pages: 1, sha256: 'b'.repeat(64), converter: 'gotenberg', at: '2026-10-15T08:00:00Z' });
    const res = await backup();
    expect(res.manifest.files).toMatchObject({ count: 2, missing: [] });
    expect(res.manifest.entries.map((e) => e.name)).toContain(`files/${render}`);
  });

  it('records a referenced file the store does not have, and still writes the archive', async () => {
    await withFile('PRO-QUA-0001', key(1, 'PRO-QUA-0001_A.1.pdf'), '%PDF-one');
    rmSync(path.join(FILES_DIR, key(1, 'PRO-QUA-0001_A.1.pdf')));
    const res = await backup();
    expect(res.manifest.files).toMatchObject({ count: 0, missing: [key(1, 'PRO-QUA-0001_A.1.pdf')] });
  });

  it('reads a file renamed between the dump and the copy under its new name, and archives it under the key of the dump', async () => {
    const before = key(1, 'upload.pdf');
    const after = key(1, 'PRO-QUA-0001_A.1.pdf');
    await withFile('PRO-QUA-0001', before, '%PDF-renamed');
    const real = pgliteOf(db());
    // What nameStoredFile does once the database is free again: link the new name, point the record to it, remove the old one.
    const pg = {
      transaction: async (cb: Parameters<typeof real.transaction>[0]) => {
        const out = await real.transaction(cb);
        linkSync(path.join(FILES_DIR, before), path.join(FILES_DIR, after));
        await db().update(s.workingVersions).set({ fileKey: after }).where(eq(s.workingVersions.fileKey, before));
        unlinkSync(path.join(FILES_DIR, before));
        return out;
      },
      dumpDataDir: real.dumpDataDir.bind(real),
    } as unknown as Pg;
    const res = await backup({ pg });
    expect(res.manifest.files).toMatchObject({ count: 1, missing: [] });
    expect(res.manifest.entries.map((e) => e.name)).toContain(`files/${before}`);
  });

  it('refuses a backup directory inside the files or the database, or that contains them', async () => {
    for (const backupDir of [path.join(FILES_DIR, 'b'), FILES_DIR, path.dirname(FILES_DIR)]) {
      await expect(backup({ backupDir }), backupDir).rejects.toMatchObject({ code: 'backup_dir' });
    }
    await expect(backup({ dbDir: path.join(scratch, 'pglite'), backupDir: path.join(scratch, 'pglite', 'x') })).rejects.toMatchObject({ code: 'backup_dir' });
  });

  it('keeps the most recent archives, as many as asked', async () => {
    const names = [];
    for (let i = 0; i < 3; i++) names.push((await backup({ keep: 2 })).name);
    expect((await listBackups(BACKUPS)).map((b) => b.name)).toEqual([names[2], names[1]]);
  });
});

describe('verifyArchive', () => {
  it('finds a changed byte, a truncated archive, an entry the manifest does not list, a file that is not an archive', async () => {
    await fill();
    const res = await backup();
    const bytes = readFileSync(res.path);
    const copy = (name: string, buf: Buffer) => {
      const f = path.join(scratch, name);
      writeFileSync(f, buf);
      return f;
    };
    // The second file's content: after its header, past the database and the first file.
    const at = bytes.indexOf('%PDF-two-two');
    const changed = copy('changed.tar', bytes);
    flip(changed, at + 3);
    await expect(verifyArchive(changed)).rejects.toMatchObject({ code: 'entry_corrupt', detail: `files/${key(2, 'PRO-QUA-0002_A.1.pdf')}` });
    await expect(verifyArchive(copy('truncated.tar', bytes.subarray(0, at)))).rejects.toMatchObject({ code: 'truncated' });
    await expect(verifyArchive(copy('text.tar', Buffer.from('not a tar file at all'.repeat(40))))).rejects.toMatchObject({ code: 'not_archive' });
    await expect(verifyArchive(copy('short.tar', Buffer.from('tiny')))).rejects.toMatchObject({ code: 'truncated' });
    await expect(verifyArchive(copy('zeros.tar', Buffer.alloc(4096, 1)))).rejects.toMatchObject({ code: 'not_archive' });
    await expect(verifyArchive(path.join(scratch, 'nowhere.tar'))).rejects.toMatchObject({ code: 'not_found' });
    // A header renamed: the entry is no longer the one the manifest lists.
    const renamed = copy('renamed.tar', bytes);
    const nameAt = bytes.indexOf(`files/${key(2, 'PRO-QUA-0002_A.1.pdf')}`);
    flip(renamed, nameAt + 7);
    await expect(verifyArchive(renamed)).rejects.toMatchObject({ code: 'not_archive' });
  });
});

describe('restoreBackup', () => {
  it('restores the database and the files into an empty data directory, which opens with the same documents and files', async () => {
    await fill();
    const res = await backup();
    const target = path.join(scratch, 'restored');
    const out = await restore(res.path, target);
    expect(out).toMatchObject({ aside: null, pending: [], journaled: true });
    expect(readdirSync(path.join(target, 'files')).sort()).toEqual([key(1, 'PRO-QUA-0001_A.1.pdf'), key(2, 'PRO-QUA-0002_A.1.pdf')]);
    expect(readFileSync(path.join(target, 'files', key(2, 'PRO-QUA-0002_A.1.pdf')), 'utf8')).toBe('%PDF-two-two');
    expect(readdirSync(target).sort()).toEqual(['files', 'pglite']);
    const again = await openDb(path.join(target, 'pglite'));
    try {
      const docs = await again.select({ id: s.documents.id }).from(s.documents);
      expect(docs.map((d) => d.id).sort()).toEqual(['PRO-QUA-0001', 'PRO-QUA-0002', 'PRO-QUA-0003']);
      const [entry] = await again.select().from(s.auditLog).where(eq(s.auditLog.action, 'backup_restored'));
      expect(entry).toMatchObject({ userId: 'codex', targetKind: 'backup', targetId: res.name, data: { backup: { documents: 3, files: 2, sharepoint: 1, replaced: false, createdAt: res.manifest.createdAt } } });
      // The search terms and the journal's triggers came with it.
      const [{ n: terms }] = (await again.$client.query<{ n: number }>(`select count(*)::int as n from document_terms where doc_id = 'PRO-QUA-0002' and term % 'pro-qua-0002'`)).rows;
      expect(terms).toBeGreaterThan(0);
      await expect(again.$client.query(`delete from audit_log`)).rejects.toThrow(/append-only/);
    } finally {
      await again.$client.close();
    }
  });

  it('refuses to replace a database or files already there without --replace, and moves them aside with it', async () => {
    await fill();
    const res = await backup();
    const target = path.join(scratch, 'taken');
    mkdirSync(path.join(target, 'files'), { recursive: true });
    writeFileSync(path.join(target, 'files', 'mine.pdf'), 'mine');
    await expect(restore(res.path, target)).rejects.toMatchObject({ code: 'target_exists' });
    expect(readdirSync(target).sort()).toEqual(['files']);
    const out = await restore(res.path, target, { replace: true, now: new Date('2026-10-15T09:00:00Z') });
    expect(out.aside).toBe(path.join(target, 'replaced-2026-10-15T09-00-00-000Z'));
    expect(readFileSync(path.join(out.aside!, 'files', 'mine.pdf'), 'utf8')).toBe('mine');
    expect(readdirSync(path.join(target, 'files'))).toHaveLength(2);
    expect(existsSync(path.join(target, 'pglite', 'PG_VERSION'))).toBe(true);
  });

  it('writes nothing from a damaged archive or one of a schema the code does not know', async () => {
    await fill();
    const res = await backup();
    const target = path.join(scratch, 'untouched');
    await expect(restore(res.path, target, { migrations: [{ tag: '0000_init', hash: 'other', createdAt: 1 }] })).rejects.toMatchObject({ code: 'schema_mismatch' });
    flip(res.path, readFileSync(res.path).indexOf('%PDF-one') + 2);
    await expect(restore(res.path, target)).rejects.toMatchObject({ code: 'entry_corrupt' });
    expect(existsSync(target) ? readdirSync(target) : []).toEqual([]);
  });

  /** A data directory with a database and a file of its own, to be replaced. */
  function occupiedTarget(name: string) {
    const target = path.join(scratch, name);
    mkdirSync(path.join(target, 'pglite'), { recursive: true });
    writeFileSync(path.join(target, 'pglite', 'PG_VERSION'), 'old');
    mkdirSync(path.join(target, 'files'));
    writeFileSync(path.join(target, 'files', 'mine.pdf'), 'mine');
    return target;
  }
  const inside = (p: string, dir: string) => p.startsWith(dir + path.sep);

  it('puts the database and files it replaced back when moving the files into place fails, and replaces nothing', async () => {
    await fill();
    const res = await backup();
    const target = occupiedTarget('swap-back');
    // The files' directory is busy (a mount point): the restored files cannot go in, after the database went.
    fsHook.rename = (from, to) => {
      if (inside(to, path.join(target, 'files')) && from.includes(`${path.sep}.restore-`)) throw fsError('EBUSY', to);
    };
    await expect(restore(res.path, target, { replace: true })).rejects.toMatchObject({ code: 'swap_failed', detail: expect.stringContaining('EBUSY') });
    // As before: no restored database, nothing set aside, no extracted archive left over.
    expect(readdirSync(target).sort()).toEqual(['files', 'pglite']);
    expect(readdirSync(path.join(target, 'pglite'))).toEqual(['PG_VERSION']);
    expect(readFileSync(path.join(target, 'pglite', 'PG_VERSION'), 'utf8')).toBe('old');
    expect(readdirSync(path.join(target, 'files'))).toEqual(['mine.pdf']);
  });

  it('leaves an empty data directory empty when the files cannot go in, so that the restore can simply be run again', async () => {
    await fill();
    const res = await backup();
    const target = path.join(scratch, 'swap-empty');
    fsHook.rename = (from, to) => {
      if (inside(to, path.join(target, 'files')) && from.includes(`${path.sep}.restore-`)) throw fsError('EBUSY', to);
    };
    await expect(restore(res.path, target)).rejects.toMatchObject({ code: 'swap_failed' });
    expect(readdirSync(path.join(target, 'pglite'))).toEqual([]);
    expect(readdirSync(path.join(target, 'files'))).toEqual([]);
    expect(readdirSync(target).sort()).toEqual(['files', 'pglite']);
    fsHook.rename = undefined;
    // Not refused as a directory already holding a database: the first attempt left nothing.
    await expect(restore(res.path, target)).resolves.toMatchObject({ aside: null });
    expect(readdirSync(path.join(target, 'files'))).toHaveLength(2);
  });

  it('keeps the extracted archive and says what is where when putting back fails too', async () => {
    await fill();
    const res = await backup();
    const target = occupiedTarget('swap-stuck');
    fsHook.rename = (from, to) => {
      if (inside(to, path.join(target, 'files')) && from.includes(`${path.sep}.restore-`)) throw fsError('EBUSY', to);
      if (inside(from, path.join(target, 'pglite')) && to.includes(`${path.sep}.restore-`)) throw fsError('EIO', from);
    };
    const err = await restore(res.path, target, { replace: true, now: new Date('2026-10-15T09:00:00Z') }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'swap_incomplete', reason: expect.stringContaining('EBUSY'), aside: path.join(target, 'replaced-2026-10-15T09-00-00-000Z') });
    const { staging, aside, left } = err as { staging: string; aside: string; left: { from: string; to: string }[] };
    // Nothing more was moved: the files staged are still there, the replaced database set aside, and every entry the
    // error names is where it says.
    expect(readdirSync(path.join(staging, 'files')).sort()).toEqual([key(1, 'PRO-QUA-0001_A.1.pdf'), key(2, 'PRO-QUA-0002_A.1.pdf')]);
    expect(readFileSync(path.join(aside, 'pglite', 'PG_VERSION'), 'utf8')).toBe('old');
    expect(left[0]).toEqual({ from: path.join(target, 'pglite', 'PG_VERSION'), to: path.join(aside, 'pglite', 'PG_VERSION') });
    for (const m of left) expect(existsSync(m.to), m.to).toBe(true);
    // The file of the replaced data was put back before the stop; the restored database's entries are in place.
    expect(readdirSync(path.join(target, 'files'))).toEqual(['mine.pdf']);
    expect(existsSync(path.join(target, 'pglite', 'PG_VERSION'))).toBe(true);
    rmSync(staging, { recursive: true, force: true });
  });

  it('copies across file systems, and leaves a files directory that is a symbolic link a link', async () => {
    await fill();
    const res = await backup();
    const target = occupiedTarget('swap-link');
    // files/ is a link to a directory elsewhere (a network share)…
    const share = path.join(scratch, 'share');
    rmSync(path.join(target, 'files'), { recursive: true });
    mkdirSync(share);
    writeFileSync(path.join(share, 'mine.pdf'), 'mine');
    symlinkSync(share, path.join(target, 'files'));
    // …on another file system: rename refuses, the entries are copied.
    fsHook.rename = (from, to) => {
      if (inside(from, share) || inside(to, path.join(target, 'files'))) throw fsError('EXDEV', to);
    };
    const out = await restore(res.path, target, { replace: true });
    expect(lstatSync(path.join(target, 'files')).isSymbolicLink()).toBe(true);
    expect(readdirSync(share).sort()).toEqual([key(1, 'PRO-QUA-0001_A.1.pdf'), key(2, 'PRO-QUA-0002_A.1.pdf')]);
    expect(readFileSync(path.join(share, key(1, 'PRO-QUA-0001_A.1.pdf')), 'utf8')).toBe('%PDF-one');
    expect(readFileSync(path.join(out.aside!, 'files', 'mine.pdf'), 'utf8')).toBe('mine');
    expect(readdirSync(target).filter((n) => n.startsWith('.restore-'))).toEqual([]);
  });

  it('refuses a database that does not match its manifest, and leaves the target as it was', async () => {
    await fill();
    const real = pgliteOf(db());
    // A manifest that counts one document more than the dump holds.
    const pg = {
      transaction: (cb: Parameters<typeof real.transaction>[0]) => real.transaction((tx) => cb({
        ...tx,
        exec: tx.exec,
        query: async (sql: string, params?: unknown[]) => {
          const r = await tx.query<Record<string, number>>(sql, params);
          if (sql.includes('from documents')) r.rows[0].documents += 1;
          return r;
        },
      } as typeof tx)),
      dumpDataDir: real.dumpDataDir.bind(real),
    } as unknown as Pg;
    const res = await backup({ pg });
    const target = path.join(scratch, 'mismatch');
    await expect(restore(res.path, target)).rejects.toMatchObject({ code: 'content_mismatch', detail: 'documents' });
    expect(existsSync(target) ? readdirSync(target) : []).toEqual([]);
  });
});

describe('the Administration action', () => {
  const ctx = (seesAll: boolean) => ({ t: DICT.fr, lang: 'fr', seesAll }) as unknown as Ctx;

  it('is refused to anyone but a records manager with access to Administration', async () => {
    vi.stubEnv('CODEX_BACKUP_DIR', BACKUPS);
    await fill();
    // The records manager simulating another role sees no more than that role.
    for (const [who, role] of [['owner', undefined], ['auditor', undefined], ['head', undefined], ['manager', 'collaborateur'], ['manager', 'validateur']] as const) {
      actAs(who, role);
      expect(await backUpData(), who).toEqual({ ok: false, error: DICT.fr.forbidden });
    }
    // A validator granted the right to administer is still no records manager: the archive holds every draft (D-14).
    await db().insert(s.rolePermissions).values({ role: 'validateur', perm: 'admin', granted: true });
    actAs('head');
    expect(await backUpData()).toEqual({ ok: false, error: DICT.fr.forbidden });
    expect(existsSync(BACKUPS)).toBe(false);
    expect(await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'backup_created'))).toEqual([]);
  });

  it('backs up for a records manager, journals the archive with counts only, and reads back in the journal', async () => {
    vi.stubEnv('CODEX_BACKUP_DIR', BACKUPS);
    await fill();
    actAs('manager');
    const r = await backUpData();
    expect(r).toMatchObject({ ok: true, message: expect.stringMatching(/^Sauvegarde créée : codex-backup-.*\.tar \(.+\)\. Fichiers conservés sur SharePoint, non inclus : 1\.$/) });
    const [b] = await listBackups(BACKUPS);
    expect(b.manifest).toMatchObject({ mode: 'online', by: 'manager', counts: { documents: 3 }, files: { count: 2 } });
    const [entry] = await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'backup_created'));
    expect(entry).toMatchObject({ userId: 'manager', targetKind: 'backup', targetId: b.name, docId: null });
    expect(entry.data?.backup).toMatchObject({ archive: b.name, size: b.size, documents: 3, files: 2, bytes: 20, missing: 0, sharepoint: 1, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    // The SHA-256 the journal keeps is the archive's, to compare with a copy kept elsewhere.
    expect(createHash('sha256').update(readFileSync(b.path)).digest('hex')).toBe(entry.data?.backup?.sha256);
    const detail = auditDetailL(ctx(true), entry);
    expect(detail).toContain('3 documents');
    expect(detail).toContain('fichiers : 2 (20 o)');
    expect(detail).not.toMatch(/PRO-QUA/);
    expect(await readManifest(b.path)).toEqual(b.manifest);
  });

  it('shows what an archive holds to records managers only in the journal', async () => {
    vi.stubEnv('CODEX_BACKUP_DIR', BACKUPS);
    await fill();
    actAs('manager');
    expect(await backUpData()).toMatchObject({ ok: true });
    const [entry] = await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'backup_created'));
    expect(auditDetailL(await getCtx(), entry)).toMatch(/^3 documents · fichiers : 2/);
    // A validator granted the right to administer reads the journal of Administration, the entry included, but not the
    // counts: every document, drafts and confidential ones, would tell how many are hidden from them (D-14).
    await db().insert(s.rolePermissions).values({ role: 'validateur', perm: 'admin', granted: true });
    actAs('head');
    const head = await getCtx();
    expect(head.screens.admin).toBe(true);
    expect(auditDetailL(head, entry)).toBe('');
  });

  it('refuses to back up again within 15 minutes of the latest archive: a run of clicks keeps the archives before it', async () => {
    vi.stubEnv('CODEX_BACKUP_DIR', BACKUPS);
    vi.stubEnv('CODEX_BACKUP_KEEP', '2');
    await fill();
    // Made the day before, from the command line.
    const before = await backup({ now: new Date('2026-10-14T16:00:00Z') });
    const t0 = Date.parse('2026-10-15T08:00:00Z');
    setClock(new Date(t0).toISOString());
    actAs('manager');
    expect(await backUpData()).toMatchObject({ ok: true });
    for (let i = 1; i <= 3; i++) {
      setClock(new Date(t0 + i * 60_000).toISOString());
      expect(await backUpData()).toEqual({ ok: false, error: expect.stringMatching(/^La dernière sauvegarde date du 15\/10\/2026 10:00, il y a moins de 15 minutes .* à partir du 15\/10\/2026 10:15 ;/) });
    }
    expect(await listBackups(BACKUPS)).toHaveLength(2);
    // One every 16 minutes, more than the rotation keeps: the archive of the day before stays.
    for (let i = 1; i <= 3; i++) {
      setClock(new Date(t0 + i * 16 * 60_000).toISOString());
      expect(await backUpData()).toMatchObject({ ok: true });
    }
    const names = (await listBackups(BACKUPS)).map((b) => b.name);
    expect(names).toEqual([archiveName(new Date(t0 + 48 * 60_000)), archiveName(new Date(t0 + 32 * 60_000)), before.name]);
    expect(await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'backup_created'))).toHaveLength(4);
  });

  it('writes beside the data directory when CODEX_BACKUP_DIR is not set', async () => {
    vi.stubEnv('CODEX_BACKUP_DIR', '');
    actAs('manager');
    expect(await backUpData()).toMatchObject({ ok: true });
    expect(await listBackups(`${DATA_DIR}-backups`)).toHaveLength(1);
  });
});
