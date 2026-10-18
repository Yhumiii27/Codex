import 'server-only';
import { and, asc, eq, gte, inArray, isNull, lt, lte, ne, or } from 'drizzle-orm';
import { schema as s, type Db } from '@/db';
import type { AuditData, AuditTargetKind, LinkKind } from '@/db/schema';
import { buildAccessIndex, canRead, type AccessIndex } from './access';
import { nextLetter } from './codification';
import { nowStamp, todayIso } from './format';
import { DICT, MATRIX_ROLE, type Perm, type SimRole } from './i18n';
import { relOf, replacementOutcome, storedLink } from './links';
import { reviewAfter } from './review';

// Revision lifecycle (docs/modele-cible.md §4): draft → in_review → approved → in_force, previous in force → superseded.

export type Tx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

type DocRow = typeof s.documents.$inferSelect;
type RevRow = typeof s.revisions.$inferSelect;
type UserRow = typeof s.users.$inferSelect;

/** What a journal entry is about: a document (its current ID), or a target without document (administration, export). */
export type AuditSubject = string | { kind: AuditTargetKind; id: string };

/**
 * Appends an entry to the journal, stamped with the UTC instant; the journal is append-only (src/db/index.ts).
 * `revisionId`: the revision the entry is about, which decides who reads it (lib/access.ts, readerMaySeeEntry).
 * `data`: values before → after or export figures, stored as keys and rendered in the reader's language.
 */
export async function audit(tx: Tx, userId: string, action: string, subject: AuditSubject, detail = '', revisionId: number | null = null, data: AuditData | null = null) {
  const about = typeof subject === 'string' ? { docId: subject } : { targetKind: subject.kind, targetId: subject.id };
  await tx.insert(s.auditLog).values({ at: new Date().toISOString(), userId, action, ...about, detail, data, revisionId });
}

// ── Consultations ───────────────────────────────────────────────────────

/** Minutes during which the same consultation by the same user is journaled once (journalConsultation). */
export const CONSULT_WINDOW_MINUTES = 30;

/**
 * Journals a consultation: a record opened ('consult') or a file shown in the preview ('view'). Written once per user,
 * document, action, revision and detail (the version and format of a file) every CONSULT_WINDOW_MINUTES, counted from
 * the last entry written: paging through a preview, reloading the record or its revalidated file add nothing within
 * that time. True when an entry was written. PGlite runs one transaction at a time; on a server with several
 * connections, two requests at the same instant could each write one, which is harmless.
 */
export async function journalConsultation(db: Db, userId: string, action: 'consult' | 'view', docId: string, detail: string, revisionId: number | null): Promise<boolean> {
  const A = s.auditLog;
  const since = new Date(Date.now() - CONSULT_WINDOW_MINUTES * 60_000).toISOString();
  return db.transaction(async (tx) => {
    const [seen] = await tx.select({ id: A.id }).from(A)
      .where(and(eq(A.docId, docId), eq(A.userId, userId), eq(A.action, action), gte(A.at, since), eq(A.detail, detail), revisionId == null ? isNull(A.revisionId) : eq(A.revisionId, revisionId)))
      .limit(1);
    if (seen) return false;
    await audit(tx, userId, action, docId, detail, revisionId);
    return true;
  });
}

// ── Links between documents ─────────────────────────────────────────────

type LinkRow = { sourceId: string; targetId: string; kind: LinkKind };

/**
 * Journals a link added or removed on both its documents, by `actorId`: each entry says what that document is to the
 * other (lib/links.ts relOf) and names the other under its current ID. About the documents as a whole (no revision);
 * a reader who may not read the other document does not get the entry (lib/queries.ts auditForReader, D-14).
 * `detail`: what caused it, such as the change order of a withdrawal.
 */
export async function journalLink(tx: Tx, action: 'link' | 'unlink', link: LinkRow, actorId: string, detail = '') {
  for (const [docId, other] of [[link.sourceId, link.targetId], [link.targetId, link.sourceId]]) {
    await audit(tx, actorId, action, docId, detail, null, { link: { rel: relOf(link, docId), other } });
  }
}

/** The link between two documents, in either direction, or undefined. */
export async function linkBetween(tx: Tx, a: string, b: string) {
  const [l] = await tx.select().from(s.documentLinks).where(or(and(eq(s.documentLinks.sourceId, a), eq(s.documentLinks.targetId, b)), and(eq(s.documentLinks.sourceId, b), eq(s.documentLinks.targetId, a))));
  return l;
}

/**
 * Writes a link and journals it; false when the pair is already linked (a concurrent request wrote it first: the
 * database keeps one link per pair, document_links_pair).
 */
export async function addLink(tx: Tx, link: LinkRow, actorId: string, detail = ''): Promise<boolean> {
  const [row] = await tx.insert(s.documentLinks).values({ ...link, createdBy: actorId, createdAt: todayIso() }).onConflictDoNothing().returning({ id: s.documentLinks.id });
  if (!row) return false;
  await journalLink(tx, 'link', link, actorId, detail);
  return true;
}

/**
 * An accepted withdrawal makes the replacement proposed with it a « remplace » link (D-17): the withdrawn document is
 * « remplacé par » it, by Vigie, with its change order. Checked again now (lib/links.ts replacementOutcome): a
 * replacement no longer active, a legal hold on either document or a « remplace » link the other way leaves every link
 * as it is, and the withdrawn document's journal says the replacement was not applied, and why. Otherwise a « voir
 * aussi » link between the two gives way to it.
 */
async function linkReplacement(tx: Tx, doc: DocRow, replacementId: string, actorId: string, ref: string) {
  const [r] = await tx.select().from(s.documents).where(eq(s.documents.id, replacementId));
  const cur = await linkBetween(tx, doc.id, replacementId);
  const outcome = replacementOutcome(doc.id, doc, r, cur);
  if (outcome === 'present') return;
  if (outcome !== 'link') {
    await audit(tx, actorId, 'link_skipped', doc.id, ref, null, { link: { rel: 'replaced_by', other: replacementId, skipped: outcome } });
    return;
  }
  if (cur) {
    await tx.delete(s.documentLinks).where(eq(s.documentLinks.id, cur.id));
    await journalLink(tx, 'unlink', cur, actorId, ref);
  }
  await addLink(tx, storedLink(doc.id, 'replaced_by', replacementId), actorId, ref);
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
 * A document without a review date gets one from its type's periodicity, counted from that day (lib/review.ts); a date
 * already set is left as it is. A change Vigie accepted while this revision was open then opens the next one (D-26,
 * applyPendingDecision).
 */
export async function putInForce(tx: Tx, rev: RevRow, date: string) {
  const [cur] = await tx.select().from(s.revisions).where(eq(s.revisions.id, rev.id));
  if (!cur || cur.status === 'in_force') return;
  await tx.update(s.revisions).set({ status: 'superseded', supersededAt: date }).where(and(eq(s.revisions.docId, rev.docId), eq(s.revisions.status, 'in_force'), ne(s.revisions.id, rev.id)));
  await tx.update(s.revisions).set({ status: 'in_force', inForceAt: date, effectiveAt: cur.effectiveAt && cur.effectiveAt < date ? date : cur.effectiveAt }).where(eq(s.revisions.id, rev.id));
  const [d] = await tx.select().from(s.documents).where(eq(s.documents.id, rev.docId));
  const [type] = d && !d.reviewDueAt ? await tx.select({ reviewMonths: s.docTypes.reviewMonths }).from(s.docTypes).where(eq(s.docTypes.code, d.typeCode)) : [];
  const planned = type ? reviewAfter(date, type.reviewMonths) : null;
  await tx.update(s.documents).set({ issuedAt: d?.issuedAt ?? date, modifiedAt: date, ...(planned ? { reviewDueAt: planned } : {}) }).where(eq(s.documents.id, rev.docId));
  await audit(tx, 'codex', 'in_force', rev.docId, rev.letter, rev.id);
  // About the document as a whole, whose revision is now in force: every reader of the record sees it (D-14).
  if (d && planned) await audit(tx, 'codex', 'review_planned', rev.docId, rev.letter, null, { changes: [{ field: 'reviewDueAt', before: null, after: planned }], doc: { conf: d.conf, inForce: true } });
  await refreshHeadline(tx, rev.docId);
  await applyPendingDecision(tx, rev.docId);
}

/**
 * Cancels the revisions left open on a document (drafted, in review, approved waiting for their date). A change Vigie
 * accepted while one was open then opens the next revision, unless the document is locked (D-26, applyPendingDecision).
 * Today only an accepted withdrawal cancels revisions, after making the document obsolete: a change can then never apply.
 */
export async function cancelOpenRevisions(tx: Tx, docId: string): Promise<ModifierSwap | null> {
  await tx.update(s.revisions).set({ status: 'cancelled' }).where(and(eq(s.revisions.docId, docId), inArray(s.revisions.status, ['draft', 'in_review', 'approved'])));
  await refreshHeadline(tx, docId);
  return applyPendingDecision(tx, docId);
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
 * Approved revisions whose effective date has come enter into force: run by the scheduler (lib/scheduler.ts), or at the
 * start of each request while the scheduler does not run it (lib/context.ts). Only on active documents free of legal
 * hold: an archived, obsolete or frozen record never changes (same rule as lockOf). Returns how many entered into force.
 */
export async function promoteDue(db: Db): Promise<number> {
  const today = todayIso();
  let promoted = 0;
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
      promoted++;
    });
  }
  return promoted;
}

/**
 * Acceptances of Vigie still waiting ('accepted') although nothing holds them any more: the document is unlocked and, for
 * a change, no revision is open. Lifting a lock and putting a revision in force or cancelling it apply them at once
 * (applyPendingDecision); this catches one that a path not foreseen would have left waiting. Run by the scheduler; each
 * one in its own transaction, the document's row locked as applyChangeDecision does. Returns how many applied.
 */
export async function applyDuePendingDecisions(db: Db): Promise<number> {
  const waiting = await db
    .select({ id: s.changeRequests.id, docId: s.changeRequests.docId })
    .from(s.changeRequests)
    .innerJoin(s.documents, eq(s.documents.id, s.changeRequests.docId))
    .where(and(eq(s.changeRequests.status, 'accepted'), eq(s.documents.state, 'active'), eq(s.documents.legalHold, false)));
  let applied = 0;
  for (const { id, docId } of waiting) {
    await db.transaction(async (tx) => {
      await tx.select({ id: s.documents.id }).from(s.documents).where(eq(s.documents.id, docId)).for('update');
      await applyPendingDecision(tx, docId);
      const [after] = await tx.select({ status: s.changeRequests.status }).from(s.changeRequests).where(eq(s.changeRequests.id, id));
      if (after?.status === 'implemented') applied++;
    });
  }
  return applied;
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
 * Whether a person may draft a revision of the document opened by an ECO: not a system account, their default role may
 * upload (rights matrix in base, `perms` from defaultPerms), and they can read the document.
 */
function draftsFor(u: UserRow, perms: Set<Perm>, d: DocRow, ix: AccessIndex): boolean {
  if (u.isSystem || !perms.has('upload')) return false;
  return canRead({ user: u, seesAll: u.role === 'gestionnaire', can: (p: Perm) => perms.has(p) }, d, ix);
}

/**
 * Can the person draft the document (draftsFor)? The rule for the author Vigie names and for the default one. Being the
 * author of a change waiting to apply does not count: it is that very designation that is checked (buildAccessIndex).
 */
export async function mayDraft(tx: Tx, userId: string, d: DocRow): Promise<boolean> {
  const [u] = await tx.select().from(s.users).where(eq(s.users.id, userId));
  return !!u && draftsFor(u, await defaultPerms(tx, u.role), d, await buildAccessIndex(tx, { pending: false }));
}

/** People who may draft the document (draftsFor): the authors a simulated Vigie decision may designate. */
export async function draftersOf(tx: Tx, d: DocRow): Promise<string[]> {
  const [users, ix] = await Promise.all([tx.select().from(s.users).where(eq(s.users.isSystem, false)), buildAccessIndex(tx, { pending: false })]);
  const perms = new Map<string, Set<Perm>>();
  for (const role of new Set(users.map((u) => u.role))) perms.set(role, await defaultPerms(tx, role));
  return users.filter((u) => draftsFor(u, perms.get(u.role) ?? new Set(), d, ix)).map((u) => u.id);
}

/**
 * Author of a revision opened by an ECO when Vigie names nobody: the requester, if they may draft the document
 * (mayDraft); otherwise its owner.
 */
export async function defaultModifier(tx: Tx, requesterId: string, d: DocRow): Promise<string> {
  return (await mayDraft(tx, requesterId, d)) ? requesterId : d.ownerId;
}

export type ChangeDecisionError = 'not_found' | 'modifier_not_allowed';

type ChangeRow = typeof s.changeRequests.$inferSelect;

/**
 * What an accepted request waits for before it applies (applyPendingDecision): the document's state and hold, which may
 * lock it (lockOf), and for a change the letter of the revision already open, which must first enter into force or be
 * cancelled (D-26). Both may hold at once: nothing applies before the lock lifts.
 */
export type DecisionWait = Pick<DocRow, 'state' | 'legalHold'> & { revision: string | null };

export function decisionWait(kind: ChangeRow['kind'], d: Pick<DocRow, 'state' | 'legalHold' | 'revWorking'>): DecisionWait {
  return { state: d.state, legalHold: d.legalHold, revision: kind === 'modification' ? d.revWorking : null };
}

/**
 * What became of a decision: applied now ('rejected', 'implemented'), or an acceptance recorded ('accepted') while the
 * document is locked or, for a change, while a revision is already open, with what it waits for (decisionWait).
 */
export type ChangeDecisionResult = { error: ChangeDecisionError } | { status: 'rejected' | 'implemented' } | ({ status: 'accepted' } & DecisionWait);

/**
 * A pending acceptance whose designated author could no longer draft the document when it applied: `setAside` is that
 * author, `modifierId` the default one who took over (possibly the same person, the owner), and `mayDraft` whether the
 * latter can draft it.
 */
export type ModifierSwap = { setAside: string; modifierId: string; mayDraft: boolean };

/**
 * Carries out an accepted request on an unlocked document: a change opens the next revision for the modifier (the one
 * Vigie named, else the default one), a withdrawal closes the work in progress (running workflows end, open revisions are
 * cancelled) and makes the document obsolete, « remplacé par » the replacement proposed with the request, if any. The
 * request becomes 'implemented', a change linked to the revision it opened. `swap`: the designated author was set aside
 * for the default one (applyPendingDecision), which the journal records.
 */
async function implementChange(tx: Tx, req: ChangeRow, doc: DocRow, actorId: string, swap: ModifierSwap | null = null) {
  // Claimed first: a request applies once, even if two transactions reach it or applying it looks at the pending
  // decisions of the document again (cancelOpenRevisions).
  const [claimed] = await tx.update(s.changeRequests).set({ status: 'implemented' }).where(and(eq(s.changeRequests.id, req.id), inArray(s.changeRequests.status, ['submitted', 'accepted']))).returning({ id: s.changeRequests.id });
  if (!claimed) return;
  const at = nowStamp();
  const ref = req.ecoRef ?? req.id;
  let modifierId: string | null = null;
  let revisionId: number | null = null;
  if (req.kind === 'modification') {
    modifierId = req.modifierId ?? (await defaultModifier(tx, req.requesterId, doc));
    const rev = await openRevision(tx, req.docId, { modifierId, changeRef: ref });
    revisionId = rev.id;
    await audit(tx, actorId, 'ecr', req.docId, `${ref} → ${rev.letter}`, rev.id);
    if (swap) {
      const names = new Map((await tx.select({ id: s.users.id, name: s.users.name }).from(s.users).where(inArray(s.users.id, [swap.setAside, swap.modifierId]))).map((u) => [u.id, u.name]));
      // Also written when the default author is the one set aside or cannot draft either: the substitution is never silent.
      const denied = swap.mayDraft ? '' : ` (${DICT.fr.not_allowed} : ${DICT.fr.perm_upload})`;
      await audit(tx, 'codex', 'ecr', req.docId, `${ref} · ${names.get(swap.setAside) ?? swap.setAside} → ${names.get(swap.modifierId) ?? swap.modifierId}${denied}`, rev.id);
    }
  } else {
    const running = await tx.select().from(s.workflows).where(and(eq(s.workflows.docId, doc.id), isNull(s.workflows.outcome)));
    for (const w of running) {
      await tx.update(s.workflows).set({ outcome: 'rejected', closedBy: actorId, closedAt: at.slice(0, 10) }).where(eq(s.workflows.id, w.id));
      await tx.insert(s.workflowComments).values({ workflowId: w.id, authorId: actorId, at: at.slice(0, 10), text: { fr: `Circuit clos — document retiré (${ref}).`, en: `Workflow closed — document withdrawn (${ref}).` } });
      await audit(tx, actorId, 'reject', doc.id, w.id, w.revisionId);
    }
    // Obsolete first: the document is locked for good when its open revisions are cancelled.
    await tx.update(s.documents).set({ state: 'obsolete', obsoleteAt: at.slice(0, 10), modifiedAt: at.slice(0, 10) }).where(eq(s.documents.id, req.docId));
    await cancelOpenRevisions(tx, req.docId);
    await audit(tx, actorId, 'obsolete', req.docId, ref);
    if (req.replacementId) await linkReplacement(tx, doc, req.replacementId, actorId, ref);
  }
  // decidedAt stays the date of Vigie's decision when it was recorded before it could apply.
  await tx.update(s.changeRequests).set({ decidedAt: req.decidedAt ?? at, ecoRef: req.ecoRef, modifierId, revisionId, decisionNote: req.decisionNote }).where(eq(s.changeRequests.id, req.id));
}

/**
 * Applies Vigie's decision on a change request (webhook or simulation). A refusal always applies. An acceptance applies
 * at once to an active document free of legal hold. Otherwise it is recorded as 'accepted' with its change order,
 * modifier and note, and applied later (applyPendingDecision): on a locked document (archived, obsolete, frozen), when
 * the lock lifts; for a change while a revision is already open, when that revision enters into force or is cancelled
 * (D-26: a change never opens a second revision beside one already open; it may instead be grafted onto it while it is
 * drafted, graftChange in lib/actions.ts). The author Vigie names must be able to draft the document (mayDraft):
 * nothing is written otherwise.
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
  // Row locked: what the acceptance waits for (lock, open revision) is read on the document that putInForce,
  // cancelOpenRevisions, releaseHold and restoring an archive update before looking at the pending decisions. Either
  // they see the acceptance once recorded, or it sees the document they left and applies at once: never left waiting.
  const [doc] = await tx.select().from(s.documents).where(eq(s.documents.id, req.docId)).for('update');
  if (!doc) return { error: 'not_found' };
  if (req.kind === 'modification' && decision.modifierId && !(await mayDraft(tx, decision.modifierId, doc))) return { error: 'modifier_not_allowed' };
  const accepted = { ecoRef: decision.ecoRef ?? null, modifierId: req.kind === 'modification' ? decision.modifierId ?? null : null, decisionNote: decision.note ?? null };
  const wait = decisionWait(req.kind, doc);
  if (lockOf(doc) || wait.revision) {
    await tx.update(s.changeRequests).set({ status: 'accepted', decidedAt: at, ...accepted }).where(eq(s.changeRequests.id, id));
    await audit(tx, actorId, req.kind === 'modification' ? 'ecr' : 'obsolete', req.docId, `${id} · ✓`);
    return { status: 'accepted', ...wait };
  }
  await implementChange(tx, { ...req, ...accepted }, doc, actorId);
  return { status: 'implemented' };
}

/**
 * Applies an acceptance Vigie sent while it could not apply (applyChangeDecision), once nothing holds it any more: the
 * lock has lifted (legal hold released, archive restored) and, for a change, the revision that was open has entered
 * into force or been cancelled (putInForce, cancelOpenRevisions). Until then the request stays 'accepted'; once applied
 * or grafted it is 'implemented', so it never applies twice. Rights may have changed since Vigie named the author: one
 * who can no longer draft the document gives way to the default author rather than leave the decision stuck. The
 * default author is checked in turn; the revision opens for them even when they cannot draft it either (a records
 * manager may still upload to it), but the journal records the substitution in every case. Returns it, for the person
 * who lifted the lock.
 */
export async function applyPendingDecision(tx: Tx, docId: string): Promise<ModifierSwap | null> {
  const [req] = await tx.select().from(s.changeRequests).where(and(eq(s.changeRequests.docId, docId), eq(s.changeRequests.status, 'accepted')));
  if (!req) return null;
  const [doc] = await tx.select().from(s.documents).where(eq(s.documents.id, docId));
  if (!doc || lockOf(doc) || decisionWait(req.kind, doc).revision) return null;
  if (req.kind !== 'modification' || !req.modifierId || (await mayDraft(tx, req.modifierId, doc))) {
    await implementChange(tx, req, doc, 'vigie');
    return null;
  }
  const modifierId = await defaultModifier(tx, req.requesterId, doc);
  const swap = { setAside: req.modifierId, modifierId, mayDraft: modifierId !== req.modifierId && (await mayDraft(tx, modifierId, doc)) };
  await implementChange(tx, { ...req, modifierId }, doc, 'vigie', swap);
  return swap;
}
