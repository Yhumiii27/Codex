import { getCtx } from '@/lib/context';
import { isLinkRel } from '@/lib/links';
import { withRequestLog } from '@/lib/log';
import { docCandidates, getDoc } from '@/lib/queries';
import { limitReader } from '@/lib/ratelimit';

// Documents the record's dialogs offer as the user types (point 47 of docs/reste-a-faire.md, lib/queries.ts
// docCandidates): GET ?for=link|replacement[&rel=see_also|replaces|replaced_by]&q=… answers in JSON
// { options: [{ key, label, withdrawn, active }], more }. 404 for a document the user may not read, as the file route;
// limited per user by CODEX_RATE_LOOKUPS. The Server Actions check everything again (addDocLink, requestChange).

const notFound = () => new Response('Not found', { status: 404 });

function safeDecode(x: string): string {
  try {
    return decodeURIComponent(x);
  } catch {
    return x;
  }
}

async function handleGet(req: Request, { params }: RouteContext<'/api/documents/[id]/candidates'>) {
  const ctx = await getCtx();
  const limited = limitReader(req, 'lookups', ctx.user.id, ctx.t);
  if (limited) return limited;
  const url = new URL(req.url);
  const purpose = url.searchParams.get('for');
  if (purpose !== 'link' && purpose !== 'replacement') return notFound();
  const rel = url.searchParams.get('rel');
  const found = await getDoc(ctx, safeDecode((await params).id));
  if (!found || found === 'hidden') return notFound();
  const result = await docCandidates(ctx, found.doc.id, { purpose, rel: isLinkRel(rel) ? rel : undefined, q: url.searchParams.get('q') ?? '' });
  return Response.json(result, { headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export const GET = withRequestLog('/api/documents/[id]/candidates', handleGet);
