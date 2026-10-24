import 'server-only';
import { fileRules } from './filetypes';
import { json, type ImportFile } from './importer';
import { checkSignature, credentialsOf } from './server-auth';
import type { Endpoint } from './integration-credentials';
import type { FileRejection } from './storage';

// The body of a call that creates one document with its file (docs/api.md): POST /api/import (migration tool) and
// POST /api/documents (another application of the group) read it alike.
//   multipart/form-data: part "meta" (JSON, text or file) + optional part "file"
//   application/json:    the metadata alone, without a file
//   ?dryRun=1            a simulation: the same checks and answers, nothing stored nor written (200 instead of 201)

/** The largest file, the same for every entry (CODEX_MAX_FILE_MB, lib/filetypes.ts). */
export const maxBytes = () => fileRules(process.env).maxBytes;

export const tooLarge = () => json({ error: 'too_large', maxBytes: maxBytes() }, 413);

/**
 * A file refused on its way in: 413 for its size, or for being beyond the virus scan's limits (sending it again changes
 * nothing), 415 for its format (with the extensions admitted), 422 when the virus scan finds it infected, 503 when the
 * scan could not be run (to be sent again later).
 */
export function refused(r: FileRejection): Response {
  switch (r.code) {
    case 'too_large': return tooLarge();
    case 'scan_too_large': return json({ error: 'scan_too_large' }, 413);
    case 'infected': return json({ error: 'file_infected', threat: r.threat }, 422);
    case 'scan_failed': return json({ error: 'scan_unavailable' }, 503, { 'Retry-After': '60' });
    default: return json({ error: 'file_format', reason: r.code, ...('ext' in r ? { ext: r.ext } : {}), allowed: fileRules(process.env).extensions }, 415);
  }
}

/**
 * The request's body, cut off once it passes `cap` bytes: a body sent in chunks has no Content-Length to check
 * beforehand, and would otherwise be read whole into memory before the size of its file could be checked.
 */
function capped(req: Request, cap: number): { body: Response; over: () => boolean } {
  let size = 0;
  let over = false;
  const stream = req.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, c) {
      size += chunk.byteLength;
      if (size > cap) {
        over = true;
        c.error(new Error('too_large'));
      } else c.enqueue(chunk);
    },
  }));
  return { body: new Response(stream ?? null, { headers: { 'Content-Type': req.headers.get('content-type') ?? '' } }), over: () => over };
}

/**
 * The query string: `dryRun` alone, `1`/`true` for a simulation, `0`/`false` (or absent) for the real call. Anything
 * else is refused before the body is read: a misspelt `dryrun=1` must not write for real what was meant to be simulated.
 */
function dryRunOf(req: Request): boolean | Response {
  const params = [...new URL(req.url).searchParams];
  const other = params.find(([k]) => k !== 'dryRun');
  if (other) return json({ error: 'invalid_query', param: other[0] }, 400);
  if (params.length > 1) return json({ error: 'invalid_query', param: 'dryRun' }, 400);
  const v = params[0]?.[1];
  if (v == null || v === '0' || v === 'false') return false;
  if (v === '1' || v === 'true') return true;
  return json({ error: 'invalid_query', param: 'dryRun' }, 400);
}

/**
 * The metadata and the file of the request, once its query, size and signature (when `endpoint` has a secret) are
 * checked; otherwise the answer to send. The caller has checked the token and counted the request.
 */
export async function readDocumentRequest(req: Request, endpoint: Endpoint): Promise<{ meta: unknown; file: ImportFile | null; dryRun: boolean } | Response> {
  const dryRun = dryRunOf(req);
  if (dryRun instanceof Response) return dryRun;
  // The file plus room for the metadata and the multipart framing.
  const cap = maxBytes() + 1024 * 1024;
  if (Number(req.headers.get('content-length') ?? 0) > cap) return tooLarge();
  let { body, over } = capped(req, cap);
  if (credentialsOf(endpoint).secrets.length) {
    // Signed: the signature covers the raw bytes, read whole (within the cap) and checked before anything is parsed.
    let raw: ArrayBuffer;
    try {
      raw = await body.arrayBuffer();
    } catch {
      return over() ? tooLarge() : json({ error: 'invalid_body' }, 400);
    }
    const unsigned = await checkSignature(req, endpoint, new Uint8Array(raw));
    if (unsigned) return unsigned;
    body = new Response(raw, { headers: { 'Content-Type': req.headers.get('content-type') ?? '' } });
    over = () => false;
  }

  const ctype = (req.headers.get('content-type') ?? '').toLowerCase();
  let meta: unknown;
  let file: ImportFile | null = null;
  if (ctype.startsWith('multipart/form-data')) {
    let fd: FormData;
    try {
      fd = await body.formData();
    } catch {
      return over() ? tooLarge() : json({ error: 'invalid_body' }, 400);
    }
    const m = fd.get('meta');
    const text = typeof m === 'string' ? m : m instanceof Blob ? await m.text() : null;
    if (text == null) return json({ error: 'meta_required' }, 400);
    try {
      meta = JSON.parse(text);
    } catch {
      return json({ error: 'invalid_json', part: 'meta' }, 400);
    }
    const f = fd.get('file');
    if (typeof f === 'string') return json({ error: 'file_not_a_file' }, 400);
    if (f && f.size > 0) {
      if (f.size > maxBytes()) return tooLarge();
      file = { buf: Buffer.from(await f.arrayBuffer()), name: f.name || 'document', mime: f.type };
    }
  } else if (ctype.startsWith('application/json')) {
    try {
      meta = await body.json();
    } catch {
      return over() ? tooLarge() : json({ error: 'invalid_json' }, 400);
    }
  } else {
    return json({ error: 'unsupported_media_type' }, 415);
  }
  return { meta, file, dryRun };
}
