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

/** `revisionId`: the revision the entry is about, which decides who reads it (lib/access.ts, readerMaySeeEntry). */
export async function audit(tx: Tx, userId: string, action: string, docId: string, detail = '', revisionId: number | null = null) {
  await tx.insert(s.auditLog).values({ at: nowStamp(), userId, action, docId, detail, revisionId });
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
  await audit(tx, 'codex', 'in_force', rev.docId, rev.letter, rev.id);
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

export type ChangeDecisionError = 'not_found' | 'locked_working';

/**
 * What became of a decision: applied now ('rejected', 'implemented'), or an acceptance recorded while the document is
 * locked ('accepted', with the state and hold that lock it), applied when the lock lifts (applyPendingDecision).
 */
export type ChangeDecisionResult = { error: ChangeDecisionError } | { status: 'rejected' | 'implemented' } | ({ status: 'accepted' } & Pick<DocRow, 'state' | 'legalHold'>);

type ChangeRow = typeof s.changeRequests.$inferSelect;

/**
 * Carries out an accepted request on an unlocked document: a change opens the next revision for the modifier (the one
 * Vigie named, else the default one), a withdrawal closes the work in progress (running workflows end, open revisions are
 * cancelled) and makes the document obsolete. The request becomes 'implemented'.
 */
async function implementChange(tx: Tx, req: ChangeRow, doc: DocRow, actorId: string) {
  const at = nowStamp();
  const ref = req.ecoRef ?? req.id;
  let modifierId: string | null = null;
  if (req.kind === 'modification') {
    modifierId = req.modifierId ?? (await defaultModifier(tx, req.requesterId, doc));
    const rev = await openRevision(tx, req.docId, { modifierId, changeRef: ref });
    await audit(tx, actorId, 'ecr', req.docId, `${ref} → ${rev.letter}`, rev.id);
  } else {
    const running = await tx.select().from(s.workflows).where(and(eq(s.workflows.docId, doc.id), isNull(s.workflows.outcome)));
    for (const w of running) {
      await tx.update(s.workflows).set({ outcome: 'rejected' }).where(eq(s.workflows.id, w.id));
      await tx.insert(s.workflowComments).values({ workflowId: w.id, authorId: actorId, at: at.slice(0, 10), text: { fr: `Circuit clos — document retiré (${ref}).`, en: `Workflow closed — document withdrawn (${ref}).` } });
      await audit(tx, actorId, 'reject', doc.id, w.id, w.revisionId);
    }
    await tx.update(s.revisions).set({ status: 'cancelled' }).where(and(eq(s.revisions.docId, doc.id), inArray(s.revisions.status, ['draft', 'in_review', 'approved'])));
    await tx.update(s.documents).set({ state: 'obsolete', obsoleteAt: at.slice(0, 10), modifiedAt: at.slice(0, 10) }).where(eq(s.documents.id, req.docId));
    await refreshHeadline(tx, req.docId);
    await audit(tx, actorId, 'obsolete', req.docId, ref);
  }
  // decidedAt stays the date of Vigie's decision when it was recorded before it could apply.
  await tx.update(s.changeRequests).set({ status: 'implemented', decidedAt: req.decidedAt ?? at, ecoRef: req.ecoRef, modifierId, decisionNote: req.decisionNote }).where(eq(s.changeRequests.id, req.id));
}

/**
 * Applies Vigie's decision on a change request (webhook or simulation). A refusal always applies. An acceptance applies
 * at once to an active document free of legal hold; on a locked one (archived, obsolete, frozen) it is recorded as
 * 'accepted' with its change order, modifier and note, and applied when the lock lifts. A change never opens a second
 * revision beside one already open.
 */
export async function applyChangeDecision(tx: Tx, id: string, decision: { accepted: boolean; ecoRef?: string | null; modifierId?: string | null; note?: string | null }, actorId: string): Promise<ChangeDecisionResult> {
  const [req] = await tx.select().from(s.changeRequests).where(eq(s.changeRequests.id, id));
  if (!req || req.status !== 'submitted') return { error: 'not_found' };
  const at = nowStamp();
  if (!decision.accepted) {
    await tx.update(s.changeRequests).set({ status: 'rejected', decidedAt: at, decisionNote: decision.note ?? null }).where(eq(s.changeRequests.id, id));
    await audit(tx, actorId, req.kind === 'modification' ? 'ecr' : 'obsolete', req.docId, `${id} · ✕`);
    return { status: 'rejected' };
  }
  const [doc] = await tx.select().from(s.documents).where(eq(s.documents.id, req.docId));
  if (!doc) return { error: 'not_found' };
  const lock = lockOf(doc);
  if (!lock && req.kind === 'modification' && doc.revWorking) return { error: 'locked_working' };
  const accepted = { ecoRef: decision.ecoRef ?? null, modifierId: req.kind === 'modification' ? decision.modifierId ?? null : null, decisionNote: decision.note ?? null };
  if (lock) {
    await tx.update(s.changeRequests).set({ status: 'accepted', decidedAt: at, ...accepted }).where(eq(s.changeRequests.id, id));
    await audit(tx, actorId, req.kind === 'modification' ? 'ecr' : 'obsolete', req.docId, `${id} · ✓`);
    return { status: 'accepted', state: doc.state, legalHold: doc.legalHold };
  }
  await implementChange(tx, { ...req, ...accepted }, doc, actorId);
  return { status: 'implemented' };
}

/**
 * Applies the acceptance Vigie sent while the document was locked, once the lock has lifted (legal hold released,
 * archive restored). Nothing happens while the document is still locked or, for a change, while a revision is open:
 * the request stays 'accepted'.
 */
export async function applyPendingDecision(tx: Tx, docId: string) {
  const [req] = await tx.select().from(s.changeRequests).where(and(eq(s.changeRequests.docId, docId), eq(s.changeRequests.status, 'accepted')));
  if (!req) return;
  const [doc] = await tx.select().from(s.documents).where(eq(s.documents.id, docId));
  if (!doc || lockOf(doc) || (req.kind === 'modification' && doc.revWorking)) return;
  await implementChange(tx, req, doc, 'vigie');
}
