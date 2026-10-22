import 'server-only';
import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema as s, type Db } from '@/db';
import type { Conf, Localized } from '@/db/schema';
import { loc, localized } from './format';
import { approverCheck, audit, circuitExclusions, defaultPerms, lockDocs, lockOf, mayDraft, type LockKey, type Tx } from './lifecycle';

// Holdings of a person handed to a replacement in one operation (point 19 of docs/reste-a-faire.md, A15): ownership of
// documents and processes, designated author of open revisions, pending approval steps, function holderships, named
// readers. Administration › Reprise simulates it (the same transaction, rolled back), then a records manager confirms the
// very plan shown (its digest). No replacement is ever proposed, and no account is disabled (A15, O-02).

/** What a person may hold, in the order the transfer hands it on (each step sees the ones before). */
export const TRANSFER_KINDS = ['owner', 'process_owner', 'reader', 'modifier', 'step', 'holder'] as const;
export type TransferKind = (typeof TRANSFER_KINDS)[number];

/**
 * Why an object cannot be handed to the replacement: a lock that freezes a circuit (as for delegateStep); the replacement
 * would approve a revision they own or write (`owner_approves`, `modifier_approves`) or is set apart from its circuit
 * (`self_approval`: requester, designated author, author of a working version); their default role may not approve
 * (`cannot_approve`) or draft (`cannot_draft`); they may not read the document (`cannot_read`).
 */
export type TransferReason = LockKey | 'owner_approves' | 'modifier_approves' | 'self_approval' | 'cannot_approve' | 'cannot_draft' | 'cannot_read';

/**
 * One object the person holds. `ref`: what identifies it (document ID, revision, step, holdership). `ok`: whether it
 * goes to the replacement (null while none is chosen), and if not, why.
 */
export type TransferItem = {
  kind: TransferKind; ref: string; ok: boolean | null; reason?: TransferReason;
  docId?: string; title?: string; letter?: string; workflowId?: string; stepName?: Localized; functionKey?: string; scope?: string | null;
};

/**
 * What the transfer leaves to others, listed for information: authors Vigie designated for an accepted change (Vigie
 * names them), projects managed (Keystone), research programmes managed (Administration › Fonctions & circuits).
 */
export type TransferNote = { kind: 'vigie' | 'project' | 'program'; ref: string; docId?: string; label?: string };

export type TransferPlan = { from: string; to: string | null; items: TransferItem[]; notes: TransferNote[]; digest: string };

type Users = ReadonlyMap<string, { role: string; isSystem: boolean }>;

/** Thrown to roll a transaction back with what it computed (a simulation, a plan that changed since it was shown). */
class Rollback<T> extends Error {
  constructor(readonly value: T) {
    super('rollback');
  }
}

/**
 * The fingerprint of a plan: who, to whom, each object and whether it goes. Confirming sends back the one shown, and a
 * transfer whose plan reads differently by then is refused (nothing written): what is done is what was shown.
 */
export function transferDigest(p: Pick<TransferPlan, 'from' | 'to' | 'items'>): string {
  const body = JSON.stringify([p.from, p.to, p.items.map((i) => [i.kind, i.ref, i.ok, i.reason ?? null])]);
  return createHash('sha256').update(body).digest('base64url');
}

/** Journal entries of a document: who to whom, and what decides who reads the values (lib/queries.ts, D-14). */
const docEntry = (field: string, from: string, to: string, d: { conf: Conf; revInForce: string | null }, inForce = !!d.revInForce) =>
  ({ changes: [{ field, before: from, after: to }], doc: { conf: d.conf, inForce } });

/**
 * Runs the transfer of `from`'s holdings to `to` in `tx`, kind after kind (TRANSFER_KINDS), each object checked against
 * what the ones before left (a document whose ownership went to the replacement sets them apart from its circuit): the
 * objects that may go are handed on and journaled one by one ('transfer'), then the whole ('transfer_summary'). Without
 * `to`, only lists what `from` holds. Locked documents are included for ownership, processes, readers and authors (an
 * act of administration); a lock freezes a circuit, whose steps then stay where they are, as for delegateStep.
 */
async function runTransfer(tx: Tx, users: Users, actorId: string, from: string, to: string | null): Promise<Omit<TransferPlan, 'digest'>> {
  const D = s.documents;
  const items: TransferItem[] = [];
  const mayApprove = await approverCheck(tx, users);
  // Pending steps of running circuits (the current one and those after it), with their circuit.
  const pendingSteps = async (assignee: string) => tx
    .select({ step: s.workflowSteps, w: s.workflows })
    .from(s.workflowSteps).innerJoin(s.workflows, eq(s.workflows.id, s.workflowSteps.workflowId))
    .where(and(isNull(s.workflows.outcome), eq(s.workflowSteps.assigneeId, assignee), sql`${s.workflowSteps.idx} >= ${s.workflows.step}`))
    .orderBy(asc(s.workflows.id), asc(s.workflowSteps.idx));
  const toSteps = to ? await pendingSteps(to) : [];
  const docRow = async (id: string) => (await tx.select().from(D).where(eq(D.id, id)))[0];

  // Ownership of documents. The owner writes a revision nobody was designated to write: a replacement who approves its
  // running circuit would decide on their own revision (D-15, circuitExclusions), so that document stays until the step
  // is handed on.
  for (const d of await tx.select().from(D).where(eq(D.ownerId, from)).orderBy(asc(D.id))) {
    const item: TransferItem = { kind: 'owner', ref: d.id, ok: null, docId: d.id, title: d.title };
    items.push(item);
    if (!to) continue;
    const approving = toSteps.find((x) => x.w.docId === d.id);
    const [rev] = approving ? await tx.select().from(s.revisions).where(eq(s.revisions.id, approving.w.revisionId)) : [];
    if (rev && !rev.modifierId) { Object.assign(item, { ok: false, reason: 'owner_approves' }); continue; }
    await tx.update(D).set({ ownerId: to }).where(eq(D.id, d.id));
    await audit(tx, actorId, 'transfer', d.id, '', null, docEntry('ownerId', from, to, d));
    item.ok = true;
  }

  // Process ownership (internal documents).
  for (const d of await tx.select().from(D).where(eq(D.processOwnerId, from)).orderBy(asc(D.id))) {
    const item: TransferItem = { kind: 'process_owner', ref: d.id, ok: null, docId: d.id, title: d.title };
    items.push(item);
    if (!to) continue;
    await tx.update(D).set({ processOwnerId: to }).where(eq(D.id, d.id));
    await audit(tx, actorId, 'transfer', d.id, '', null, docEntry('processOwnerId', from, to, d));
    item.ok = true;
  }

  // Named readers of confidential documents: the replacement reads what the person read (already a reader: one row).
  const reading = await tx.select({ d: D }).from(s.documentReaders).innerJoin(D, eq(D.id, s.documentReaders.docId)).where(eq(s.documentReaders.userId, from)).orderBy(asc(D.id));
  for (const { d } of reading) {
    const item: TransferItem = { kind: 'reader', ref: d.id, ok: null, docId: d.id, title: d.title };
    items.push(item);
    if (!to) continue;
    const [already] = await tx.select().from(s.documentReaders).where(and(eq(s.documentReaders.docId, d.id), eq(s.documentReaders.userId, to)));
    if (already) await tx.delete(s.documentReaders).where(and(eq(s.documentReaders.docId, d.id), eq(s.documentReaders.userId, from)));
    else await tx.update(s.documentReaders).set({ userId: to }).where(and(eq(s.documentReaders.docId, d.id), eq(s.documentReaders.userId, from)));
    // The readers are kept apart from the row: its version is raised, for the dialogs open on the record (as setReaders).
    await tx.update(D).set({ version: sql`${D.version} + 1` }).where(eq(D.id, d.id));
    // Who the named readers are stays within the drafting circle, who manages them (setReaders journals only their
    // number): the values are withheld from the document's other readers, as for a change made on a draft (D-14).
    await audit(tx, actorId, 'transfer', d.id, '', null, docEntry('reader', from, to, d, false));
    item.ok = true;
  }

  // Designated author of open revisions: someone who may draft the document (lib/lifecycle.ts mayDraft, the rule of an
  // author Vigie designates), and who does not approve it.
  const writing = await tx.select({ r: s.revisions, title: D.title }).from(s.revisions).innerJoin(D, eq(D.id, s.revisions.docId))
    .where(and(eq(s.revisions.modifierId, from), inArray(s.revisions.status, ['draft', 'in_review', 'approved']))).orderBy(asc(s.revisions.docId), asc(s.revisions.id));
  for (const { r, title } of writing) {
    const item: TransferItem = { kind: 'modifier', ref: String(r.id), ok: null, docId: r.docId, title, letter: r.letter };
    items.push(item);
    if (!to) continue;
    const d = await docRow(r.docId);
    if (toSteps.some((x) => x.w.revisionId === r.id)) { Object.assign(item, { ok: false, reason: 'modifier_approves' }); continue; }
    if (!(await mayDraft(tx, to, d))) {
      const toRole = users.get(to)?.role ?? '';
      Object.assign(item, { ok: false, reason: (await defaultPerms(tx, toRole)).has('upload') ? 'cannot_read' : 'cannot_draft' });
      continue;
    }
    await tx.update(s.revisions).set({ modifierId: to }).where(eq(s.revisions.id, r.id));
    // Tied to the revision: outside the drafting circle, shown once it is in force, names included (D-14).
    await audit(tx, actorId, 'transfer', r.docId, r.letter, r.id, docEntry('modifierId', from, to, d, true));
    item.ok = true;
  }

  // Pending approval steps: delegateStep's checks, against the circuit as the steps above left it.
  for (const { step, w } of await pendingSteps(from)) {
    const d = await docRow(w.docId);
    const item: TransferItem = { kind: 'step', ref: `${w.id}:${step.idx}`, ok: null, docId: w.docId, title: d?.title, workflowId: w.id, stepName: step.name };
    items.push(item);
    if (!to || !d) continue;
    const [rev] = await tx.select().from(s.revisions).where(eq(s.revisions.id, w.revisionId));
    item.letter = rev?.letter;
    const lock = lockOf(d);
    if (lock) { Object.assign(item, { ok: false, reason: lock }); continue; }
    if (!rev || (await circuitExclusions(tx, d, rev, w.requesterId)).has(to)) { Object.assign(item, { ok: false, reason: 'self_approval' }); continue; }
    if (!mayApprove(to)) { Object.assign(item, { ok: false, reason: 'cannot_approve' }); continue; }
    await tx.update(s.workflowSteps).set({ assigneeId: to }).where(and(eq(s.workflowSteps.workflowId, w.id), eq(s.workflowSteps.idx, step.idx)));
    await audit(tx, actorId, 'transfer', w.docId, `${w.id} · ${loc(step.name, 'fr')}`, rev.id, { ...docEntry('assigneeId', from, to, d, true), text: { code: 'step_transferred', params: { wf: w.id, step: localized(step.name) } } });
    item.ok = true;
  }

  // Function holderships: a holder decides approval steps, the replacement's default role must approve.
  const held = await tx.select().from(s.functionHolders).where(eq(s.functionHolders.userId, from)).orderBy(asc(s.functionHolders.functionKey), asc(s.functionHolders.id));
  for (const h of held) {
    const item: TransferItem = { kind: 'holder', ref: String(h.id), ok: null, functionKey: h.functionKey, scope: h.scopeValue };
    items.push(item);
    if (!to) continue;
    if (!mayApprove(to)) { Object.assign(item, { ok: false, reason: 'cannot_approve' }); continue; }
    const same = (await tx.select().from(s.functionHolders).where(and(eq(s.functionHolders.functionKey, h.functionKey), eq(s.functionHolders.userId, to))))
      .some((x) => x.scopeValue === h.scopeValue);
    if (same) await tx.delete(s.functionHolders).where(eq(s.functionHolders.id, h.id));
    else await tx.update(s.functionHolders).set({ userId: to }).where(eq(s.functionHolders.id, h.id));
    await audit(tx, actorId, 'transfer', { kind: 'function', id: h.functionKey }, '', null, { changes: [{ field: 'holder', scope: h.scopeValue, before: from, after: to }] });
    item.ok = true;
  }

  const notes: TransferNote[] = [
    ...(await tx.select({ id: s.changeRequests.id, docId: s.changeRequests.docId }).from(s.changeRequests)
      .where(and(eq(s.changeRequests.modifierId, from), eq(s.changeRequests.status, 'accepted'))).orderBy(asc(s.changeRequests.id)))
      .map((c): TransferNote => ({ kind: 'vigie', ref: c.id, docId: c.docId })),
    ...(await tx.select({ code: s.projects.code, name: s.projects.name }).from(s.projects).where(eq(s.projects.managerId, from)).orderBy(asc(s.projects.code)))
      .map((p): TransferNote => ({ kind: 'project', ref: p.code, label: p.name })),
    ...(await tx.select({ code: s.researchPrograms.code, name: s.researchPrograms.name }).from(s.researchPrograms).where(eq(s.researchPrograms.managerId, from)).orderBy(asc(s.researchPrograms.code)))
      .map((p): TransferNote => ({ kind: 'program', ref: p.code, label: p.name })),
  ];

  if (to && items.some((i) => i.ok)) {
    const done: Partial<Record<TransferKind, number>> = {};
    for (const i of items) if (i.ok) done[i.kind] = (done[i.kind] ?? 0) + 1;
    await audit(tx, actorId, 'transfer_summary', { kind: 'user', id: from }, '', null, { transfer: { to, done, skipped: items.filter((i) => i.ok === false).length } });
  }
  return { from, to, items, notes };
}

/**
 * The plan of a transfer as it would run now: the transfer itself, in a transaction rolled back (nothing is written,
 * journal included), so that what is shown is exactly what confirming would do.
 */
export async function simulateTransfer(db: Db, users: Users, actorId: string, from: string, to: string | null): Promise<TransferPlan> {
  try {
    await db.transaction(async (tx) => {
      const plan = await runTransfer(tx, users, actorId, from, to);
      throw new Rollback(plan);
    });
  } catch (err) {
    if (err instanceof Rollback) {
      const plan = err.value as Omit<TransferPlan, 'digest'>;
      return { ...plan, digest: transferDigest(plan) };
    }
    throw err;
  }
  throw new Error('unreachable');
}

/**
 * Documents a transfer from `from` may change: owned or whose process they own, named reader, author of an open
 * revision or of a change Vigie accepted, holder of a step of a running circuit.
 */
async function holdingsOf(tx: Tx, from: string): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    select id from documents where owner_id = ${from} or process_owner_id = ${from}
    union select doc_id from document_readers where user_id = ${from}
    union select doc_id from revisions where modifier_id = ${from} and status in ('draft', 'in_review', 'approved')
    union select doc_id from change_requests where modifier_id = ${from} and status = 'accepted'
    union select w.doc_id from workflows w join workflow_steps x on x.workflow_id = w.id where x.assignee_id = ${from} and coalesce(w.outcome, '') = ''`);
  return rows.rows.map((r) => r.id);
}

/**
 * Runs the transfer for good, provided its plan still has the digest shown (`digest`): otherwise nothing is written and
 * the plan as it now stands is returned (`changed`). `empty`: nothing would go to the replacement.
 */
export async function confirmTransfer(db: Db, users: Users, actorId: string, from: string, to: string, digest: string): Promise<{ done: TransferPlan } | { changed: TransferPlan } | { empty: TransferPlan }> {
  try {
    return await db.transaction(async (tx) => {
      // One transfer at a time (a no-op on PGlite's single connection): two of them never read the same holdings.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('codex:transfer'))`);
      // The documents of the person who leaves locked (lib/lifecycle.ts lockDocs), then read: a decision, an upload or an
      // edit on one of them, committed meanwhile, is part of the plan compared with the digest, never overwritten.
      await lockDocs(tx, await holdingsOf(tx, from));
      const raw = await runTransfer(tx, users, actorId, from, to);
      const plan = { ...raw, digest: transferDigest(raw) };
      if (plan.digest !== digest) throw new Rollback({ changed: plan });
      if (!plan.items.some((i) => i.ok)) throw new Rollback({ empty: plan });
      return { done: plan };
    });
  } catch (err) {
    if (err instanceof Rollback) return err.value as { changed: TransferPlan } | { empty: TransferPlan };
    throw err;
  }
}
