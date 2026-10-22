import { getDb } from '@/db';
import { databaseIsEmpty } from '@/lib/empty-database';
import { logger, withRequestLog } from '@/lib/log';
import { probeStore } from '@/lib/storage';
import { appVersion } from '@/lib/version';

// Health of the server, for the supervision (point 49 of docs/reste-a-faire.md, docs/exploitation.md): GET or HEAD
// /api/health answers 200 when the database answers a query and the active file store can be used, 503 otherwise
// (`empty: true` while a server database is left unseeded).
// No session, no token: it says only which check failed, never why (the reason goes to the technical log, under the
// request's identifier), nor anything of the documents. A SharePoint store is checked at most once a minute.

// Run at each request, never built ahead: the answer is the server's state now.
export const dynamic = 'force-dynamic';

const log = logger('health');

/** Longest wait for one check: a database or a store that hangs is reported down rather than holding the probe. */
const CHECK_TIMEOUT_MS = 5_000;

type Check = { ok: boolean; ms: number };

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

async function run(name: string, fn: () => Promise<unknown>): Promise<Check> {
  const start = performance.now();
  try {
    await within(fn(), CHECK_TIMEOUT_MS);
    return { ok: true, ms: Math.round(performance.now() - start) };
  } catch (err) {
    log.warn(`${name} check failed`, { err });
    return { ok: false, ms: Math.round(performance.now() - start) };
  }
}

/**
 * The checks: the database (opened on first use, then `select 1`), then the store, whose local folder is created when
 * the database opens. One after the other, each with its own time: a database still opening is not read as a store
 * that does not answer.
 */
async function health() {
  const database = await run('database', async () => (await getDb()).$client.query('select 1'));
  const storage = await run('storage', () => probeStore());
  const ok = database.ok && storage.ok;
  // A server database left empty (no CODEX_SEED, src/db/index.ts) still answers 200: the server works and its pages say
  // how to fill it; `empty` tells the supervision so.
  const empty = database.ok && (await databaseIsEmpty().catch(() => false));
  const body = { status: ok ? 'ok' : 'fail', version: await appVersion(), checks: { database, storage }, ...(empty ? { empty: true } : {}), time: new Date().toISOString() };
  return { ok, body };
}

const HEADERS = { 'Cache-Control': 'no-store' };

async function handleGet() {
  const { ok, body } = await health();
  return Response.json(body, { status: ok ? 200 : 503, headers: HEADERS });
}

async function handleHead() {
  const { ok } = await health();
  return new Response(null, { status: ok ? 200 : 503, headers: HEADERS });
}

export const GET = withRequestLog('/api/health', handleGet, { quiet: true });
export const HEAD = withRequestLog('/api/health', handleHead, { quiet: true });
