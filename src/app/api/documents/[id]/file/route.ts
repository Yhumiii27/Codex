import { createHash } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { getDb, schema as s } from '@/db';
import { browserMayKeep, readerMaySeeVersion } from '@/lib/access';
import { isFinalStatus } from '@/lib/codes';
import { getCtx, type Ctx } from '@/lib/context';
import { INLINE_SAFE } from '@/lib/filetypes';
import { fmtDate } from '@/lib/format';
import { audit } from '@/lib/lifecycle';
import { logger, withRequestLog } from '@/lib/log';
import { simplePdf } from '@/lib/pdf';
import { getDoc, type DocView } from '@/lib/queries';
import { fileAnswer, type FileAnswer } from '@/lib/ranges';
import { limitReader } from '@/lib/ratelimit';
import { FileNotFoundError, normalizeMime, openStored, storedExt, type FileSource } from '@/lib/storage';

// A stored file, streamed from its store (never read whole into memory), with byte ranges (206, 416) and validators
// (ETag, Last-Modified, 304) after RFC 9110: lib/ranges.ts decides, once access is granted. Point 46 of
// docs/reste-a-faire.md.

const WORKING = new Set(['draft', 'in_review', 'approved']);
/** Suffix of the proposed name for a document withdrawn or archived; the file itself is served unchanged. */
const STATE_SUFFIX: Record<string, string> = { obsolete: '_OBSOLETE', archived: '_ARCHIVE' };

const notFound = (text = 'Not found') => new Response(text, { status: 404 });

function safeDecode(x: string): string {
  try {
    return decodeURIComponent(x);
  } catch {
    return x;
  }
}

type Version = typeof s.workingVersions.$inferSelect;
/** `keep`: the browser may keep the file and revalidate it (lib/access.ts browserMayKeep). */
type Target = { ctx: Ctx; doc: DocView; version: Version; label: string; mime: string; ext: string; download: boolean; keep: boolean };

/**
 * The working version a request asks for, once the user may have it: ?v=<working version id>, otherwise the file of the
 * revision in force, else (drafting circle only) the last working version of the revision being drafted. Outside the
 * drafting circle, only the final file of the revision in force (docs/modele-cible.md §5).
 */
async function resolve(req: Request, id: string): Promise<Target | Response> {
  const ctx = await getCtx();
  // Counted per user as resolved from the session, never per raw cookie (lib/ratelimit.ts).
  const limited = limitReader(req, 'files', ctx.user.id, ctx.t);
  if (limited) return limited;
  const url = new URL(req.url);
  const download = url.searchParams.get('download') === '1';
  const rawV = url.searchParams.get('v');
  const vid = rawV === null ? null : Number(rawV);
  if (vid !== null && !(Number.isInteger(vid) && vid > 0 && vid <= 2 ** 31 - 1)) return notFound();

  const res = await getDoc(ctx, safeDecode(id));
  if (!res || res === 'hidden') return notFound();
  const { doc, circle } = res;

  const db = await getDb();
  const [revs, versions] = await Promise.all([
    db.select().from(s.revisions).where(eq(s.revisions.docId, doc.id)).orderBy(asc(s.revisions.id)),
    db.select().from(s.workingVersions).where(eq(s.workingVersions.docId, doc.id)).orderBy(asc(s.workingVersions.n)),
  ]);
  const lastOf = (revId: number) => versions.findLast((v) => v.revisionId === revId) ?? null;

  const inForce = revs.findLast((r) => r.status === 'in_force');
  const working = revs.findLast((r) => WORKING.has(r.status));
  const version = vid !== null
    ? versions.find((v) => v.id === vid) ?? null
    : (inForce && lastOf(inForce.id)) || (circle && working ? lastOf(working.id) : null);
  const rev = version ? revs.find((r) => r.id === version.revisionId) : undefined;
  if (!version || !rev) return notFound();
  const isFinal = lastOf(rev.id)?.id === version.id;
  if (!readerMaySeeVersion(circle, rev.status, isFinal)) return notFound();

  // "B" for the final version of an approved revision, "B.2" for a working version.
  const label = isFinalStatus(rev.status) && isFinal ? rev.letter : `${rev.letter}.${version.n}`;
  // An explicit download is never answered from the browser's copy: it is how downloads are journaled.
  const keep = !download && browserMayKeep(rev.status, isFinal, doc.conf);
  if (!version.fileKey) return { ctx, doc, version, label, mime: 'application/pdf', ext: '.pdf', download, keep };
  const name = version.fileName ?? '';
  // Rows imported before the type was normalised (text/plain for a PDF…) are corrected from the file name.
  const mime = normalizeMime(version.mime, name);
  // The extension comes from the original name, else the type, as at upload (storedExt): the key carries the version
  // label ("…_A.1"), not one.
  const ext = storedExt(name, mime);
  return { ctx, doc, version, label, mime, ext, download, keep };
}

/** The file to serve and its strong validator (ETag), with its last change when the store gives it (Last-Modified). */
type Source = { src: FileSource; etag: string };

/** Hashed: nothing of the record shows in the tag. */
const tagOf = (parts: unknown[]) => `"${createHash('sha256').update(JSON.stringify(parts)).digest('base64url').slice(0, 32)}"`;

/**
 * The file's bytes, from its store, or, for a demo record without file, a one-page stand-in PDF built from the record.
 * Its ETag: a working version's file never changes once stored (a rename keeps its bytes), so its ID, size and date
 * identify the bytes; a stand-in is identified by its bytes. The record's ID, version label and state name the file
 * (Content-Disposition) and change the tag too. The store is not read here: a local file is only looked up.
 */
async function source(x: Target): Promise<Source> {
  const { ctx, doc, version } = x;
  const naming = [doc.id, x.label, doc.state, x.mime, x.ext];
  if (version.fileKey) {
    const src = await openStored(version.storage, version.fileKey, version.size);
    return { src, etag: tagOf([version.id, src.size, src.modified?.getTime() ?? null, ...naming]) };
  }
  const body = simplePdf([
    { text: `${doc.id} · ${x.label}`, size: 9, grey: true, gap: 0 },
    { text: doc.title, size: 16, gap: 40 },
    { text: doc.path, size: 10, grey: true, gap: 24 },
    { text: `${ctx.t.owner} : ${doc.owner}`, gap: 36 },
    { text: `${ctx.t.date} : ${fmtDate(version.date, ctx.lang)}` },
    { text: `${ctx.t.conf} : ${doc.confL}` },
    { text: ctx.t.no_file, size: 9, grey: true, gap: 40 },
  ]);
  const src: FileSource = {
    size: body.length,
    modified: null,
    read: async (range) => new Blob([new Uint8Array(range ? body.subarray(range.start, range.end + 1) : body)]).stream(),
  };
  return { src, etag: tagOf([createHash('sha256').update(body).digest('base64url'), ...naming]) };
}

function headers(x: Target, { src, etag }: Source, a: FileAnswer): Headers {
  const size = src.size;
  const inline = !x.download && INLINE_SAFE.has(x.mime);
  const h = new Headers({
    'Cache-Control': x.keep ? 'private, no-cache, no-transform' : 'private, no-store, no-transform',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  });
  if (src.modified) h.set('Last-Modified', src.modified.toUTCString());
  if (a.status === 304) return h;
  if (size != null) h.set('Accept-Ranges', 'bytes');
  if (a.status === 416) {
    h.set('Cache-Control', 'private, no-store');
    h.set('Content-Range', `bytes */${size}`);
    h.set('Content-Type', 'text/plain; charset=utf-8');
    return h;
  }
  h.set('Content-Type', inline || x.download ? x.mime : 'application/octet-stream');
  h.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(`${x.doc.id}_${x.label}${STATE_SUFFIX[x.doc.state] ?? ''}${x.ext}`)}`);
  if (a.status === 206) {
    h.set('Content-Range', `bytes ${a.range.start}-${a.range.end}/${size}`);
    h.set('Content-Length', String(a.range.end - a.range.start + 1));
  } else if (size != null) {
    h.set('Content-Length', String(size));
  }
  return h;
}

/** The store's failure as an answer: the file missing (404) or the store out of reach (502). */
function storeFailure(err: unknown): Response {
  if (err instanceof FileNotFoundError) return notFound('File missing');
  logger('storage').error('store unreachable', { err });
  return new Response('Storage unavailable', { status: 502, headers: { 'Retry-After': '30' } });
}

/**
 * Serves the file, streamed; ?download=1 forces a download and is logged. A Range gets 206 (or 416); a copy the browser
 * may keep (Target.keep) gets 304 while current. A download is journaled once per transfer that starts at its first
 * byte: a resumed transfer (a range further on) is the same download.
 */
async function handleGet(req: Request, { params }: RouteContext<'/api/documents/[id]/file'>) {
  const x = await resolve(req, (await params).id);
  if (x instanceof Response) return x;
  const { ctx, doc, version } = x;
  let file: Source;
  try {
    file = await source(x);
  } catch (err) {
    return storeFailure(err);
  }
  const { src, etag } = file;
  const a = fileAnswer(req.headers, { method: 'GET', size: src.size, etag, modified: src.modified, conditional: x.keep });
  if (a.status === 304) return new Response(null, { status: 304, headers: headers(x, file, a) });
  if (a.status === 416) return new Response('Range Not Satisfiable', { status: 416, headers: headers(x, file, a) });
  let body: ReadableStream<Uint8Array>;
  try {
    body = await src.read(a.status === 206 ? a.range : undefined);
  } catch (err) {
    return storeFailure(err);
  }
  if (x.download && (a.status === 200 || a.range.start === 0)) {
    try {
      const db = await getDb();
      await audit(db, ctx.user.id, 'download', doc.id, `${x.label} · ${x.mime === 'application/pdf' ? 'PDF' : x.ext.slice(1).toUpperCase() || 'Fichier'}`, version.revisionId);
    } catch (err) {
      // Not sent unless journaled; the file opened for it is released.
      await body.cancel().catch(() => {});
      throw err;
    }
  }
  return new Response(body, { status: a.status, headers: headers(x, file, a) });
}

/**
 * Same checks and headers as GET (304 included; a Range is for GET only), without reading the file nor logging a
 * download (link checkers, download managers). The store is asked whether the file exists, as GET does.
 */
async function handleHead(req: Request, { params }: RouteContext<'/api/documents/[id]/file'>) {
  const x = await resolve(req, (await params).id);
  if (x instanceof Response) return new Response(null, { status: x.status, headers: x.headers });
  let file: Source;
  try {
    file = await source(x);
  } catch (err) {
    const res = storeFailure(err);
    return new Response(null, { status: res.status, headers: res.headers });
  }
  const a = fileAnswer(req.headers, { method: 'HEAD', size: file.src.size, etag: file.etag, modified: file.src.modified, conditional: x.keep });
  return new Response(null, { status: a.status, headers: headers(x, file, a) });
}

export const GET = withRequestLog('/api/documents/[id]/file', handleGet);
export const HEAD = withRequestLog('/api/documents/[id]/file', handleHead);
