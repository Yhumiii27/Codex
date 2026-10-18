import { and, eq } from 'drizzle-orm';
import { getDb, schema as s } from '@/db';
import { json } from '@/lib/importer';
import { applyChangeDecision, decisionWait, lockOf } from '@/lib/lifecycle';
import { currentRequest, logger, withRequestLog } from '@/lib/log';
import { limitRequest } from '@/lib/ratelimit';
import { checkBearer, checkSignature } from '@/lib/server-auth';

// Webhook through which Vigie sends its decision on a change (ECR) or withdrawal request (docs/api.md).
// Bearer token VIGIE_WEBHOOK_TOKEN and/or HMAC signature with VIGIE_WEBHOOK_SECRET (lib/server-auth.ts).
// Body: { requestId, accepted, ecoRef?, modifierId?, note? }.

type Decision = { requestId: string; accepted: boolean; ecoRef: string | null; modifierId: string | null; note: string | null };

function parse(body: unknown): Decision | { field: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { field: 'body' };
  const b = body as Record<string, unknown>;
  const opt = (k: string, max: number): string | null | undefined => {
    const v = b[k];
    if (v == null || v === '') return null;
    return typeof v === 'string' && v.trim().length <= max ? v.trim() || null : undefined;
  };
  const requestId = opt('requestId', 64);
  if (!requestId) return { field: 'requestId' };
  if (typeof b.accepted !== 'boolean') return { field: 'accepted' };
  const ecoRef = opt('ecoRef', 64), modifierId = opt('modifierId', 64), note = opt('note', 2000);
  if (ecoRef === undefined) return { field: 'ecoRef' };
  if (modifierId === undefined) return { field: 'modifierId' };
  if (note === undefined) return { field: 'note' };
  return { requestId, accepted: b.accepted, ecoRef, modifierId, note };
}

async function handlePost(req: Request) {
  const denied = checkBearer(req, 'vigie');
  if (denied) return denied;
  // Counted once the token is checked: a client without it cannot spend the budget of the one holding it.
  const limited = limitRequest(req, 'vigie');
  if (limited) return limited;
  // The raw bytes: the signature covers them as sent.
  const raw = new Uint8Array(await req.arrayBuffer());
  const unsigned = await checkSignature(req, 'vigie', raw);
  if (unsigned) return unsigned;
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const d = parse(body);
  if ('field' in d) return json({ error: 'invalid', field: d.field }, 400);

  try {
    const db = await getDb();
    if (d.modifierId) {
      const [u] = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.id, d.modifierId), eq(s.users.isSystem, false)));
      if (!u) return json({ error: 'unknown_user', field: 'modifierId' }, 400);
    }
    return await db.transaction(async (tx) => {
      const [r] = await tx.select().from(s.changeRequests).where(eq(s.changeRequests.id, d.requestId));
      if (!r) return json({ error: 'not_found' }, 404);
      // An acceptance that cannot apply yet is recorded and waits: 202, also when Vigie resends it. `reason` says what
      // holds it first: the lock of the document ('locked', see state and legalHold), else the revision already open
      // ('revision_open', D-26); `revision` is the letter of the revision open, which a change also waits for.
      const pending = async (extra: Record<string, unknown> = {}) => {
        const [doc] = await tx.select({ state: s.documents.state, legalHold: s.documents.legalHold, revWorking: s.documents.revWorking }).from(s.documents).where(eq(s.documents.id, r.docId));
        const wait = doc ? decisionWait(r.kind, doc) : { state: null, legalHold: false, revision: null };
        const reason = !doc || lockOf(doc) ? 'locked' : 'revision_open';
        return json({ ok: true, pending: true, ...extra, reason, requestId: r.id, kind: r.kind, docId: r.docId, status: 'accepted', ...wait }, 202);
      };
      if (r.status !== 'submitted') {
        // Vigie may resend a decision it did not see acknowledged: the same outcome is not an error.
        const wasAccepted = r.status !== 'rejected';
        if (wasAccepted !== d.accepted) return json({ error: 'already_decided', status: r.status }, 409);
        return r.status === 'accepted'
          ? await pending({ alreadyRecorded: true })
          : json({ ok: true, alreadyApplied: true, requestId: r.id, docId: r.docId, status: r.status });
      }
      // Same rules as the simulation (lib/lifecycle.ts): a change never opens a revision beside one already open (it
      // waits for it), the designated author must be able to draft the document, and nothing is written when it is refused.
      const res = await applyChangeDecision(tx, r.id, { accepted: d.accepted, ecoRef: d.ecoRef, modifierId: d.modifierId, note: d.note }, 'vigie');
      if ('error' in res) {
        if (res.error === 'modifier_not_allowed') return json({ error: 'modifier_not_allowed', field: 'modifierId', docId: r.docId }, 400);
        return json({ error: 'already_decided' }, 409);
      }
      if (res.status === 'accepted') return await pending();
      const [after] = await tx.select({ status: s.documents.status, revWorking: s.documents.revWorking }).from(s.documents).where(eq(s.documents.id, r.docId));
      return json({
        ok: true, requestId: r.id, kind: r.kind, docId: r.docId, status: res.status,
        docStatus: after?.status ?? null, revision: d.accepted && r.kind === 'modification' ? after?.revWorking ?? null : null,
      });
    });
  } catch (err) {
    logger('vigie').error('decision not applied', { changeRequest: d.requestId, err });
    // As withRequestLog answers an error it catches: the identifier finds the entry above in the technical log.
    return json({ error: 'internal', requestId: currentRequest()?.requestId }, 500);
  }
}

export const POST = withRequestLog('/api/integrations/vigie', handlePost);
