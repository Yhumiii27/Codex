import { checkBearer, importDocument, json, type ImportFile } from '@/lib/importer';
import { storageIsSharepoint } from '@/lib/storage';

// Import API for the migration tool (docs/api.md): one legacy document per call, bearer token CODEX_IMPORT_TOKEN.
//   multipart/form-data: part "meta" (JSON, text or file) + optional part "file"
//   application/json:    the metadata alone, without a file

/** CODEX_IMPORT_MAX_MB (100 by default), capped at 250 MB with SharePoint: Graph's simple upload goes no further. */
function maxBytes(): number {
  const mb = Number(process.env.CODEX_IMPORT_MAX_MB);
  const wanted = Number.isFinite(mb) && mb > 0 ? mb : 100;
  return (storageIsSharepoint() ? Math.min(wanted, 250) : wanted) * 1024 * 1024;
}

const tooLarge = () => json({ error: 'too_large', maxBytes: maxBytes() }, 413);

export async function POST(req: Request) {
  const denied = checkBearer(req, 'CODEX_IMPORT_TOKEN');
  if (denied) return denied;
  if (Number(req.headers.get('content-length') ?? 0) > maxBytes() + 1024 * 1024) return tooLarge();

  const ctype = (req.headers.get('content-type') ?? '').toLowerCase();
  let meta: unknown;
  let file: ImportFile | null = null;
  if (ctype.startsWith('multipart/form-data')) {
    let fd: FormData;
    try {
      fd = await req.formData();
    } catch {
      return json({ error: 'invalid_body' }, 400);
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
      meta = await req.json();
    } catch {
      return json({ error: 'invalid_json' }, 400);
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
      case 'created': {
        const href = `/documents/${encodeURIComponent(res.id)}`;
        return json({ id: res.id, revision: res.revision, version: res.version, status: res.revStatus, file: res.file, href, warnings: res.warnings }, 201, { Location: href });
      }
    }
  } catch (err) {
    console.error('[api/import]', err);
    return json({ error: 'internal' }, 500);
  }
}
