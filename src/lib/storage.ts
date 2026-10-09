import 'server-only';
import { randomUUID } from 'node:crypto';
import { link, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { eq } from 'drizzle-orm';
import { FILES_DIR, getDb, schema as s } from '@/db';

// File storage behind one interface (docs/modele-cible.md §1). Codex keeps all metadata; a store only holds bytes.
//   CODEX_STORAGE=local       (default) files under .data/files
//   CODEX_STORAGE=sharepoint  a SharePoint library driven by Codex through Microsoft Graph (app-only):
//     CODEX_SP_TENANT_ID, CODEX_SP_CLIENT_ID, CODEX_SP_CLIENT_SECRET, CODEX_SP_DRIVE_ID (the library's drive)
//
// Uploads never run inside a database transaction (PGlite holds one lock for the whole database): a file is staged
// first under a provisional name, the record is written, then the file gets its name {ID}_{label}.{ext}.

export type StoredFile = { storage: string; fileKey: string; fileName: string; mime: string; size: number; pages: number | null };
/** A file in the store that no record may point to yet; `ext` is kept for its final name. */
export type StagedFile = StoredFile & { ext: string };

/** The store answered that the file does not exist (as opposed to a store that cannot be reached). */
export class FileNotFoundError extends Error {}

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
  remove(key: string): Promise<void>;
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
  async remove(key) {
    await rm(path.join(FILES_DIR, path.basename(key)), { force: true });
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
  async function bearer() {
    if (token && token.exp > Date.now() + 60_000) return token.value;
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
      const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${await bearer()}`, ...init.headers }, signal: AbortSignal.timeout(timeoutMs) });
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
      // Simple upload (≤ 250 MB, see /api/import's cap); `fail` never silently replaces another file.
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
    async remove(key) {
      const res = await graph(`${drive()}/items/${encodeURIComponent(key)}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`SharePoint delete failed: ${res.status}`);
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

export function storageIsSharepoint(): boolean {
  return store().name === 'sharepoint';
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
 * sent for a file that is not text — what a multipart part without Content-Type turns into) is inferred from the
 * extension, and from the `%PDF-` signature when the bytes are at hand.
 */
export function normalizeMime(raw: string | null | undefined, name: string, buf?: Buffer): string {
  const essence = (raw ?? '').split(';')[0].trim().toLowerCase();
  const ext = path.extname(name).toLowerCase();
  const generic = !essence || essence === 'application/octet-stream' || (essence === 'text/plain' && !TEXT_EXTS.has(ext));
  if (!generic) return essence;
  if (buf && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return MIME_BY_EXT[ext] ?? (essence || 'application/octet-stream');
}

/**
 * Page count of a PDF: the largest /Count of a /Pages node (the root's), looked up in the plain objects and inside
 * compressed object streams (PDF ≥ 1.5). Falls back to counting /Page objects, then to null when unknown.
 */
function countPdfPages(buf: Buffer, mime: string): number | null {
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

/** Uploads a file to the active store under a provisional name. Call before the transaction that records it. */
export async function stageFile(buf: Buffer, originalName: string, rawMime: string): Promise<StagedFile> {
  const mime = normalizeMime(rawMime, originalName, buf);
  const ext = (path.extname(originalName) || EXT_BY_MIME[mime] || '').toLowerCase().replace(/[^.\w]/g, '');
  const st = store();
  const fileKey = await st.put(buf, `upload${ext}`);
  return { storage: st.name, fileKey, fileName: originalName, mime, size: buf.length, pages: countPdfPages(buf, mime), ext };
}

export async function stageUpload(file: File): Promise<StagedFile> {
  return stageFile(Buffer.from(await file.arrayBuffer()), file.name, file.type);
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
    console.error('[storage] naming', f.fileKey, err);
  }
}

/**
 * After a reclassification (new ID), gives every stored file of the document its name under the new ID:
 * {ID}_{letter}.{n}.{ext} in the new ID's folder. Best effort, file by file, like nameStoredFile.
 */
export async function renameDocFiles(docId: string): Promise<void> {
  const db = await getDb();
  const rows = await db
    .select({ storage: s.workingVersions.storage, fileKey: s.workingVersions.fileKey, n: s.workingVersions.n, letter: s.revisions.letter })
    .from(s.workingVersions)
    .innerJoin(s.revisions, eq(s.revisions.id, s.workingVersions.revisionId))
    .where(eq(s.workingVersions.docId, docId));
  for (const r of rows) {
    if (!r.fileKey) continue;
    const ext = path.extname(r.fileKey).toLowerCase();
    await nameStoredFile({ storage: r.storage ?? 'local', fileKey: r.fileKey, fileName: '', mime: '', size: 0, pages: null, ext }, docId, `${r.letter}.${r.n}`);
  }
}

/** Removes a staged file that no record points to (the transaction refused or failed). Best effort. */
export async function discardFile(f: StagedFile | null): Promise<void> {
  if (!f) return;
  try {
    await stores(f.storage).remove(f.fileKey);
  } catch (err) {
    console.error('[storage] discard', f.fileKey, err);
  }
}

/** Bytes of a stored file. Throws FileNotFoundError when the store has no such file, another error when it is unreachable. */
export async function readStored(storage: string | null, fileKey: string): Promise<Buffer> {
  return stores(storage).get(fileKey);
}
