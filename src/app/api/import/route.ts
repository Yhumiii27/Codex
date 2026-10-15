import { fileRules } from '@/lib/filetypes';
import { checkBearer, importDocument, json, type ImportFile } from '@/lib/importer';
import { currentRequest, logger, withRequestLog } from '@/lib/log';
import { limitRequest } from '@/lib/ratelimit';
import type { FileRejection } from '@/lib/storage';

// Import API for the migration tool (docs/api.md): one legacy document per call, bearer token CODEX_IMPORT_TOKEN.
//   multipart/form-data: part "meta" (JSON, text or file) + optional part "file"
//   application/json:    the metadata alone, without a file

/** The largest file, the same for every entry (CODEX_MAX_FILE_MB, lib/filetypes.ts). */
const maxBytes = () => fileRules(process.env).maxBytes;

const tooLarge = () => json({ error: 'too_large', maxBytes: maxBytes() }, 413);

/**
 * A file refused on its way in: 413 for its size, or for being beyond the virus scan's limits (sending it again changes
 * nothing), 415 for its format (with the extensions admitted), 422 when the virus scan finds it infected, 503 when the
 * scan could not be run (to be sent again later).
 */
function refused(r: FileRejection): Response {
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

async function handlePost(req: Request) {
  const denied = checkBearer(req, 'CODEX_IMPORT_TOKEN');
  if (denied) return denied;
  // Counted once the token is checked: a client without it cannot spend the budget of the one holding it.
  const limited = limitRequest(req, 'import');
  if (limited) return limited;
  // The file plus room for the metadata and the multipart framing.
  const cap = maxBytes() + 1024 * 1024;
  if (Number(req.headers.get('content-length') ?? 0) > cap) return tooLarge();
  const { body, over } = capped(req, cap);

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

  try {
    const res = await importDocument(meta, file);
    switch (res.kind) {
      case 'invalid':
        return json({ error: 'validation', issues: res.issues, warnings: res.warnings }, 400);
      case 'duplicate':
        return json({ error: 'duplicate', id: res.id }, 409);
      case 'conflict':
        // Not a replay: the legacy reference is another document's Codex ID. The tool must not record this mapping.
        return json({ error: 'ref_is_codex_id', id: res.id }, 409);
      case 'file_rejected':
        return refused(res.rejection);
      case 'created': {
        const href = `/documents/${encodeURIComponent(res.id)}`;
        return json({ id: res.id, revision: res.revision, version: res.version, status: res.revStatus, file: res.file, href, warnings: res.warnings }, 201, { Location: href });
      }
    }
  } catch (err) {
    logger('import').error('import failed', { err });
    // As withRequestLog answers an error it catches: the identifier finds the entry above in the technical log.
    return json({ error: 'internal', requestId: currentRequest()?.requestId }, 500);
  }
}

export const POST = withRequestLog('/api/import', handlePost);
