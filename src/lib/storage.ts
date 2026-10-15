import 'server-only';
import { randomUUID } from 'node:crypto';
import { constants as fsc } from 'node:fs';
import { access, link, lstat, open as openFile, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { inflateSync } from 'node:zlib';
import { eq } from 'drizzle-orm';
import { FILES_DIR, getDb, schema as s } from '@/db';
import { scanFile } from './antivirus';
import { cleanFileName, DENIED_EXTENSIONS, extensionOf, fileIssue, fileRules, type FileIssue } from './filetypes';
import { audit } from './lifecycle';
import { logger } from './log';
import { sliceStream, type ByteRange } from './ranges';

// File storage behind one interface (docs/modele-cible.md §1). Codex keeps all metadata; a store only holds bytes.
//   CODEX_STORAGE=local       (default) files under .data/files
//   CODEX_STORAGE=sharepoint  a SharePoint library driven by Codex through Microsoft Graph (app-only):
//     CODEX_SP_TENANT_ID, CODEX_SP_CLIENT_ID, CODEX_SP_CLIENT_SECRET, CODEX_SP_DRIVE_ID (the library's drive)
//
// Uploads never run inside a database transaction (PGlite holds one lock for the whole database): a file is staged
// first under a provisional name, the record is written, then the file gets its name {ID}_{label}.{ext}. Before it is
// staged, a file is checked (format and size, lib/filetypes.ts) and scanned (lib/antivirus.ts): a refused one never
// reaches the store.

const log = logger('storage');

export type StoredFile = { storage: string; fileKey: string; fileName: string; mime: string; size: number; pages: number | null };
/** A file in the store that no record may point to yet; `ext` is kept for its final name. */
export type StagedFile = StoredFile & { ext: string };

/** The store answered that the file does not exist (as opposed to a store that cannot be reached). */
export class FileNotFoundError extends Error {}

/**
 * A stored file about to be served: its size and last change when known, its bytes only once read() is called, as a
 * stream (the whole file, or one range of it). Nothing is held open before read().
 */
export type FileSource = {
  size: number | null;
  modified: Date | null;
  /** Throws FileNotFoundError when the store has no such file, another error when it is out of reach. */
  read(range?: ByteRange): Promise<ReadableStream<Uint8Array>>;
};

/**
 * A file found in a store by the orphan check (lib/orphans.ts): its key, size, and the last time it was written,
 * linked or moved (local: the later of its mtime and ctime; a hard link made by a rename moves the ctime).
 */
export type ListedFile = { key: string; size: number; touched: number };

interface FileStore {
  readonly name: string;
  /** Uploads under a provisional name, never replacing an existing file; returns the key. */
  put(buf: Buffer, name: string): Promise<string>;
  /**
   * Gives the file its name `storedName` ({ID}_{révision}.{ext}) in the document's folder and returns its key. A new key
   * leaves the old one readable until it is removed, so a record never points to a missing file.
   */
  rename(key: string, storedName: string, folder: string): Promise<string>;
  get(key: string): Promise<Buffer>;
  /** The file as a stream; `size`: the record's, for a store that gives none without a request. */
  open(key: string, size: number | null): Promise<FileSource>;
  remove(key: string): Promise<void>;
  /** Files that may be orphans: every file of the local store, the provisional ones (`_staging`) of SharePoint. */
  list(): Promise<ListedFile[]>;
  /** Throws when the store cannot be used: the local folder not readable and writable, SharePoint's library out of reach. */
  probe(): Promise<void>;
}

const safeName = (x: string) => x.replace(/[^\w.\-]+/g, '_');
const UUID_LEN = 36;

const local: FileStore = {
  name: 'local',
  async put(buf, name) {
    const key = `${randomUUID()}-${safeName(name)}`;
    await writeFile(path.join(FILES_DIR, key), buf, { flag: 'wx' });
    return key;
  },
  async rename(key, storedName) {
    const next = `${path.basename(key).slice(0, UUID_LEN)}-${safeName(storedName)}`;
    await link(path.join(FILES_DIR, path.basename(key)), path.join(FILES_DIR, next));
    return next;
  },
  async get(key) {
    try {
      return await readFile(path.join(FILES_DIR, path.basename(key)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new FileNotFoundError(key);
      throw err;
    }
  },
  async open(key) {
    const file = path.join(FILES_DIR, path.basename(key));
    const st = await stat(file).catch((err: NodeJS.ErrnoException) => {
      throw err.code === 'ENOENT' ? new FileNotFoundError(key) : err;
    });
    return {
      size: st.size,
      modified: st.mtime,
      async read(range) {
        // Opened before the response starts: a file renamed or removed afterwards (renameDocFiles) is still read whole.
        const fh = await openFile(file, 'r').catch((err: NodeJS.ErrnoException) => {
          throw err.code === 'ENOENT' ? new FileNotFoundError(key) : err;
        });
        const stream = fh.createReadStream(range ? { start: range.start, end: range.end } : {});
        return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
      },
    };
  },
  async remove(key) {
    await rm(path.join(FILES_DIR, path.basename(key)), { force: true });
  },
  async list() {
    const out: ListedFile[] = [];
    for (const name of await readdir(FILES_DIR)) {
      const st = await lstat(path.join(FILES_DIR, name)).catch(() => null);
      if (st?.isFile()) out.push({ key: name, size: st.size, touched: Math.max(st.mtimeMs, st.ctimeMs) });
    }
    return out;
  },
  async probe() {
    if (!(await stat(FILES_DIR)).isDirectory()) throw new Error(`${FILES_DIR} is not a directory`);
    await access(FILES_DIR, fsc.R_OK | fsc.W_OK);
  },
};

// Not exercised against a real tenant yet: enable only once the app registration and the library exist.
function sharepoint(): FileStore {
  const env = (k: string) => {
    const v = process.env[k];
    if (!v) throw new Error(`SharePoint storage: missing ${k}`);
    return v;
  };
  let token: { value: string; exp: number } | null = null;
  let signingIn: Promise<string> | null = null;
  /** The app's Graph token, asked again a minute before it expires; calls made meanwhile share one request. */
  function bearer(): Promise<string> {
    if (token && token.exp > Date.now() + 60_000) return Promise.resolve(token.value);
    signingIn ??= signIn().finally(() => {
      signingIn = null;
    });
    return signingIn;
  }
  async function signIn(): Promise<string> {
    const res = await fetch(`https://login.microsoftonline.com/${env('CODEX_SP_TENANT_ID')}/oauth2/v2.0/token`, {
      method: 'POST',
      body: new URLSearchParams({ client_id: env('CODEX_SP_CLIENT_ID'), client_secret: env('CODEX_SP_CLIENT_SECRET'), scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`SharePoint auth failed: ${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return token.value;
  }
  /** Graph call with a timeout, retried (a few times, bounded) when Graph throttles: 429 / 503 with Retry-After. */
  async function graph(url: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${await bearer()}`, ...init.headers }, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
      if ((res.status !== 429 && res.status !== 503) || attempt >= 3) return res;
      const wait = Math.min(Number(res.headers.get('retry-after')) || 2 ** attempt, 10);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }
  const drive = () => `https://graph.microsoft.com/v1.0/drives/${env('CODEX_SP_DRIVE_ID')}`;
  const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    name: 'sharepoint',
    async put(buf, name) {
      // Simple upload (≤ 250 MB, the cap of lib/filetypes.ts maxFileBytes); `fail` never silently replaces another file.
      const target = `_staging/${encodeURIComponent(`${randomUUID()}-${name}`)}`;
      const res = await graph(`${drive()}/root:/${target}:/content?@microsoft.graph.conflictBehavior=fail`, { method: 'PUT', body: new Uint8Array(buf) }, 60_000 + buf.length / 1000);
      if (!res.ok) throw new Error(`SharePoint upload failed: ${res.status}`);
      return ((await res.json()) as { id: string }).id;
    },
    async rename(key, storedName, folder) {
      const mk = await graph(`${drive()}/root/children`, jsonInit('POST', { name: folder, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }));
      if (!mk.ok && mk.status !== 409) throw new Error(`SharePoint folder failed: ${mk.status}`);
      const res = await graph(`${drive()}/items/${encodeURIComponent(key)}?@microsoft.graph.conflictBehavior=fail`, jsonInit('PATCH', { name: storedName, parentReference: { path: `/drive/root:/${folder}` } }));
      if (!res.ok) throw new Error(`SharePoint rename failed: ${res.status}`);
      return key; // the driveItem id survives a rename or a move
    },
    async get(key) {
      const res = await graph(`${drive()}/items/${encodeURIComponent(key)}/content`, {}, 120_000);
      if (res.status === 404) throw new FileNotFoundError(key);
      if (!res.ok) throw new Error(`SharePoint download failed: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
    async open(key, size) {
      // Size from the record: Graph is only called once the bytes are read.
      return {
        size,
        modified: null,
        async read(range) {
          // The time limit covers the answer, not the transfer, which may take longer for a large file.
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(new Error('SharePoint download: no answer')), 60_000);
          let res: Response;
          try {
            // Graph redirects /content to a download URL; the Range header follows the redirect.
            res = await graph(`${drive()}/items/${encodeURIComponent(key)}/content`, { headers: range ? { Range: `bytes=${range.start}-${range.end}` } : {}, signal: ctl.signal });
          } finally {
            clearTimeout(timer);
          }
          if (res.status === 404) throw new FileNotFoundError(key);
          if (!res.ok || !res.body) throw new Error(`SharePoint download failed: ${res.status}`);
          // A whole file sent for a range is cut down to it.
          return range && res.status !== 206 ? sliceStream(res.body, range) : res.body;
        },
      };
    },
    async remove(key) {
      const res = await graph(`${drive()}/items/${encodeURIComponent(key)}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`SharePoint delete failed: ${res.status}`);
    },
    async list() {
      // Files staged and never named: a record points to them only if its transaction committed. Paged by Graph.
      const out: ListedFile[] = [];
      let url: string | undefined = `${drive()}/root:/_staging:/children?$select=id,name,size,lastModifiedDateTime,file&$top=200`;
      while (url) {
        const res = await graph(url);
        if (res.status === 404) break; // no _staging folder yet
        if (!res.ok) throw new Error(`SharePoint listing failed: ${res.status}`);
        const page = (await res.json()) as { value: { id: string; size?: number; lastModifiedDateTime?: string; file?: object }[]; '@odata.nextLink'?: string };
        for (const item of page.value) {
          if (item.file) out.push({ key: item.id, size: item.size ?? 0, touched: Date.parse(item.lastModifiedDateTime ?? '') || Date.now() });
        }
        url = page['@odata.nextLink'];
      }
      return out;
    },
    async probe() {
      // The library's drive, its id only: the app registration can still sign in and reach it. Not retried: a health
      // check answers at once.
      const res = await fetch(`${drive()}?$select=id`, { headers: { Authorization: `Bearer ${await bearer()}` }, signal: AbortSignal.timeout(5_000) });
      if (!res.ok) throw new Error(`SharePoint drive: ${res.status}`);
    },
  };
}

let current: FileStore | null = null;
let sp: FileStore | null = null;
function store(): FileStore {
  current ??= process.env.CODEX_STORAGE === 'sharepoint' ? (sp ??= sharepoint()) : local;
  return current;
}

function stores(name: string | null): FileStore {
  return name === 'sharepoint' ? (sp ??= sharepoint()) : local;
}

// ── File types ──────────────────────────────────────────────────────────

export const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'text/plain': '.txt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx', 'application/msword': '.doc', 'application/vnd.ms-excel': '.xls',
  'application/zip': '.zip', 'text/csv': '.csv',
};
const MIME_BY_EXT: Record<string, string> = {
  ...Object.fromEntries(Object.entries(EXT_BY_MIME).map(([m, e]) => [e, m])), '.jpeg': 'image/jpeg', '.log': 'text/plain', '.ppt': 'application/vnd.ms-powerpoint',
};
const TEXT_EXTS = new Set(['.txt', '.csv', '.log']);

/**
 * Media type to store: the bare type/subtype in lower case. A missing or generic type (empty, octet-stream, or text/plain
 * sent for a file whose extension is not a known text one — what a multipart part without Content-Type turns into) is
 * replaced: by the type of the extension, as a browser gives it to a file it uploads; else by PDF when the bytes at hand
 * start with `%PDF-`; else by application/octet-stream. A generic text/plain is never kept: an unknown file is neither
 * served nor previewed as text.
 */
export function normalizeMime(raw: string | null | undefined, name: string, buf?: Buffer): string {
  const essence = (raw ?? '').split(';')[0].trim().toLowerCase();
  const ext = extensionOf(name);
  const generic = !essence || essence === 'application/octet-stream' || (essence === 'text/plain' && !TEXT_EXTS.has(ext));
  if (!generic) return essence;
  const byExt = MIME_BY_EXT[ext];
  if (byExt) return byExt;
  if (buf && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return 'application/octet-stream';
}

/**
 * Extension a stored file is named and served with ({ID}_{label}{ext}): that of its name, the one fileIssue checked
 * (lib/filetypes.ts extensionOf, never path.extname, which reads "procedure.hta/" as ".hta"), else that of its type,
 * unless the type is one Codex never admits (SVG).
 */
export function storedExt(name: string, mime: string): string {
  const byMime = EXT_BY_MIME[mime];
  return (extensionOf(name) || (byMime && !DENIED_EXTENSIONS.has(byMime) ? byMime : '')).replace(/[^.\w]/g, '');
}

/**
 * Page count of a PDF: the largest /Count of a /Pages node (the root's), looked up in the plain objects and inside
 * compressed object streams (PDF ≥ 1.5). Falls back to counting /Page objects, then to null when unknown.
 */
export function countPdfPages(buf: Buffer, mime: string): number | null {
  if (mime !== 'application/pdf') return null;
  const raw = buf.toString('latin1');
  const parts = [raw];
  for (const m of raw.matchAll(/\d+\s+\d+\s+obj\s*<<([\s\S]{0,800}?)stream\r?\n/g)) {
    if (!/\/ObjStm\b/.test(m[1]) || !/\/FlateDecode\b/.test(m[1]) || /\/DecodeParms\b/.test(m[1])) continue;
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) continue;
    try {
      parts.push(inflateSync(buf.subarray(start, end)).toString('latin1'));
    } catch {
      // A damaged or differently encoded stream simply does not count.
    }
  }
  const text = parts.join('\n');
  const counts = [...text.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g)].map((m) => Number(m[1] ?? m[2]));
  if (counts.length) return Math.max(...counts) || null;
  return text.match(/\/Type\s*\/Page(?![s\w])/g)?.length ?? null;
}

// ── Staging and naming ──────────────────────────────────────────────────

/**
 * Why a file was refused on its way in: its format or size, or the virus scan (infected; not scanned: clamd failed, or
 * the file is beyond its limits).
 */
export type FileRejection = FileIssue | { code: 'infected'; threat: string } | { code: 'scan_failed' } | { code: 'scan_too_large' };

export class FileRejectedError extends Error {
  constructor(readonly rejection: FileRejection) {
    super(`file refused: ${rejection.code}`);
  }
}

/**
 * Who sends a file and through which entry, for the journal entry of a file the scan refuses: a new document, a copy of
 * a template (`doc`: the template), a working version (`doc`: its document), an import (`ref`: its legacy reference).
 */
export type UploadOrigin = { userId: string; entry: 'create' | 'template' | 'working' | 'import'; doc?: string; ref?: string };

/**
 * An infected file is journaled as an entry without document (target 'file'): the Administration journal shows it,
 * never the document's (lib/queries.ts auditForReader). A journal out of reach does not let the file in.
 */
async function journalInfected(origin: UploadOrigin, name: string, size: number, threat: string) {
  try {
    const db = await getDb();
    await audit(db, origin.userId, 'file_rejected', { kind: 'file', id: origin.entry }, '', null, {
      file: { name, size, threat, ...(origin.doc ? { doc: origin.doc } : {}), ...(origin.ref ? { ref: origin.ref } : {}) },
    });
  } catch (err) {
    log.error('infected file not journaled', { file: name, err });
  }
}

/**
 * Uploads a file to the active store under a provisional name. Call before the transaction that records it.
 * Throws FileRejectedError, with nothing stored, for a file of a format or size not admitted (lib/filetypes.ts), one the
 * virus scan finds infected (journaled), or one it could not scan while CODEX_CLAMD_ON_ERROR refuses (lib/antivirus.ts).
 */
export async function stageFile(buf: Buffer, originalName: string, rawMime: string, origin: UploadOrigin): Promise<StagedFile> {
  // One name for the check, the record and the stored file: the extension checked is the one the file is served with.
  const name = cleanFileName(originalName);
  const issue = fileIssue(name, buf.length, buf, fileRules(process.env));
  if (issue) throw new FileRejectedError(issue);
  const scan = await scanFile(buf, name);
  if (scan.kind === 'infected') {
    await journalInfected(origin, name, buf.length, scan.threat);
    throw new FileRejectedError({ code: 'infected', threat: scan.threat });
  }
  if (scan.kind === 'failed') throw new FileRejectedError({ code: 'scan_failed' });
  if (scan.kind === 'too_large') throw new FileRejectedError({ code: 'scan_too_large' });
  // A name without extension was admitted on its content: the type the sender declared, which nothing checked, does
  // not give it one.
  const mime = normalizeMime(extensionOf(name) ? rawMime : '', name, buf);
  const ext = storedExt(name, mime);
  const st = store();
  const fileKey = await st.put(buf, `upload${ext}`);
  return { storage: st.name, fileKey, fileName: name, mime, size: buf.length, pages: countPdfPages(buf, mime), ext };
}

export async function stageUpload(file: File, origin: UploadOrigin): Promise<StagedFile> {
  // Refused on its size before its bytes are copied.
  const { maxBytes } = fileRules(process.env);
  if (file.size > maxBytes) throw new FileRejectedError({ code: 'too_large', size: file.size, maxBytes });
  return stageFile(Buffer.from(await file.arrayBuffer()), file.name, file.type, origin);
}

/** Columns of a working version that describe its file. */
export function fileColumns(f: StagedFile): StoredFile {
  return { storage: f.storage, fileKey: f.fileKey, fileName: f.fileName, mime: f.mime, size: f.size, pages: f.pages };
}

/**
 * Once its record is committed, names the file {ID}_{label}.{ext} in the document's folder and keeps the record's key in
 * step. Best effort: a failure leaves the file under its provisional name, still served by its key.
 */
export async function nameStoredFile(f: StagedFile, docId: string, label: string): Promise<void> {
  try {
    const key = await stores(f.storage).rename(f.fileKey, `${docId}_${label}${f.ext}`, docId);
    if (key !== f.fileKey) {
      const db = await getDb();
      await db.update(s.workingVersions).set({ fileKey: key }).where(eq(s.workingVersions.fileKey, f.fileKey));
      await stores(f.storage).remove(f.fileKey);
    }
  } catch (err) {
    log.error('file left under its provisional name', { store: f.storage, key: f.fileKey, err });
  }
}

/**
 * After a reclassification (new ID), gives every stored file of the document its name under the new ID:
 * {ID}_{letter}.{n}.{ext} (in the new ID's folder on SharePoint). Best effort, file by file, like nameStoredFile.
 */
export async function renameDocFiles(docId: string): Promise<void> {
  const db = await getDb();
  const rows = await db
    .select({ storage: s.workingVersions.storage, fileKey: s.workingVersions.fileKey, fileName: s.workingVersions.fileName, mime: s.workingVersions.mime, n: s.workingVersions.n, letter: s.revisions.letter })
    .from(s.workingVersions)
    .innerJoin(s.revisions, eq(s.revisions.id, s.workingVersions.revisionId))
    .where(eq(s.workingVersions.docId, docId));
  for (const r of rows) {
    if (!r.fileKey) continue;
    // Same extension as at upload (stageFile): a SharePoint key is a driveItem id and carries none.
    const name = r.fileName ?? '';
    const ext = storedExt(name, normalizeMime(r.mime, name));
    await nameStoredFile({ storage: r.storage ?? 'local', fileKey: r.fileKey, fileName: name, mime: r.mime ?? '', size: 0, pages: null, ext }, docId, `${r.letter}.${r.n}`);
  }
}

/** Removes a staged file that no record points to (the transaction refused or failed). Best effort. */
export async function discardFile(f: StagedFile | null): Promise<void> {
  if (!f) return;
  try {
    await stores(f.storage).remove(f.fileKey);
  } catch (err) {
    log.error('staged file not removed', { store: f.storage, key: f.fileKey, err });
  }
}

/** Bytes of a stored file. Throws FileNotFoundError when the store has no such file, another error when it is unreachable. */
export async function readStored(storage: string | null, fileKey: string): Promise<Buffer> {
  return stores(storage).get(fileKey);
}

/**
 * A stored file to stream (src/app/api/documents/[id]/file/route.ts): its size and last change, and its bytes on
 * demand. `size`: the record's. Throws FileNotFoundError when the local store has no such file.
 */
export async function openStored(storage: string | null, fileKey: string, size: number | null): Promise<FileSource> {
  return stores(storage).open(fileKey, size);
}

/** Store whose files the orphan check lists (lib/orphans.ts). */
export type StoreName = 'local' | 'sharepoint';

/** The active store's name: SharePoint only with CODEX_STORAGE=sharepoint. */
export function activeStore(): StoreName {
  return process.env.CODEX_STORAGE === 'sharepoint' ? 'sharepoint' : 'local';
}

/** How long a SharePoint check holds: the health route may be polled often, by anyone, and Graph throttles. */
const PROBE_CACHE_MS = 60_000;
let probed: { at: number; ok: boolean } | null = null;
let probing: Promise<void> | null = null;

/**
 * Whether the active store can be used (GET /api/health): the local folder readable and writable, or SharePoint's
 * library reachable. SharePoint's result is kept a minute, and checks asked while one runs wait for it: a burst of
 * health requests makes one call to Graph (and at most one to Entra ID). Throws what failed, for the log; the health
 * route shows none of it. `cached`: the answer of a check made before or by another request.
 */
export async function probeStore(now = Date.now()): Promise<{ store: StoreName; cached: boolean }> {
  const name = activeStore();
  if (name !== 'sharepoint') {
    await stores(name).probe();
    return { store: name, cached: false };
  }
  if (probed && now - probed.at < PROBE_CACHE_MS) {
    if (!probed.ok) throw new Error('SharePoint drive: failed less than a minute ago');
    return { store: name, cached: true };
  }
  const joined = !!probing;
  probing ??= stores(name).probe().then(
    () => {
      probed = { at: now, ok: true };
    },
    (err: unknown) => {
      probed = { at: now, ok: false };
      throw err;
    },
  ).finally(() => {
    probing = null;
  });
  await probing;
  return { store: name, cached: joined };
}

/** Forgets the SharePoint store's token and last check (tests). */
export function resetStores(): void {
  sp = null;
  probed = null;
  probing = null;
}

/** Files that may be orphans in a store (lib/orphans.ts). */
export async function listStoredFiles(storage: StoreName): Promise<ListedFile[]> {
  return stores(storage).list();
}

/** Removes a file of the local store; SharePoint files are never removed by the orphan check (O-01). */
export async function removeLocalFile(fileKey: string): Promise<void> {
  await local.remove(fileKey);
}

/** The last time a local file was written, linked or moved (as list() gives it), or null when it is gone. */
export async function localTouched(fileKey: string): Promise<number | null> {
  const st = await lstat(path.join(FILES_DIR, path.basename(fileKey))).catch(() => null);
  return st?.isFile() ? Math.max(st.mtimeMs, st.ctimeMs) : null;
}
