import { inspect } from 'node:util';
import { DrizzleQueryError } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatEntry, logRequestError, logSettings, logger, makeEntry, requestIdOf, traceAction, withoutQueryValues, withRequestContext, withRequestLog, type Entry,
} from '@/lib/log';

// The technical log (lib/log.ts, point 49 of docs/reste-a-faire.md): one line per entry, JSON in production, readable
// otherwise, the request's identifier on every entry, and nothing secret: no token, cookie, body or document content.

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** Every line written to the console during `fn`, by level. */
async function captured(fn: () => unknown | Promise<unknown>) {
  const lines: { level: string; line: string }[] = [];
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((line: unknown) => {
      lines.push({ level, line: String(line) });
    });
  }
  await fn();
  return lines;
}

const json = (lines: { line: string }[]) => lines.map((l) => JSON.parse(l.line) as Entry);

describe('settings', () => {
  it('writes JSON in production and readable lines otherwise, at level info, unless told otherwise', () => {
    expect(logSettings({ NODE_ENV: 'production' })).toEqual({ level: 'info', format: 'json' });
    expect(logSettings({ NODE_ENV: 'development' })).toEqual({ level: 'info', format: 'pretty' });
    expect(logSettings({ NODE_ENV: 'production', CODEX_LOG_FORMAT: 'pretty', CODEX_LOG_LEVEL: ' DEBUG ' })).toEqual({ level: 'debug', format: 'pretty' });
    // A wrong value is ignored.
    expect(logSettings({ NODE_ENV: 'production', CODEX_LOG_FORMAT: 'xml', CODEX_LOG_LEVEL: 'verbose' })).toEqual({ level: 'info', format: 'json' });
  });

  it('writes nothing below the level, and nothing at all when silent', async () => {
    vi.stubEnv('CODEX_LOG_LEVEL', 'warn');
    const log = logger('t');
    let lines = await captured(() => {
      log.debug('a');
      log.info('b');
      log.warn('c');
      log.error('d');
    });
    expect(lines.map((l) => l.level)).toEqual(['warn', 'error']);
    vi.stubEnv('CODEX_LOG_LEVEL', 'silent');
    lines = await captured(() => log.error('e'));
    expect(lines).toEqual([]);
  });
});

describe('entries', () => {
  it('keeps secrets, bytes and document contents out', () => {
    const e = makeEntry('info', 't', 'm', {
      token: 'tok-123', authorization: 'Bearer abc', cookie: 'codex-user=x', password: 'p', clientSecret: 's', body: 'the body', content: 'the text',
      buf: Buffer.from('bytes'), nested: { accessToken: 'zzz', ok: 1 }, long: 'x'.repeat(2000),
    });
    const text = JSON.stringify(e);
    for (const secret of ['tok-123', 'Bearer abc', 'codex-user=x', '"p"', '"s"', 'the body', 'the text', 'zzz']) expect(text).not.toContain(secret);
    expect(e).toMatchObject({ token: '[redacted]', authorization: '[redacted]', buf: '[redacted]', nested: { accessToken: '[redacted]', ok: 1 } });
    expect(makeEntry('info', 't', 'm', { file: new Uint8Array(12) }).file).toBe('[12 bytes]');
    expect(String(e.long).length).toBeLessThan(600);
  });

  it('keeps of an error its name, message, code and stack, never the rest (a database error\'s detail quotes values)', () => {
    const err = Object.assign(new Error('duplicate key'), { code: '23505', detail: 'Key (id)=(PRO-QUA-0001) already exists', cause: new Error('below') });
    const e = makeEntry('error', 't', 'm', { err }) as Entry & { err: Record<string, unknown> };
    expect(e.err).toMatchObject({ name: 'Error', message: 'duplicate key', code: '23505', cause: { message: 'below' } });
    expect(String(e.err.stack)).toContain('duplicate key');
    expect(JSON.stringify(e)).not.toContain('PRO-QUA-0001');
    // Not every thrown value is an Error: only the same fields are read.
    const odd = makeEntry('error', 't', 'm', { err: { name: 'ErrnoError', errno: 54, path: '/secret/place' } }) as Entry & { err: Record<string, unknown> };
    expect(odd.err).toEqual({ name: 'ErrnoError', message: '', errno: 54 });
  });

  it('keeps of a failed query its parameterised SQL and the database\'s code, never the values bound to it', () => {
    // As drizzle-orm builds it: "Failed query: <sql>\nparams: <values>", the driver's error (with its params) as cause.
    const driver = Object.assign(new Error('invalid byte sequence for encoding "UTF8": 0x00'), {
      name: 'error', severity: 'ERROR', code: '22021', detail: 'secret detail', query: 'insert into …', params: ['W-1', 'secret comment\u0000'],
    });
    const err = new DrizzleQueryError('insert into "workflow_comments" ("workflow_id", "text") values ($1, $2)', ['W-1', 'secret comment\nparams: x\u0000'], driver);
    expect(err.message).toContain('secret comment');
    for (const format of ['json', 'pretty'] as const) {
      const e = makeEntry('error', 'action', 'action failed', { err }) as Entry & { err: Record<string, unknown> };
      const line = formatEntry(e, format);
      expect(line, format).not.toMatch(/secret|params/);
      expect(e.err).toMatchObject({
        message: 'Failed query: insert into "workflow_comments" ("workflow_id", "text") values ($1, $2)',
        cause: { name: 'error', code: '22021', message: 'invalid byte sequence for encoding "UTF8": 0x00' },
      });
      // The stack is rebuilt from the cleaned message and its frames only.
      expect(String(e.err.stack).split('\n')[0]).toBe(`Error: ${e.err.message}`);
      expect(String(e.err.stack).split('\n').slice(1).every((l) => /^\s+at /.test(l))).toBe(true);
    }
    // Without Drizzle's own SQL (another wrapper), everything from "params:" on is dropped all the same.
    const bare = makeEntry('error', 't', 'm', { err: new Error('Failed query: select 1\nparams: secret') });
    expect(JSON.stringify(bare)).not.toContain('secret');
  });

  it('masks the value a database error quotes, and cuts each line of a stack', () => {
    const pg = (message: string) => Object.assign(new Error(message), { severity: 'ERROR', code: '22P02' });
    const read = (err: Error) => (makeEntry('error', 't', 'm', { err }) as Entry & { err: { message: string } }).err.message;
    expect(read(pg('invalid input syntax for type integer: "my secret"'))).toBe('invalid input syntax for type integer: "…"');
    expect(read(pg('value "123456789012 secret" is out of range for type integer'))).toBe('value "…" is out of range for type integer');
    expect(read(pg('duplicate key value violates unique constraint "documents_pkey"'))).toBe('duplicate key value violates unique constraint "documents_pkey"');
    // Not a database error: its message is its own.
    expect(read(new Error('bad value: "x"'))).toBe('bad value: "x"');
    const long = new Error('x');
    long.stack = `Error: x\n    at ${'f'.repeat(2000)} (file.js:1:1)\nsecret line without a frame`;
    const stack = String((makeEntry('error', 't', 'm', { err: long }) as Entry & { err: { stack: string } }).err.stack);
    expect(stack.split('\n')).toHaveLength(2);
    expect(stack.length).toBeLessThan(400);
    expect(stack).not.toContain('secret');
  });

  it('hands Next.js a failed query without its values, any other error as it is', () => {
    const driver = Object.assign(new Error('invalid input syntax for type integer: "secret"'), { severity: 'ERROR', code: '22P02', params: ['secret'] });
    const err = new DrizzleQueryError('select 1 where $1', ['secret'], driver);
    const handed = withoutQueryValues(err) as Error & { code?: string };
    expect(handed).toBeInstanceOf(Error);
    expect(handed).not.toBe(err);
    // What Next.js prints: util.inspect, own properties and causes included.
    expect(inspect(handed, { depth: 5 })).not.toContain('secret');
    expect(handed.message).toBe('Failed query: select 1 where $1');
    expect((handed.cause as Error & { code?: string }).code).toBe('22P02');
    const plain = new Error('boom');
    expect(withoutQueryValues(plain)).toBe(plain);
  });

  it('writes one JSON object per line, or one readable line whose values cannot forge another', () => {
    const e = makeEntry('warn', 'auth', 'token refused', { route: '/api/import', reason: 'line\nINFO [fake] entry' }, new Date('2026-10-15T09:08:07.006Z'));
    expect(JSON.parse(formatEntry(e, 'json'))).toEqual({ time: '2026-10-15T09:08:07.006Z', level: 'warn', scope: 'auth', msg: 'token refused', route: '/api/import', reason: 'line\nINFO [fake] entry' });
    const pretty = formatEntry(e, 'pretty');
    expect(pretty.split('\n')).toHaveLength(1);
    expect(pretty).toBe('09:08:07.006 WARN  [auth] token refused route=/api/import reason="line\\nINFO [fake] entry"');
  });

  it('gives the error\'s stack on the lines below in readable form', () => {
    const line = formatEntry(makeEntry('error', 'storage', 'failed', { err: new Error('boom') }), 'pretty');
    expect(line.split('\n')[0]).toContain('err={"name":"Error","message":"boom"}');
    expect(line.split('\n')[1]).toMatch(/^ {4}Error: boom$/);
    // A cause's stack follows, marked, and stays off the first line.
    const caused = formatEntry(makeEntry('error', 'storage', 'failed', { err: new Error('outer', { cause: new Error('inner') }) }), 'pretty').split('\n');
    expect(caused[0]).toContain('err={"name":"Error","message":"outer","cause":{"name":"Error","message":"inner"}}');
    expect(caused.filter((l) => /^ {4}cause: Error: inner$/.test(l))).toHaveLength(1);
  });
});

describe('request identifiers', () => {
  it('takes a plain X-Request-Id from a reverse proxy, else draws one', () => {
    expect(requestIdOf(new Headers({ 'x-request-id': 'abc-123_x.y:z' }))).toBe('abc-123_x.y:z');
    for (const bad of ['', 'a b', 'a\nb', 'x'.repeat(129), '<script>']) {
      expect(requestIdOf(new Headers(bad ? { 'x-request-id': bad.replace('\n', ' ') } : {}))).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('puts the identifier of the request on every entry written while it runs', async () => {
    vi.stubEnv('CODEX_LOG_FORMAT', 'json');
    const lines = await captured(() => withRequestContext({ requestId: 'r-1' }, async () => {
      await Promise.resolve();
      logger('storage').error('x');
    }));
    expect(json(lines)[0]).toMatchObject({ requestId: 'r-1', scope: 'storage' });
  });
});

describe('route handlers', () => {
  it('logs method, route pattern, status and duration, and sends the identifier back', async () => {
    vi.stubEnv('CODEX_LOG_FORMAT', 'json');
    const handler = withRequestLog('/api/documents/[id]/file', async (req: Request, ctx: { id: string }) => {
      logger('inner').info('working', { id: ctx.id });
      return new Response('ok', { status: 206, headers: { 'Content-Length': '2' } });
    });
    let res!: Response;
    const lines = await captured(async () => {
      res = await handler(new Request('http://x/api/documents/PRO-QUA-0001/file?download=1', { headers: { 'x-request-id': 'proxy-7', cookie: 'codex-user=jwagner' } }), { id: 'A' });
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('x-request-id')).toBe('proxy-7');
    const [inner, request] = json(lines);
    expect(inner).toMatchObject({ requestId: 'proxy-7', scope: 'inner' });
    expect(request).toMatchObject({ level: 'info', scope: 'http', msg: 'request', requestId: 'proxy-7', method: 'GET', route: '/api/documents/[id]/file', status: 206, bytes: 2 });
    expect(typeof request.durationMs).toBe('number');
    // Neither the document's ID, nor the query string, nor the cookie.
    expect(lines.map((l) => l.line).join()).not.toMatch(/PRO-QUA-0001|download=1|jwagner/);
  });

  it('answers 500 with the identifier only when the handler throws, and logs the error with its stack', async () => {
    vi.stubEnv('CODEX_LOG_FORMAT', 'json');
    const handler = withRequestLog('/api/registry', async () => {
      throw new Error('database gone: password=hunter2');
    });
    let res!: Response;
    const lines = await captured(async () => {
      res = await handler(new Request('http://x/api/registry'));
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'internal', requestId: res.headers.get('x-request-id') });
    const [entry] = json(lines);
    expect(entry).toMatchObject({ level: 'error', msg: 'request failed', status: 500, requestId: body.requestId, err: { message: 'database gone: password=hunter2' } });
    // The error is not logged a second time by onRequestError.
    expect(await captured(() => logRequestError(new Error('other'), { path: '/x', method: 'GET', headers: {} }, {}))).toHaveLength(1);
  });

  it('logs a 5xx answer as an error, a success of a quiet route at debug level only', async () => {
    vi.stubEnv('CODEX_LOG_FORMAT', 'json');
    const health = withRequestLog('/api/health', async () => new Response(null, { status: 200 }), { quiet: true });
    const down = withRequestLog('/api/health', async () => new Response(null, { status: 503 }), { quiet: true });
    const lines = await captured(async () => {
      await health(new Request('http://x/api/health'));
      await down(new Request('http://x/api/health'));
    });
    expect(lines.map((l) => l.level)).toEqual(['error']);
  });

  it('tags a response whose headers cannot change', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const res = await withRequestLog('/r', async () => Response.redirect('http://x/elsewhere', 303))(new Request('http://x/r'));
    expect([res.status, res.headers.get('location'), !!res.headers.get('x-request-id')]).toEqual([303, 'http://x/elsewhere', true]);
  });
});

describe('Server Actions', () => {
  it('logs the outcome and duration of each action, never the message shown to the user', async () => {
    vi.stubEnv('CODEX_LOG_FORMAT', 'json');
    const lines = await captured(async () => {
      await traceAction('createDocument', async () => ({ ok: true }));
      await traceAction('updateMeta', async () => ({ ok: false, error: 'Modifié entre-temps par Claire Bardet', stale: true }));
      await traceAction('setReaders', async () => ({ ok: false, error: 'Action non autorisée' }));
    });
    expect(json(lines).map((e) => [e.action, e.outcome])).toEqual([['createDocument', 'ok'], ['updateMeta', 'stale'], ['setReaders', 'refused']]);
    expect(lines.map((l) => l.line).join()).not.toMatch(/Claire|autorisée/);
    const ids = json(lines).map((e) => e.requestId);
    expect(new Set(ids).size).toBe(3);
  });

  it('logs an error once with its stack and throws it again; a redirect is no error', async () => {
    vi.stubEnv('CODEX_LOG_FORMAT', 'json');
    const err = new Error('disk full');
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/x;307;' });
    const lines = await captured(async () => {
      await expect(traceAction('backUpData', async () => { throw err; })).rejects.toBe(err);
      await expect(traceAction('graftChange', async () => { throw redirect; })).rejects.toBe(redirect);
      // Next.js then reports the same error to onRequestError: not written twice.
      logRequestError(err, { path: '/documents/X', method: 'POST', headers: {} }, { routeType: 'action' });
    });
    expect(json(lines).map((e) => [e.level, e.msg, e.action, e.outcome])).toEqual([
      ['error', 'action failed', 'backUpData', undefined],
      ['info', 'action', 'graftChange', 'navigation'],
    ]);
  });
});

describe('errors Next.js reports', () => {
  it('logs the path without its query, the route, and no header but the request identifier', async () => {
    vi.stubEnv('CODEX_LOG_FORMAT', 'json');
    const err = Object.assign(new Error('render failed'), { digest: '12345' });
    const lines = await captured(() => logRequestError(
      err,
      { path: '/recherche?q=projet+secret', method: 'GET', headers: { cookie: 'codex-user=cbardet', 'x-request-id': 'edge-1', authorization: 'Bearer t' } },
      { routePath: '/recherche', routeType: 'render', renderSource: 'react-server-components' },
    ));
    const [e] = json(lines);
    expect(e).toMatchObject({ level: 'error', scope: 'next', path: '/recherche', route: '/recherche', routeType: 'render', requestId: 'edge-1', err: { digest: '12345' } });
    expect(lines[0].line).not.toMatch(/secret|cbardet|Bearer/);
  });

  it('writes a rendering reported twice once, and the same failure again a moment later', async () => {
    vi.stubEnv('CODEX_LOG_FORMAT', 'json');
    const req = { path: '/validations', method: 'GET', headers: {} };
    const lines = await captured(() => {
      logRequestError(Object.assign(new Error('a'), { digest: 'd-1' }), req, {}, 1_000_000);
      logRequestError(Object.assign(new Error('a'), { digest: 'd-1' }), req, {}, 1_000_500);
      logRequestError(Object.assign(new Error('a'), { digest: 'd-1' }), req, {}, 1_005_000);
      logRequestError(Object.assign(new Error('NEXT_NOT_FOUND'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' }), req, {}, 1_006_000);
    });
    expect(lines).toHaveLength(2);
  });
});
