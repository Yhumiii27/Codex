import { randomUUID } from 'node:crypto';
import { vi, type MockInstance } from 'vitest';

// A fake Microsoft Graph (and Entra ID token endpoint) behind globalThis.fetch, with a document library held in memory:
// what the SharePoint store of src/lib/storage.ts calls, answered as Graph documents it, so that the store can be tried
// without a tenant (O-01 stays open: nothing here enables SharePoint). Only the calls the store makes are understood;
// any other is answered 400 and kept in `unexpected`, which a test checks is empty.
//
//   POST login.microsoftonline.com/{tenant}/oauth2/v2.0/token     client credentials → a new token (`tokens` counts them)
//   PUT  /drives/{d}/root:/{path}:/content?…conflictBehavior=…    upload by path, missing folders created; `fail` → 409
//   POST /drives/{d}/root/children                                 a folder at the root; 409 when the name is taken
//   PATCH /drives/{d}/items/{id}?…                                 rename and move (parentReference.path /drive/root:/X)
//   GET  /drives/{d}/items/{id}/content                            302 to a pre-authenticated download URL (another
//                                                                  origin), followed as fetch follows a redirect: the
//                                                                  Range header kept, Authorization dropped (cross-origin)
//   GET  https://download.fake-sharepoint.test/…                   the bytes: 200, or 206 for a Range; 401 if a bearer
//                                                                  token is sent (a download URL carries its own)
//   DELETE /drives/{d}/items/{id}                                  204, 404 when gone
//   GET  /drives/{d}/root:/{folder}:/children?…$top=n              paged (`pageSize`), @odata.nextLink; 404 when missing
//   GET  /drives/{d}?$select=id                                    the probe
//
// Faults: fail(match, status, { retryAfter, times }) answers `status` (429, 503, 401…) to the next matching Graph calls;
// revokeTokens() makes every token issued so far refused (401), as after a secret rotation or a revoked consent.

export type FakeItem = { id: string; name: string; parent: string; folder: boolean; bytes: Buffer; modified: string };
export type FakeCall = { method: string; url: string; auth: string | null; range: string | null; status: number };

const DOWNLOAD = 'https://download.fake-sharepoint.test';

type Fault = { match: (c: { method: string; url: string }) => boolean; status: number; retryAfter?: string; left: number };

export type FakeGraph = ReturnType<typeof fakeGraph>;

export function fakeGraph(opts: { tenant?: string; driveId?: string; pageSize?: number; expiresIn?: number } = {}) {
  const tenant = opts.tenant ?? 'contoso.onmicrosoft.com';
  const driveId = opts.driveId ?? 'b!fake-drive';
  const pageSize = opts.pageSize ?? 200;
  const items = new Map<string, FakeItem>();
  const calls: FakeCall[] = [];
  const unexpected: string[] = [];
  const faults: Fault[] = [];
  const valid = new Set<string>();
  /** Bodies of the throttled answers (429/503) given, and whether the caller released each. */
  const throttled: { released: boolean }[] = [];
  let tokens = 0;

  const now = () => new Date().toISOString();
  const pathOf = (it: FakeItem) => (it.parent ? `${it.parent}/${it.name}` : it.name);
  const find = (parent: string, name: string) => [...items.values()].find((i) => i.parent === parent && i.name.toLowerCase() === name.toLowerCase());
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers });
  const error = (status: number, code: string, headers: Record<string, string> = {}) => {
    if (status === 429 || status === 503) {
      // A body that tells whether the caller read or cancelled it (an unread body holds its connection).
      const mark = { released: false };
      throttled.push(mark);
      const text = new TextEncoder().encode(JSON.stringify({ error: { code, message: code } }));
      const body = new ReadableStream<Uint8Array>({
        pull(c) {
          c.enqueue(text);
          c.close();
          mark.released = true;
        },
        cancel() {
          mark.released = true;
        },
      }, { highWaterMark: 0 }); // nothing pulled until the caller reads
      return new Response(body, { status, headers: { 'Content-Type': 'application/json', ...headers } });
    }
    return json({ error: { code, message: code } }, status, headers);
  };
  const driveItem = (it: FakeItem) => ({
    id: it.id, name: it.name, size: it.folder ? 0 : it.bytes.length, lastModifiedDateTime: it.modified,
    parentReference: { driveId, path: `/drive/root:${it.parent ? `/${it.parent}` : ''}` },
    ...(it.folder ? { folder: { childCount: [...items.values()].filter((c) => c.parent === pathOf(it)).length } } : { file: { mimeType: 'application/octet-stream' } }),
  });

  /** Creates the folders of `folderPath` that are missing (an upload by path does). */
  function ensureFolders(folderPath: string) {
    let parent = '';
    for (const part of folderPath.split('/').filter(Boolean)) {
      if (!find(parent, part)) {
        const it: FakeItem = { id: `01FOLDER${randomUUID().slice(0, 8).toUpperCase()}`, name: part, parent, folder: true, bytes: Buffer.alloc(0), modified: now() };
        items.set(it.id, it);
      }
      parent = parent ? `${parent}/${part}` : part;
    }
  }

  async function bodyBytes(body: RequestInit['body']): Promise<Buffer> {
    if (body == null) return Buffer.alloc(0);
    if (typeof body === 'string') return Buffer.from(body);
    return Buffer.from(await new Response(body).arrayBuffer());
  }

  function download(id: string, headers: Headers): Response {
    const it = items.get(id);
    if (!it || it.folder) return error(404, 'itemNotFound');
    // A pre-authenticated URL: SharePoint refuses a bearer token it did not issue.
    if (headers.get('authorization')) return error(401, 'invalidAuthenticationToken');
    const m = /^bytes=(\d+)-(\d*)$/.exec(headers.get('range') ?? '');
    const size = it.bytes.length;
    if (m) {
      const start = Number(m[1]);
      const end = Math.min(m[2] ? Number(m[2]) : size - 1, size - 1);
      if (start >= size || end < start) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      return new Response(new Uint8Array(it.bytes.subarray(start, end + 1)), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
    }
    return new Response(new Uint8Array(it.bytes), { status: 200, headers: { 'Content-Length': String(size) } });
  }

  async function graph(method: string, url: URL, headers: Headers, init: RequestInit): Promise<Response> {
    const auth = headers.get('authorization');
    if (!auth?.startsWith('Bearer ') || !valid.has(auth.slice(7))) return error(401, 'InvalidAuthenticationToken');
    const fault = faults.find((f) => f.left > 0 && f.match({ method, url: url.href }));
    if (fault) {
      fault.left--;
      return error(fault.status, fault.status === 429 ? 'TooManyRequests' : fault.status === 503 ? 'serviceNotAvailable' : 'fault', fault.retryAfter != null ? { 'Retry-After': fault.retryAfter } : {});
    }
    const base = `/v1.0/drives/${driveId}`;
    const p = decodeURIComponent(url.pathname);
    if (!p.startsWith('/v1.0/drives/')) return error(400, 'invalidRequest');
    if (!p.startsWith(base)) return error(404, 'itemNotFound'); // another drive: not one the app may reach
    const rest = p.slice(base.length);
    const conflict = url.searchParams.get('@microsoft.graph.conflictBehavior');

    // The probe.
    if (method === 'GET' && rest === '') return json({ id: driveId });

    // Upload by path.
    let m = /^\/root:\/(.+):\/content$/.exec(rest);
    if (method === 'PUT' && m) {
      const full = m[1];
      const slash = full.lastIndexOf('/');
      const parent = slash < 0 ? '' : full.slice(0, slash), name = full.slice(slash + 1);
      const bytes = await bodyBytes(init.body);
      const existing = find(parent, name);
      if (existing && (conflict ?? 'replace') === 'fail') return error(409, 'nameAlreadyExists');
      ensureFolders(parent);
      const it: FakeItem = existing && !existing.folder
        ? { ...existing, bytes, modified: now() }
        : { id: `01ITEM${randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase()}`, name, parent, folder: false, bytes, modified: now() };
      items.set(it.id, it);
      return json(driveItem(it), existing ? 200 : 201);
    }

    // A folder at the root.
    if (method === 'POST' && rest === '/root/children') {
      const body = JSON.parse((await bodyBytes(init.body)).toString('utf8')) as { name: string; folder?: object; '@microsoft.graph.conflictBehavior'?: string };
      if (!body.folder) return error(400, 'invalidRequest');
      const existing = find('', body.name);
      if (existing) {
        if ((body['@microsoft.graph.conflictBehavior'] ?? 'fail') === 'fail') return error(409, 'nameAlreadyExists');
        return json(driveItem(existing));
      }
      ensureFolders(body.name);
      return json(driveItem(find('', body.name)!), 201);
    }

    // Children of a folder, paged.
    m = /^\/root:\/(.+):\/children$/.exec(rest);
    if (method === 'GET' && m) {
      const folder = m[1];
      const f = folder.includes('/') ? find(folder.slice(0, folder.lastIndexOf('/')), folder.slice(folder.lastIndexOf('/') + 1)) : find('', folder);
      if (!f?.folder) return error(404, 'itemNotFound');
      const all = [...items.values()].filter((i) => i.parent === folder).sort((a, b) => a.id.localeCompare(b.id));
      const top = Math.min(Number(url.searchParams.get('$top') ?? 200), pageSize);
      const skip = Number(url.searchParams.get('$skiptoken') ?? 0);
      const page = all.slice(skip, skip + top);
      const next = skip + top < all.length ? new URL(url.href) : null;
      next?.searchParams.set('$skiptoken', String(skip + top));
      return json({ value: page.map(driveItem), ...(next ? { '@odata.nextLink': next.href } : {}) });
    }

    m = /^\/items\/([^/]+)(\/content)?$/.exec(rest);
    if (m) {
      const it = items.get(m[1]);
      if (method === 'GET' && m[2]) {
        if (!it || it.folder) return error(404, 'itemNotFound');
        return new Response(null, { status: 302, headers: { Location: `${DOWNLOAD}/${driveId}/${it.id}?tempauth=${randomUUID()}` } });
      }
      if (method === 'DELETE' && !m[2]) {
        if (!it) return error(404, 'itemNotFound');
        for (const [id, x] of items) if (id === it.id || x.parent === pathOf(it) || x.parent.startsWith(`${pathOf(it)}/`)) items.delete(id);
        return new Response(null, { status: 204 });
      }
      if (method === 'PATCH' && !m[2]) {
        if (!it) return error(404, 'itemNotFound');
        const body = JSON.parse((await bodyBytes(init.body)).toString('utf8')) as { name?: string; parentReference?: { path?: string } };
        let parent = it.parent;
        if (body.parentReference) {
          const pm = /^\/drive\/root:(?:\/(.*))?$/.exec(body.parentReference.path ?? '');
          if (!pm) return error(400, 'invalidRequest');
          parent = pm[1] ?? '';
          if (parent) {
            const slash = parent.lastIndexOf('/');
            const folder = find(slash < 0 ? '' : parent.slice(0, slash), parent.slice(slash + 1));
            if (!folder?.folder) return error(404, 'itemNotFound');
          }
        }
        const name = body.name ?? it.name;
        const taken = find(parent, name);
        if (taken && taken.id !== it.id) {
          if ((conflict ?? 'fail') === 'fail') return error(409, 'nameAlreadyExists');
          items.delete(taken.id);
        }
        const moved = { ...it, name, parent, modified: now() };
        items.set(it.id, moved);
        return json(driveItem(moved));
      }
    }
    return error(400, 'invalidRequest');
  }

  async function token(url: URL, init: RequestInit): Promise<Response> {
    const form = new URLSearchParams((await bodyBytes(init.body)).toString('utf8'));
    if (url.pathname !== `/${tenant}/oauth2/v2.0/token`) return json({ error: 'invalid_tenant' }, 400);
    if (form.get('grant_type') !== 'client_credentials' || form.get('scope') !== 'https://graph.microsoft.com/.default') return json({ error: 'invalid_request' }, 400);
    if (form.get('client_secret') !== 'fake-secret') return json({ error: 'invalid_client' }, 401);
    tokens++;
    const value = `fake-token-${tokens}`;
    valid.add(value);
    return json({ token_type: 'Bearer', access_token: value, expires_in: opts.expiresIn ?? 3599 });
  }

  async function handle(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    const log = (status: number, u = url, h = headers) => calls.push({ method, url: u.href, auth: h.get('authorization'), range: h.get('range'), status });
    if (init.signal?.aborted) throw init.signal.reason ?? new DOMException('aborted', 'AbortError');
    let res: Response;
    if (url.host === 'login.microsoftonline.com') res = await token(url, init);
    else if (url.origin === 'https://graph.microsoft.com') res = await graph(method, url, headers, init);
    else if (url.origin === DOWNLOAD) res = download(url.pathname.split('/').at(-1)!, headers);
    else {
      unexpected.push(`${method} ${url.href}`);
      return new Response(null, { status: 400 });
    }
    if (res.status === 400) unexpected.push(`${method} ${url.href}`);
    log(res.status);
    // A redirect followed as fetch follows it (redirect: 'follow', the default): the request again at the new URL,
    // its headers kept but Authorization, dropped on a cross-origin redirect (Fetch standard, as Node's fetch does).
    if (res.status === 302 && (init.redirect ?? 'follow') === 'follow') {
      const next = new URL(res.headers.get('location')!, url);
      const h = new Headers(headers);
      if (next.origin !== url.origin) h.delete('authorization');
      return handle(next, { ...init, headers: h });
    }
    return res;
  }

  const spy: MockInstance<typeof fetch> = vi.spyOn(globalThis, 'fetch').mockImplementation(handle as typeof fetch);

  return {
    tenant, driveId, items, calls, unexpected, throttled, spy,
    /** Environment that points the store at this fake (vi.stubEnv each). */
    env: { CODEX_SP_TENANT_ID: tenant, CODEX_SP_CLIENT_ID: '00000000-0000-4000-8000-000000000001', CODEX_SP_CLIENT_SECRET: 'fake-secret', CODEX_SP_DRIVE_ID: driveId } as Record<string, string>,
    /** Tokens issued by the fake Entra ID. */
    get tokens() {
      return tokens;
    },
    /** The next `times` Graph calls matching `match` (a method and URL pattern) get `status`, with Retry-After if given. */
    fail(match: RegExp | ((c: { method: string; url: string }) => boolean), status: number, o: { retryAfter?: string; times?: number } = {}) {
      faults.push({ match: typeof match === 'function' ? match : (c) => match.test(`${c.method} ${c.url}`), status, retryAfter: o.retryAfter, left: o.times ?? 1 });
    },
    /** Refuses every token issued so far: the store must ask for a new one. */
    revokeTokens() {
      valid.clear();
    },
    /** The item at a path (`_staging/x`, `PRO-QUA-0001/PRO-QUA-0001_A.1.pdf`), files only. */
    at(p: string) {
      const slash = p.lastIndexOf('/');
      const it = find(slash < 0 ? '' : p.slice(0, slash), p.slice(slash + 1));
      return it && !it.folder ? it : undefined;
    },
    /** Paths of every file, sorted. */
    files() {
      return [...items.values()].filter((i) => !i.folder).map(pathOf).sort();
    },
    pathOf,
    /** Puts a file straight into the library (as if left there earlier). */
    seed(p: string, bytes: Buffer | string, modified = now()) {
      const slash = p.lastIndexOf('/');
      const parent = slash < 0 ? '' : p.slice(0, slash);
      ensureFolders(parent);
      const it: FakeItem = { id: `01ITEM${randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase()}`, name: p.slice(slash + 1), parent, folder: false, bytes: Buffer.from(bytes), modified };
      items.set(it.id, it);
      return it;
    },
    /** Graph calls (download URLs included) made with `method` whose URL matches. */
    callsTo(method: string, pattern: RegExp) {
      return calls.filter((c) => c.method === method && pattern.test(c.url));
    },
  };
}
