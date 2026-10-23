import { importDocument, json } from '@/lib/importer';
import { readDocumentRequest, refused } from '@/lib/import-request';
import { currentRequest, logger, withRequestLog } from '@/lib/log';
import { limitRequest } from '@/lib/ratelimit';
import { checkBearer } from '@/lib/server-auth';

// Import API for the migration tool (docs/api.md): one legacy document per call, bearer token CODEX_IMPORT_TOKEN and/or
// HMAC signature with CODEX_IMPORT_SECRET (lib/server-auth.ts). Body and simulation (?dryRun=1): lib/import-request.ts.

async function handlePost(req: Request) {
  const denied = checkBearer(req, 'import');
  if (denied) return denied;
  // Counted once the token is checked: a client without it cannot spend the budget of the one holding it.
  const limited = limitRequest(req, 'import');
  if (limited) return limited;
  const read = await readDocumentRequest(req, 'import');
  if (read instanceof Response) return read;

  try {
    const res = await importDocument(read.meta, read.file, { dryRun: read.dryRun });
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
      case 'ref_reused':
        // A deposit's answer (POST /api/documents): an import never gets it.
        return json({ error: 'duplicate', id: res.id }, 409);
      case 'dry_run':
        return json({ dryRun: true, id: res.id, warnings: res.warnings }, 200);
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
