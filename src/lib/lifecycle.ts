import 'server-only';
import { and, asc, eq, inArray, isNull, lt, lte, ne, or } from 'drizzle-orm';
import { schema as s, type Db } from '@/db';
import { buildAccessIndex, canRead } from './access';
import { nextLetter } from './codification';
import { nowStamp, todayIso } from './format';
import { MATRIX_ROLE, type Perm, type SimRole } from './i18n';

// Revision lifecycle (docs/modele-cible.md §4): draft → in_review → approved → in_force, previous in force → superseded.

export type Tx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

type DocRow = typeof s.documents.$inferSelect;
type RevRow = typeof s.revisions.$inferSelect;

export async function audit(tx: Tx, userId: string, action: string, docId: string, detail = '') {
  await tx.insert(s.auditLog).values({ at: nowStamp(), userId, action, docId, detail });
}

export type LockKey = 'locked_archived' | 'locked_obsolete' | 'locked_hold';

/** Why a document cannot change right now: archived, obsolete or under legal hold. */
export function lockOf(d: Pick<DocRow, 'state' | 'legalHold'>): LockKey | null {
  if (d.state === 'archived') return 'locked_archived';
  if (d.state === 'obsolete') return 'locked_obsolete';
  if (d.legalHold) return 'locked_hold';
  return null;
}

/** Keeps the document's headline status and revision letters in step with its revisions. */
export async function refreshHeadline(tx: Tx, docId: string) {
  const [d] = await tx.select().from(s.documents).where(eq(s.documents.id, docId));
  if (!d) return;
  const revs = await tx.select().from(s.revisions).where(eq(s.revisions.docId, docId)).orderBy(asc(s.revisions.id));
  const inForce = revs.findLast((r) => r.status === 'in_force');
  const working = revs.findLast((r) => r.status === 'draft' || r.status === 'in_review' || r.status === 'approved');
  const status = d.state !== 'active' ? d.state : inForce ? 'in_force' : working ? working.status : 'draft';
  await tx.update(s.documents).set({ status, revInForce: inForce?.letter ?? null, revWorking: working?.letter ?? null }).where(eq(s.documents.id, docId));
}

/**
 * Puts an approved revision in force; the one it replaces becomes "Remplacé". A revision already in force is left
 * alone (two requests promoting it at once). An effective date already past becomes the day it actually entered into force.
 */
export async function putInForce(tx: Tx, rev: RevRow, date: string) {
  const [cur] = await tx.select().from(s.revisions).where(eq(s.revisions.id, rev.id));
  if (!cur || cur.status === 'in_force') return;
  await tx.update(s.revisions).set({ status: 'superseded', supersededAt: date }).where(and(eq(s.revisions.docId, rev.docId), eq(s.revisions.status, 'in_force'), ne(s.revisions.id, rev.id)));
  await tx.update(s.revisions).set({ status: 'in_force', inForceAt: date, effectiveAt: cur.effectiveAt && cur.effectiveAt < date ? date : cur.effectiveAt }).where(eq(s.revisions.id, rev.id));
  const [d] = await tx.select().from(s.documents).where(eq(s.documents.id, rev.docId));
  await tx.update(s.documents).set({ issuedAt: d?.issuedAt ?? date, modifiedAt: date }).where(eq(s.documents.id, rev.docId));
  await audit(tx, 'codex', 'in_force', rev.docId, rev.letter);
  await refreshHeadline(tx, rev.docId);
}

/** Final approval of a revision still in review: in force now, or on its effective date. False when it is no longer in review. */
export async function approveRevision(tx: Tx, revId: number): Promise<boolean> {
  const today = todayIso();
  const [rev] = await tx.update(s.revisions).set({ status: 'approved', approvedAt: today }).where(and(eq(s.revisions.id, revId), eq(s.revisions.status, 'in_review'))).returning();
  if (!rev) return false;
  if (!rev.effectiveAt || rev.effectiveAt <= today) await putInForce(tx, rev, today);
  else await refreshHeadline(tx, rev.docId);
  return true;
}

/**
 * Approved revisions whose effective date has come enter into force (run lazily at the start of each request).
 * Only on active documents free of legal hold: an archived, obsolete or frozen record never changes (same rule as lockOf).
 */
export async function promoteDue(db: Db) {
  const today = todayIso();
  const due = await db
    .select({ id: s.revisions.id })
    .from(s.revisions)
    .innerJoin(s.documents, eq(s.documents.id, s.revisions.docId))
    .where(and(eq(s.revisions.status, 'approved'), or(isNull(s.revisions.effectiveAt), lte(s.revisions.effectiveAt, today)), eq(s.documents.state, 'active'), eq(s.documents.legalHold, false)));
  for (const { id } of due) {
    await db.transaction(async (tx) => {
      // Read again inside the transaction: a concurrent request may have promoted it, or the document changed meanwhile.
      const [rev] = await tx.select().from(s.revisions).where(and(eq(s.revisions.id, id), eq(s.revisions.status, 'approved')));
      if (!rev) return;
      const [d] = await tx.select().from(s.documents).where(eq(s.documents.id, rev.docId));
      if (!d || lockOf(d)) return;
      await putInForce(tx, rev, rev.effectiveAt ?? today);
    });
  }
}

/** Approved revisions of a document waiting for an effective date already past: they enter into force today at the earliest. */
export async function catchUpEffectiveDates(tx: Tx, docId: string) {
  const today = todayIso();
  await tx.update(s.revisions).set({ effectiveAt: today }).where(and(eq(s.revisions.docId, docId), eq(s.revisions.status, 'approved'), lt(s.revisions.effectiveAt, today)));
}

/** Opens the next revision letter as a draft (after an accepted ECO). */
export async function openRevision(tx: Tx, docId: string, opts: { modifierId?: string | null; changeRef?: string | null }) {
  const revs = await tx.select().from(s.revisions).where(eq(s.revisions.docId, docId)).orderBy(asc(s.revisions.id));
  const last = revs.at(-1);
  const letter = nextLetter(last?.letter);
  const [rev] = await tx.insert(s.revisions).values({ docId, letter, status: 'draft', createdAt: todayIso(), modifierId: opts.modifierId ?? null, changeRef: opts.changeRef ?? null }).returning();
  await refreshHeadline(tx, docId);
  return rev;
}

/** Permissions a person holds with their default role (not the simulated one). */
export async function defaultPerms(tx: Tx, role: string): Promise<Set<Perm>> {
  const row = MATRIX_ROLE[role as SimRole];
  if (!row) return new Set();
  const rows = await tx.select().from(s.rolePermissions).where(and(eq(s.rolePermissions.role, row), eq(s.rolePermissions.granted, true)));
  return new Set(rows.map((r) => r.perm as Perm));
}

/**
 * Author of a revision opened by an ECO when Vigie names nobody: the requester, if their default role may write and
 * they can still read the document; otherwise its owner.
 */
export async function defaultModifier(tx: Tx, requesterId: string, d: DocRow): Promise<string> {
  const [u] = await tx.select().from(s.users).where(eq(s.users.id, requesterId));
  if (!u || u.isSystem) return d.ownerId;
  const perms = await defaultPerms(tx, u.role);
  const viewer = { user: u, seesAll: u.role === 'gestionnaire', can: (p: Perm) => perms.has(p) };
  return perms.has('upload') && canRead(viewer, d, await buildAccessIndex(tx)) ? u.id : d.ownerId;
}

export type ChangeDecisionError = 'not_found' | LockKey | 'locked_working';

/**
 * Applies Vigie's decision on a change request (webhook or simulation). An acceptance only applies to an active document
 * free of legal hold, and a change never opens a second revision beside one already open; a refusal always applies.
 * An accepted withdrawal closes the work in progress: running workflows end and open revisions are cancelled.
 */
export async function applyChangeDecision(tx: Tx, id: string, decision: { accepted: boolean; ecoRef?: string | null; modifierId?: string | null; note?: string | null }, actorId: string): Promise<ChangeDecisionError | null> {
  const [req] = await tx.select().from(s.changeRequests).where(eq(s.changeRequests.id, id));
  if (!req || req.status !== 'submitted') return 'not_found';
  const at = nowStamp();
  if (!decision.accepted) {
    await tx.update(s.changeRequests).set({ status: 'rejected', decidedAt: at, decisionNote: decision.note ?? null }).where(eq(s.changeRequests.id, id));
    await audit(tx, actorId, req.kind === 'modification' ? 'ecr' : 'obsolete', req.docId, `${id} · ✕`);
    return null;
  }
  const [doc] = await tx.select().from(s.documents).where(eq(s.documents.id, req.docId));
  if (!doc) return 'not_found';
  const lock = lockOf(doc);
  if (lock) return lock;
  const ref = decision.ecoRef ?? id;
  let modifierId: string | null = null;
  if (req.kind === 'modification') {
    if (doc.revWorking) return 'locked_working';
    modifierId = decision.modifierId ?? (await defaultModifier(tx, req.requesterId, doc));
    const rev = await openRevision(tx, req.docId, { modifierId, changeRef: ref });
    await audit(tx, actorId, 'ecr', req.docId, `${ref} → ${rev.letter}`);
  } else {
    const running = await tx.select().from(s.workflows).where(and(eq(s.workflows.docId, doc.id), isNull(s.workflows.outcome)));
    for (const w of running) {
      await tx.update(s.workflows).set({ outcome: 'rejected' }).where(eq(s.workflows.id, w.id));
      await tx.insert(s.workflowComments).values({ workflowId: w.id, authorId: actorId, at: at.slice(0, 10), text: { fr: `Circuit clos — document retiré (${ref}).`, en: `Workflow closed — document withdrawn (${ref}).` } });
      await audit(tx, actorId, 'reject', doc.id, w.id);
    }
    await tx.update(s.revisions).set({ status: 'cancelled' }).where(and(eq(s.revisions.docId, doc.id), inArray(s.revisions.status, ['draft', 'in_review', 'approved'])));
    await tx.update(s.documents).set({ state: 'obsolete', obsoleteAt: at.slice(0, 10), modifiedAt: at.slice(0, 10) }).where(eq(s.documents.id, req.docId));
    await refreshHeadline(tx, req.docId);
    await audit(tx, actorId, 'obsolete', req.docId, ref);
  }
  await tx.update(s.changeRequests).set({ status: 'implemented', decidedAt: at, ecoRef: decision.ecoRef ?? null, modifierId, decisionNote: decision.note ?? null }).where(eq(s.changeRequests.id, id));
  return null;
}
