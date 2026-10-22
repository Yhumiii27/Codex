import { mayExportAll } from '@/lib/access';
import { getCtx } from '@/lib/context';
import { startFullExport } from '@/lib/full-export';
import { withRequestLog } from '@/lib/log';
import { limitReader } from '@/lib/ratelimit';

/** The archive is named after the instant of its snapshot; private, never kept by a browser or a proxy. */
function headers(name: string): HeadersInit {
  return {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${name}"`,
    'Cache-Control': 'private, no-store',
  };
}

/**
 * Full export for reversibility (point 17 of docs/reste-a-faire.md; format: docs/export.md): every table, the whole
 * journal and every stored file, drafts included, in one ZIP archive streamed as it is written. A records manager with
 * access to Administration only (lib/access.ts mayExportAll); journaled at its start, inside the snapshot the archive is
 * made from, and at its end (done with the archive's SHA-256, interrupted, or failed). Counted in the exports' budget.
 */
async function handleGet(req: Request) {
  const ctx = await getCtx();
  // Counted per user as resolved from the session, never per raw cookie (lib/ratelimit.ts).
  const limited = limitReader(req, 'exports', ctx.user.id, ctx.t);
  if (limited) return limited;
  if (!mayExportAll(ctx)) return new Response('Forbidden', { status: 403 });
  const { name, body } = await startFullExport(ctx.user.id);
  return new Response(body, { headers: headers(name) });
}

/** Same check and headers as GET, without exporting nor journaling anything (link checkers, download managers). */
async function handleHead(req: Request) {
  const ctx = await getCtx();
  const limited = limitReader(req, 'exports', ctx.user.id, ctx.t);
  if (limited) return new Response(null, { status: limited.status, headers: limited.headers });
  if (!mayExportAll(ctx)) return new Response(null, { status: 403 });
  return new Response(null, { headers: headers('codex-export.zip') });
}

export const GET = withRequestLog('/api/export/full', handleGet);
export const HEAD = withRequestLog('/api/export/full', handleHead);
