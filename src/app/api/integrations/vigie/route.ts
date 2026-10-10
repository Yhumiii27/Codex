import { and, eq } from 'drizzle-orm';
import { getDb, schema as s } from '@/db';
import { checkBearer, json } from '@/lib/importer';
import { applyChangeDecision } from '@/lib/lifecycle';

// Webhook through which Vigie sends its decision on a change (ECR) or withdrawal request (docs/api.md).
// Bearer token VIGIE_WEBHOOK_TOKEN. Body: { requestId, accepted, ecoRef?, modifierId?, note? }.

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

export async function POST(req: Request) {
  const denied = checkBearer(req, 'VIGIE_WEBHOOK_TOKEN');
  if (denied) return denied;
  let body: unknown;
  try {
    body = await req.json();
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
      // An acceptance on a locked document is recorded and waits for the lock to lift: 202, also when Vigie resends it.
      const pending = async (extra: Record<string, unknown> = {}) => {
        const [doc] = await tx.select({ state: s.documents.state, legalHold: s.documents.legalHold }).from(s.documents).where(eq(s.documents.id, r.docId));
        return json({ ok: true, pending: true, ...extra, requestId: r.id, kind: r.kind, docId: r.docId, status: 'accepted', state: doc?.state ?? null, legalHold: doc?.legalHold ?? false }, 202);
      };
      if (r.status !== 'submitted') {
        // Vigie may resend a decision it did not see acknowledged: the same outcome is not an error.
        const wasAccepted = r.status !== 'rejected';
        if (wasAccepted !== d.accepted) return json({ error: 'already_decided', status: r.status }, 409);
        return r.status === 'accepted'
          ? await pending({ alreadyRecorded: true })
          : json({ ok: true, alreadyApplied: true, requestId: r.id, docId: r.docId, status: r.status });
      }
      // Same rules as the simulation (lib/lifecycle.ts): a change never opens a revision beside one already open, and
      // nothing is written when it is refused.
      const res = await applyChangeDecision(tx, r.id, { accepted: d.accepted, ecoRef: d.ecoRef, modifierId: d.modifierId, note: d.note }, 'vigie');
      if ('error' in res) {
        if (res.error === 'locked_working') {
          const [doc] = await tx.select({ revWorking: s.documents.revWorking }).from(s.documents).where(eq(s.documents.id, r.docId));
          return json({ error: 'revision_in_progress', docId: r.docId, revision: doc?.revWorking ?? null }, 409);
        }
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
    console.error('[api/integrations/vigie]', err);
    return json({ error: 'internal' }, 500);
  }
}
