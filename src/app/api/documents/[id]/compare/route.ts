import { compareVersions } from '@/lib/compare';
import { getCtx } from '@/lib/context';
import { withRequestLog } from '@/lib/log';
import { limitReader } from '@/lib/ratelimit';

// Content comparison of two versions of a document (point 14 of docs/reste-a-faire.md, lib/compare.ts): GET
// ?a=<working version id>&b=<working version id> answers in JSON the text differences line by line, and per side why its
// text could not be read. Same answer as the file route for what the user may not have: 404 for a document they may
// not read, a version of another document, or one they may not see (D-14). Limited per user by CODEX_RATE_COMPARE.

const notFound = () => new Response('Not found', { status: 404 });

function safeDecode(x: string): string {
  try {
    return decodeURIComponent(x);
  } catch {
    return x;
  }
}

/** A working version id, as the file route reads ?v=. */
function versionId(raw: string | null): number | null {
  const n = raw === null || !/^\d{1,10}$/.test(raw) ? NaN : Number(raw);
  return Number.isInteger(n) && n > 0 && n <= 2 ** 31 - 1 ? n : null;
}

async function handleGet(req: Request, { params }: RouteContext<'/api/documents/[id]/compare'>) {
  const ctx = await getCtx();
  const limited = limitReader(req, 'compare', ctx.user.id, ctx.t);
  if (limited) return limited;
  const url = new URL(req.url);
  const a = versionId(url.searchParams.get('a'));
  const b = versionId(url.searchParams.get('b'));
  if (a === null || b === null) return notFound();
  const result = await compareVersions(ctx, safeDecode((await params).id), a, b);
  if (!result) return notFound();
  if (result === 'busy') {
    return new Response(ctx.t.compare_busy, { status: 503, headers: { 'Retry-After': '5', 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' } });
  }
  return Response.json(result, { headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export const GET = withRequestLog('/api/documents/[id]/compare', handleGet);
