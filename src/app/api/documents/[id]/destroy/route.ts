import { destroyRecord } from '@/lib/app-records';
import { json } from '@/lib/importer';
import { currentRequest, logger, withRequestLog } from '@/lib/log';
import { limitRequest } from '@/lib/ratelimit';
import { DESTROY_REASONS, type DestroyReason } from '@/lib/records';
import { checkCursus, checkSignature, credentialsOf, routeSigned } from '@/lib/server-auth';

// Destruction of a record by Cursus, which filed it (request « lot 16 », docs/api.md « POST /api/documents/{id}/destroy »):
// a piece attached by mistake (`retrait`), the end of its retention (`conservation`), the right to erasure or the
// anonymisation of a personnel file (`effacement`). Cursus's token (CODEX_CURSUS_TOKEN) and, when set, its signature
// (CODEX_CURSUS_SECRET) over the method, the path and the body (lib/server-auth.ts routeSigned). Only a document filed
// under `cursus:` is reached: any other is 404. lib/app-records.ts destroyRecord does the work.

const MAX_BODY = 4096;

function safeDecode(x: string): string {
  try {
    return decodeURIComponent(x);
  } catch {
    return x;
  }
}

async function handlePost(req: Request, { params }: RouteContext<'/api/documents/[id]/destroy'>) {
  const denied = checkCursus(req);
  if (denied) return denied;
  const limited = limitRequest(req, 'cursus');
  if (limited) return limited;
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return json({ error: 'too_large', maxBytes: MAX_BODY }, 413);
  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.byteLength > MAX_BODY) return json({ error: 'too_large', maxBytes: MAX_BODY }, 413);
  if (credentialsOf('cursus').secrets.length) {
    const unsigned = await checkSignature(req, 'cursus', routeSigned('POST', new URL(req.url).pathname, raw));
    if (unsigned) return unsigned;
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(raw).toString('utf8') || 'null');
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const reason = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).reason : undefined;
  if (typeof reason !== 'string' || !(DESTROY_REASONS as readonly string[]).includes(reason)) {
    return json({ error: 'validation', issues: [{ field: 'reason', code: reason == null ? 'required' : 'invalid_value', message: `Motif attendu : ${DESTROY_REASONS.join(', ')}.` }] }, 400);
  }
  const id = safeDecode((await params).id);
  try {
    const res = await destroyRecord(id, reason as DestroyReason);
    switch (res.kind) {
      case 'not_found':
        return json({ error: 'not_found' }, 404);
      case 'legal_hold':
        return json({ error: 'legal_hold', id: res.id }, 409);
      case 'in_use':
        return json({ error: 'in_use', id: res.id }, 409);
      case 'already':
        return json({ id: res.id, destroyed: true, alreadyDestroyed: true, reason: res.reason, destroyedAt: res.destroyedAt }, 200);
      case 'destroyed':
        return json({ id: res.id, destroyed: true, reason, destroyedAt: res.destroyedAt, ...(res.failed ? { filesPending: res.failed } : {}) }, 200);
    }
  } catch (err) {
    logger('records').error('destruction failed', { err });
    return json({ error: 'internal', requestId: currentRequest()?.requestId }, 500);
  }
}

export const POST = withRequestLog('/api/documents/[id]/destroy', handlePost);
