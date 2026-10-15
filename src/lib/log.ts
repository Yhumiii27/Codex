import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

// Technical log (point 49 of docs/reste-a-faire.md), apart from the business audit trail (audit_log, lib/lifecycle.ts
// audit): one entry per line, for whoever runs the server. JSON in production (one object per line, for a log collector),
// readable text otherwise; CODEX_LOG_LEVEL and CODEX_LOG_FORMAT override both (.env.example).
//
// What never goes in: the content of a document, a token, a cookie, a request body. Fields named like a secret are
// replaced by "[redacted]", bytes by their count, long texts are cut, and an error keeps its name, message, code and
// stack frames only: never the values bound to a failed query, which Drizzle's message quotes, nor a database error's
// detail, which may quote those of a row (serializeError). Paths are logged without their query string,
// routes by their pattern (/api/documents/[id]/file), never with a document's ID.
//
// Every entry written while a request runs carries its identifier (requestId): the client's X-Request-Id when it is
// a plain token (a reverse proxy's), else a new UUID, sent back in the X-Request-Id header of API responses.

export type Level = 'debug' | 'info' | 'warn' | 'error';
export type LogFormat = 'json' | 'pretty';
export type LogSettings = { level: Level | 'silent'; format: LogFormat };

const ORDER: Record<Level | 'silent', number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
export const LOG_LEVELS = Object.keys(ORDER) as (Level | 'silent')[];

type Env = Readonly<Record<string, string | undefined>>;

/** CODEX_LOG_LEVEL (info by default) and CODEX_LOG_FORMAT (json in production, pretty otherwise); a wrong value is ignored. */
export function logSettings(env: Env = process.env): LogSettings {
  const level = env.CODEX_LOG_LEVEL?.trim().toLowerCase() ?? '';
  const format = env.CODEX_LOG_FORMAT?.trim().toLowerCase();
  return {
    level: Object.hasOwn(ORDER, level) ? (level as Level | 'silent') : 'info',
    format: format === 'json' || format === 'pretty' ? format : env.NODE_ENV === 'production' ? 'json' : 'pretty',
  };
}

// ── Request context ─────────────────────────────────────────────────────

export type RequestContext = { requestId: string; route?: string };

// On globalThis: instrumentation.ts is bundled apart from the routes and Server Actions, and dev hot reloads load this
// module again; all of them must share one context and one set of errors already logged.
const g = globalThis as unknown as {
  __codexLogContext?: AsyncLocalStorage<RequestContext>; __codexLoggedErrors?: WeakSet<object>; __codexExpectedAnswers?: WeakSet<Response>;
};
const context = (g.__codexLogContext ??= new AsyncLocalStorage<RequestContext>());
const loggedErrors = (g.__codexLoggedErrors ??= new WeakSet<object>());
const expectedAnswers = (g.__codexExpectedAnswers ??= new WeakSet<Response>());

/** The context of the request being handled, if any. */
export function currentRequest(): RequestContext | undefined {
  return context.getStore();
}

/** Runs `fn` as part of a request: every entry it writes carries `ctx`. */
export function withRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return context.run(ctx, fn);
}

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** The request's identifier: its X-Request-Id when it is a plain token (set by a reverse proxy), else a new UUID. */
export function requestIdOf(headers: Headers | { get(name: string): string | null }): string {
  const sent = headers.get('x-request-id')?.trim();
  return sent && REQUEST_ID.test(sent) ? sent : randomUUID();
}

// ── Entries ─────────────────────────────────────────────────────────────

export type Fields = Record<string, unknown>;
export type Entry = { time: string; level: Level; scope: string; msg: string } & Fields;

const SECRET_KEY = /pass(word)?|secret|token|authori[sz]ation|cookie|^body$|^content$|^buf(fer)?$/i;
const MAX_TEXT = 500;
const MAX_STACK_LINES = 12;
const MAX_STACK_LINE = 300;
const FRAME = /^\s+at /;

const cut = (s: string, max = MAX_TEXT) => (s.length > max ? `${s.slice(0, max)}…` : s);

type ErrorLike = {
  name?: unknown; message?: unknown; code?: unknown; errno?: unknown; digest?: unknown; stack?: unknown; cause?: unknown; query?: unknown; severity?: unknown;
};

/**
 * The message of an error without the values it may quote. A failed query of Drizzle (DrizzleQueryError) reads
 * "Failed query: <SQL>\nparams: <values>": the values bound to the query (a comment, a title, a search) are dropped,
 * the parameterised SQL kept. A database error (PGlite's or pg's, with a SQLSTATE code) quotes the value it could not
 * read at the end of its message ("invalid input syntax for type integer: "…"", "value "…" is out of range"): masked.
 */
function cleanMessage(err: object, e: ErrorLike, raw: string): string {
  const bound = Object.hasOwn(err, 'params');
  if (raw.startsWith('Failed query: ')) {
    // Everything from the first "params:" line on, values included, is dropped; the SQL is Drizzle's own when it has it.
    return cut(typeof e.query === 'string' ? `Failed query: ${e.query}` : raw.split('\nparams:')[0]);
  }
  let msg = bound ? raw.split('\nparams:')[0] : raw;
  const database = bound || (typeof e.severity === 'string' && typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code));
  if (database) msg = msg.replace(/: "[\s\S]*"$/, ': "…"').replace(/\bvalue "[\s\S]*?" is out of range/g, 'value "…" is out of range');
  return cut(msg);
}

/**
 * An error as the log keeps it: name, message (without the values a database error quotes), code, digest, the first
 * frames of its stack, and its cause. The stack is rebuilt from the name, that message and the "at …" frames only,
 * each cut: the raw stack starts with the raw message.
 */
export function serializeError(err: unknown, depth = 0): Fields {
  if (!err || typeof err !== 'object') return { message: cut(String(err)) };
  // Not every thrown object is an Error (PGlite's file system throws an ErrnoError of its own): the same fields are
  // read from it, never its other properties (a database error's detail, query parameters, internal query).
  const e = err as ErrorLike;
  const out: Fields = {};
  const name = typeof e.name === 'string' ? e.name : err.constructor?.name;
  if (name) out.name = name;
  const message = typeof e.message === 'string' ? cleanMessage(err, e, e.message) : '';
  out.message = message;
  for (const k of ['code', 'errno'] as const) if (typeof e[k] === 'string' || typeof e[k] === 'number') out[k] = e[k];
  if (typeof e.digest === 'string') out.digest = e.digest;
  if (typeof e.stack === 'string') {
    const frames = e.stack.split('\n').filter((l) => FRAME.test(l)).slice(0, MAX_STACK_LINES - 1).map((l) => cut(l.trimEnd(), MAX_STACK_LINE));
    const head = `${name ?? 'Error'}${message ? `: ${message.replace(/\s*\n\s*/g, ' ')}` : ''}`;
    if (frames.length) out.stack = [head, ...frames].join('\n');
  }
  if (e.cause !== undefined && depth < 2) out.cause = serializeError(e.cause, depth + 1);
  return out;
}

/** A value made safe to log: secrets out, bytes counted, texts cut, nesting bounded. */
function clean(key: string, v: unknown, depth: number): unknown {
  if (SECRET_KEY.test(key)) return '[redacted]';
  if (v instanceof Error || key === 'err' || key === 'error' || key === 'cause') return typeof v === 'string' ? cut(v) : serializeError(v);
  if (typeof v === 'string') return cut(v);
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'bigint') return String(v);
  if (v instanceof Uint8Array || v instanceof ArrayBuffer) return `[${v.byteLength} bytes]`;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v !== 'object') return `[${typeof v}]`;
  if (depth >= 3) return '[…]';
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => clean('', x, depth + 1));
  return Object.fromEntries(Object.entries(v).slice(0, 50).map(([k, x]) => [k, clean(k, x, depth + 1)]));
}

/** The entry to write: time, level, scope, message, the request's identifier, then the fields made safe. */
export function makeEntry(level: Level, scope: string, msg: string, fields: Fields = {}, now = new Date()): Entry {
  const req = currentRequest();
  const entry: Entry = { time: now.toISOString(), level, scope, msg: cut(msg) };
  if (req) entry.requestId = req.requestId;
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && !(k in entry)) entry[k] = clean(k, v, 0);
  }
  return entry;
}

const plain = (v: unknown): string => {
  if (typeof v === 'string') return /^[^\s"'=]+$/.test(v) ? v : JSON.stringify(v);
  return JSON.stringify(v) ?? String(v);
};

/**
 * The line written: JSON, or `HH:MM:SS.mmm LEVEL [scope] message key=value…` with an error's stack on the next lines.
 */
export function formatEntry(e: Entry, format: LogFormat): string {
  if (format === 'json') return JSON.stringify(e);
  const { time, level, scope, msg, ...rest } = e;
  let stack = '';
  // An error's stack, then its cause's, on the lines below; the fields on the line keep the rest.
  const unstacked = (err: Fields, depth: number): Fields => {
    const { stack: s, cause, ...fields } = err;
    if (typeof s === 'string') stack += `\n${s.split('\n').map((l, i) => `    ${depth && !i ? 'cause: ' : ''}${l.trim()}`).join('\n')}`;
    if (cause && typeof cause === 'object' && !Array.isArray(cause)) return { ...fields, cause: unstacked(cause as Fields, depth + 1) };
    return cause === undefined ? fields : { ...fields, cause };
  };
  const pairs = Object.entries(rest).map(([k, v]) => {
    if (v && typeof v === 'object' && 'message' in v && !Array.isArray(v)) return `${k}=${plain(unstacked(v as Fields, 0))}`;
    return `${k}=${plain(v)}`;
  });
  return `${time.slice(11, 23)} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}${pairs.length ? ` ${pairs.join(' ')}` : ''}${stack}`;
}

const SINK: Record<Level, (line: string) => void> = {
  debug: (l) => console.debug(l),
  info: (l) => console.info(l),
  warn: (l) => console.warn(l),
  error: (l) => console.error(l),
};

/** Writes one entry when its level is at or above CODEX_LOG_LEVEL. Never throws. */
export function write(level: Level, scope: string, msg: string, fields?: Fields): void {
  try {
    const settings = logSettings();
    if (ORDER[level] < ORDER[settings.level]) return;
    SINK[level](formatEntry(makeEntry(level, scope, msg, fields), settings.format));
  } catch {
    // A log that cannot be written never fails the request.
  }
}

export type Logger = Record<Level, (msg: string, fields?: Fields) => void>;

/** A logger for one part of Codex (`scope`: storage, antivirus, http, action…). */
export function logger(scope: string): Logger {
  return {
    debug: (msg, fields) => write('debug', scope, msg, fields),
    info: (msg, fields) => write('info', scope, msg, fields),
    warn: (msg, fields) => write('warn', scope, msg, fields),
    error: (msg, fields) => write('error', scope, msg, fields),
  };
}

// ── Requests, Server Actions, errors ────────────────────────────────────

const ms = (start: number) => Math.round((performance.now() - start) * 10) / 10;

/** Errors Next.js throws to redirect or answer "not found": control flow, not failures. */
function isNavigation(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && /^(NEXT_|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING)/.test(digest);
}

/** An error this log already wrote: onRequestError (src/instrumentation.ts) leaves it out. */
function markLogged(err: unknown) {
  if (err && typeof err === 'object') loggedErrors.add(err);
}

/** Sets X-Request-Id on a response, copying it when its headers cannot be changed (a redirect, a fetched response). */
function tagged(res: Response, requestId: string): Response {
  try {
    res.headers.set('X-Request-Id', requestId);
    return res;
  } catch {
    const copy = new Response(res.body, { status: res.status, statusText: res.statusText, headers: new Headers(res.headers) });
    copy.headers.set('X-Request-Id', requestId);
    return copy;
  }
}

/**
 * Marks a 5xx answer the code means to give, not a failure: an integration endpoint left disabled (503 "disabled",
 * lib/importer.ts checkBearer), the default state, which any client can ask for. withRequestLog writes it at info level,
 * keeping error for what calls for someone (500, a store out of reach, a health check failed).
 */
export function expectedAnswer(res: Response): Response {
  expectedAnswers.add(res);
  return res;
}

/**
 * A route handler that logs each request: method, route (its pattern), status, duration until the response starts, and
 * the request's identifier, also sent back in X-Request-Id. An error the handler throws is logged with its stack and
 * answered 500 {"error":"internal","requestId"}, nothing of it shown. A 5xx answer is logged as an error, unless marked
 * expectedAnswer. `quiet`: a success is logged at debug level only (the health route, polled by the supervision).
 */
export function withRequestLog<A extends unknown[]>(route: string, handler: (req: Request, ...rest: A) => Promise<Response>, opts: { quiet?: boolean } = {}) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    const requestId = requestIdOf(req.headers);
    const start = performance.now();
    return withRequestContext({ requestId, route }, async () => {
      const base = { method: req.method, route };
      let res: Response;
      try {
        res = await handler(req, ...rest);
      } catch (err) {
        markLogged(err);
        write('error', 'http', 'request failed', { ...base, status: 500, durationMs: ms(start), err });
        return tagged(Response.json({ error: 'internal', requestId }, { status: 500, headers: { 'Cache-Control': 'no-store' } }), requestId);
      }
      const level: Level = res.status >= 500 && !expectedAnswers.has(res) ? 'error' : opts.quiet && res.status < 400 ? 'debug' : 'info';
      const length = res.headers.get('content-length');
      write(level, 'http', 'request', { ...base, status: res.status, durationMs: ms(start), bytes: length ? Number(length) : undefined });
      return tagged(res, requestId);
    });
  };
}

/** What a Server Action's result says: done, refused (with the reason shown to the user, not logged), or outdated view. */
function outcomeOf(res: unknown): string {
  if (!res || typeof res !== 'object' || !('ok' in res)) return 'done';
  const r = res as { ok: boolean; stale?: boolean };
  return r.ok ? 'ok' : r.stale ? 'stale' : 'refused';
}

/** Whether an error, or its cause, carries the values bound to a failed query (Drizzle's message, a driver's params). */
function carriesQueryValues(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as ErrorLike;
  if (Object.hasOwn(err, 'params') || (typeof e.message === 'string' && e.message.startsWith('Failed query: '))) return true;
  return depth < 2 && carriesQueryValues(e.cause, depth + 1);
}

function rebuild(f: Fields): Error {
  const copy = new Error(typeof f.message === 'string' ? f.message : '') as Error & { code?: unknown };
  if (typeof f.name === 'string') copy.name = f.name;
  if (f.code !== undefined) copy.code = f.code;
  copy.stack = typeof f.stack === 'string' ? f.stack : `${copy.name}: ${copy.message}`;
  if (f.cause && typeof f.cause === 'object') copy.cause = rebuild(f.cause as Fields);
  return copy;
}

/**
 * The error to hand on to Next.js. Next.js prints the errors it catches whole, own properties and causes included, in
 * the same output as this log: one that carries the values of a failed query becomes a plain Error made of what
 * serializeError keeps (message without the values, code, frames, cause likewise). Any other error is returned as is.
 */
export function withoutQueryValues(err: unknown): unknown {
  return carriesQueryValues(err) ? rebuild(serializeError(err)) : err;
}

/**
 * Runs a Server Action and logs it: its name, outcome (ok, refused, stale), duration and a new request identifier, which
 * every entry written meanwhile carries. An error it throws is logged with its stack, then thrown again for Next.js,
 * without the values of a failed query (withoutQueryValues).
 */
export async function traceAction<R>(name: string, fn: () => Promise<R>): Promise<R> {
  const start = performance.now();
  return withRequestContext({ requestId: randomUUID(), route: `action:${name}` }, async () => {
    try {
      const res = await fn();
      write('info', 'action', 'action', { action: name, outcome: outcomeOf(res), durationMs: ms(start) });
      return res;
    } catch (err) {
      if (isNavigation(err)) {
        write('info', 'action', 'action', { action: name, outcome: 'navigation', durationMs: ms(start) });
        throw err;
      }
      const thrown = withoutQueryValues(err);
      markLogged(err);
      markLogged(thrown);
      write('error', 'action', 'action failed', { action: name, durationMs: ms(start), err });
      throw thrown;
    }
  });
}

const DIGEST_WINDOW_MS = 2_000;
const recentDigests: Map<string, number> = ((globalThis as unknown as { __codexRecentDigests?: Map<string, number> }).__codexRecentDigests ??= new Map());

/** What Next.js passes to onRequestError (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md). */
export type ErrorRequest = { path: string; method: string; headers: Record<string, string | string[] | undefined> };
export type ErrorContext = { routerKind?: string; routePath?: string; routeType?: string; renderSource?: string; revalidateReason?: string };

/**
 * A server error Next.js caught (a page's rendering, a Server Action, a route handler, the proxy), unless this log
 * already wrote it. The path without its query string (it may hold a search); no header but the request's identifier.
 */
export function logRequestError(err: unknown, request: ErrorRequest, ctx: ErrorContext, now = Date.now()): void {
  if (isNavigation(err)) return;
  if (err && typeof err === 'object' && loggedErrors.has(err)) return;
  // Next.js may report one failed rendering twice (React Server Components, then the HTML): same digest, same path.
  const digest = (err as { digest?: unknown } | null)?.digest;
  if (typeof digest === 'string') {
    const key = `${digest} ${request.method} ${request.path}`;
    for (const [k, at] of recentDigests) if (now - at > DIGEST_WINDOW_MS) recentDigests.delete(k);
    if (recentDigests.has(key)) return;
    if (recentDigests.size < 1000) recentDigests.set(key, now);
  }
  const sent = request.headers['x-request-id'];
  const id = typeof sent === 'string' && REQUEST_ID.test(sent) ? sent : undefined;
  write('error', 'next', 'request failed', {
    requestId: currentRequest() ? undefined : id,
    method: request.method,
    path: request.path.split('?')[0],
    route: ctx.routePath,
    routeType: ctx.routeType,
    renderSource: ctx.renderSource,
    err,
  });
}
