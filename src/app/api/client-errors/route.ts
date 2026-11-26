import { getCtx } from '@/lib/context';
import { MAX_CLIENT_REPORT_BYTES, readClientReport } from '@/lib/client-errors';
import { logger, withRequestLog } from '@/lib/log';
import { limitReader } from '@/lib/ratelimit';

// Errors of the browser (lib/client-errors.ts): POST /api/client-errors with the report an error screen built writes it
// to the technical log (scope `client`, level warn) under the reference the screen shows, so that the administrator
// finds it as they find a server error. Answers 204 without a body, whatever is logged; 400 for a report that is not one,
// 413 beyond 8 kB. Only a user Codex resolved may report (lib/context.ts), at most CODEX_RATE_CLIENT_ERRORS a minute.

const log = logger('client');
const NO_STORE = { 'Cache-Control': 'no-store' };

async function handlePost(req: Request) {
  const ctx = await getCtx();
  const limited = limitReader(req, 'clientErrors', ctx.user.id, ctx.tr);
  if (limited) return limited;
  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > MAX_CLIENT_REPORT_BYTES) return new Response(null, { status: 413, headers: NO_STORE });
  const text = await req.text();
  if (text.length > MAX_CLIENT_REPORT_BYTES) return new Response(null, { status: 413, headers: NO_STORE });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  const report = readClientReport(raw);
  if (!report) return new Response(null, { status: 400, headers: NO_STORE });
  log.warn('browser error', { ref: report.ref, user: ctx.user.id, path: report.path, error: { name: report.name, message: report.message, frames: report.frames } });
  return new Response(null, { status: 204, headers: NO_STORE });
}

export const POST = withRequestLog('/api/client-errors', handlePost);
