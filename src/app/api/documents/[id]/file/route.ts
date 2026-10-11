import path from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { getDb, schema as s } from '@/db';
import { readerMaySeeVersion } from '@/lib/access';
import { isFinalStatus } from '@/lib/codes';
import { getCtx, type Ctx } from '@/lib/context';
import { INLINE_SAFE } from '@/lib/filetypes';
import { fmtDate } from '@/lib/format';
import { audit } from '@/lib/lifecycle';
import { simplePdf } from '@/lib/pdf';
import { getDoc, type DocView } from '@/lib/queries';
import { EXT_BY_MIME, FileNotFoundError, normalizeMime, readStored } from '@/lib/storage';

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
type Target = { ctx: Ctx; doc: DocView; version: Version; label: string; mime: string; ext: string; download: boolean };

/**
 * The working version a request asks for, once the user may have it: ?v=<working version id>, otherwise the file of the
 * revision in force, else (drafting circle only) the last working version of the revision being drafted. Outside the
 * drafting circle, only the final file of the revision in force (docs/modele-cible.md §5).
 */
async function resolve(req: Request, id: string): Promise<Target | Response> {
  const url = new URL(req.url);
  const download = url.searchParams.get('download') === '1';
  const rawV = url.searchParams.get('v');
  const vid = rawV === null ? null : Number(rawV);
  if (vid !== null && !(Number.isInteger(vid) && vid > 0 && vid <= 2 ** 31 - 1)) return notFound();

  const ctx = await getCtx();
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
  if (!version.fileKey) return { ctx, doc, version, label, mime: 'application/pdf', ext: '.pdf', download };
  const name = version.fileName ?? '';
  // Rows imported before the type was normalised (text/plain for a PDF…) are corrected from the file name.
  const mime = normalizeMime(version.mime, name);
  // The extension comes from the original name, else the type: the key carries the version label ("…_A.1"), not one.
  const ext = (path.extname(name) || EXT_BY_MIME[mime] || '').toLowerCase().replace(/[^.\w]/g, '');
  return { ctx, doc, version, label, mime, ext, download };
}

function headers(x: Target, size: number | null): HeadersInit {
  const inline = !x.download && INLINE_SAFE.has(x.mime);
  return {
    'Content-Type': inline || x.download ? x.mime : 'application/octet-stream',
    ...(size != null ? { 'Content-Length': String(size) } : {}),
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(`${x.doc.id}_${x.label}${STATE_SUFFIX[x.doc.state] ?? ''}${x.ext}`)}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

/** Serves the file; ?download=1 forces a download and is logged. */
export async function GET(req: Request, { params }: RouteContext<'/api/documents/[id]/file'>) {
  const x = await resolve(req, (await params).id);
  if (x instanceof Response) return x;
  const { ctx, doc, version } = x;
  let body: Buffer;
  if (version.fileKey) {
    try {
      body = await readStored(version.storage, version.fileKey);
    } catch (err) {
      if (err instanceof FileNotFoundError) return notFound('File missing');
      console.error('[api/documents/file]', err);
      return new Response('Storage unavailable', { status: 502, headers: { 'Retry-After': '30' } });
    }
  } else {
    // Demo records carry no file: hand out a one-page stand-in PDF built from the record.
    body = simplePdf([
      { text: `${doc.id} · ${x.label}`, size: 9, grey: true, gap: 0 },
      { text: doc.title, size: 16, gap: 40 },
      { text: doc.path, size: 10, grey: true, gap: 24 },
      { text: `${ctx.t.owner} : ${doc.owner}`, gap: 36 },
      { text: `${ctx.t.date} : ${fmtDate(version.date, ctx.lang)}` },
      { text: `${ctx.t.conf} : ${doc.confL}` },
      { text: ctx.t.no_file, size: 9, grey: true, gap: 40 },
    ]);
  }
  if (x.download) {
    const db = await getDb();
    await audit(db, ctx.user.id, 'download', doc.id, `${x.label} · ${x.mime === 'application/pdf' ? 'PDF' : x.ext.slice(1).toUpperCase() || 'Fichier'}`, version.revisionId);
  }
  return new Response(new Uint8Array(body), { headers: headers(x, body.length) });
}

/** Same checks and headers as GET, without reading the file nor logging a download (link checkers, download managers). */
export async function HEAD(req: Request, { params }: RouteContext<'/api/documents/[id]/file'>) {
  const x = await resolve(req, (await params).id);
  if (x instanceof Response) return new Response(null, { status: x.status });
  return new Response(null, { headers: headers(x, x.version.fileKey ? x.version.size : null) });
}
