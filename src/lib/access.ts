import 'server-only';
import { cache } from 'react';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, schema as s, type Db } from '@/db';
import type { Conf } from '@/db/schema';
import { TEMPLATE_TYPE } from './codes';
import type { Ctx } from './context';

// Who sees what (docs/modele-cible.md §5).

type AccessDoc = { id: string; ownerId: string; department: string; projectCode: string | null; conf: string; state: string; revInForce: string | null };
type Q = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/** The person whose access is checked: the simulated user, or another person (default modifier of an accepted ECO). */
export type Viewer = Pick<Ctx, 'user' | 'seesAll' | 'can'>;

/** Revision statuses of a revision open on a document: drafted, under review, approved waiting for its effective date. */
const OPEN_REVISION = ['draft', 'in_review', 'approved'] as const;
type OpenStatus = (typeof OPEN_REVISION)[number];
const isOpenRevision = (status: string | null | undefined): status is OpenStatus => (OPEN_REVISION as readonly string[]).includes(status ?? '');

/**
 * People around each document: named readers, designated authors of open revisions, authors Vigie designated for an
 * accepted change that waits to open the next one (`designated`; D-14: whoever « modifiera un document via une ECO »,
 * D-26), approvers of running workflows, project teams. Built from `q` (a transaction inside lib/lifecycle.ts);
 * getAccessIndex() caches it per request. `pending: false` leaves the waiting changes out: whether their author may
 * still draft the document must not rest on that very designation (lib/lifecycle.ts mayDraft).
 */
export async function buildAccessIndex(q: Q, { pending = true }: { pending?: boolean } = {}) {
  const [readers, revs, waiting, wfs, steps, holders, projects] = await Promise.all([
    q.select().from(s.documentReaders),
    q.select({ docId: s.revisions.docId, modifierId: s.revisions.modifierId, status: s.revisions.status }).from(s.revisions).where(inArray(s.revisions.status, [...OPEN_REVISION])),
    pending
      ? q.select({ docId: s.changeRequests.docId, modifierId: s.changeRequests.modifierId }).from(s.changeRequests).where(and(eq(s.changeRequests.kind, 'modification'), eq(s.changeRequests.status, 'accepted')))
      : [],
    q.select().from(s.workflows),
    q.select({ workflowId: s.workflowSteps.workflowId, idx: s.workflowSteps.idx, assigneeId: s.workflowSteps.assigneeId }).from(s.workflowSteps),
    q.select().from(s.functionHolders),
    q.select({ code: s.projects.code, managerId: s.projects.managerId }).from(s.projects),
  ]);
  const add = (m: Map<string, Set<string>>, k: string, v: string | null) => { if (!v) return; if (!m.has(k)) m.set(k, new Set()); m.get(k)!.add(v); };
  const readersBy = new Map<string, Set<string>>(), modifiersBy = new Map<string, Set<string>>(), designatedBy = new Map<string, Set<string>>();
  const approversBy = new Map<string, Set<string>>(), teamBy = new Map<string, Set<string>>();
  readers.forEach((r) => add(readersBy, r.docId, r.userId));
  revs.forEach((r) => add(modifiersBy, r.docId, r.modifierId));
  waiting.forEach((r) => add(designatedBy, r.docId, r.modifierId));
  for (const w of wfs) {
    const ws = steps.filter((x) => x.workflowId === w.id);
    if (w.outcome || w.step >= ws.length) continue; // finished or rejected workflows no longer open drafts to their approvers
    ws.forEach((x) => add(approversBy, w.docId, x.assigneeId));
  }
  projects.forEach((p) => add(teamBy, p.code, p.managerId));
  holders.filter((h) => h.scopeValue && projects.some((p) => p.code === h.scopeValue)).forEach((h) => add(teamBy, h.scopeValue!, h.userId));
  const none = new Set<string>();
  return {
    readers: (docId: string) => readersBy.get(docId) ?? none,
    modifiers: (docId: string) => modifiersBy.get(docId) ?? none,
    designated: (docId: string) => designatedBy.get(docId) ?? none,
    approvers: (docId: string) => approversBy.get(docId) ?? none,
    team: (projectCode: string | null) => (projectCode ? teamBy.get(projectCode) ?? none : none),
  };
}
export type AccessIndex = Awaited<ReturnType<typeof buildAccessIndex>>;

export const getAccessIndex = cache(async () => buildAccessIndex(await getDb()));

/**
 * Owner, designated author (of the open revision, or of an accepted change waiting for it, D-26), current approvers and
 * records managers: they see drafts and working versions (D-14).
 */
export function inDraftingCircle(ctx: Viewer, d: AccessDoc, ix: AccessIndex): boolean {
  return mayWorkOnDraft(ctx, d, ix) || ix.designated(d.id).has(ctx.user.id);
}

/**
 * Who may add working versions to the revision being drafted and send it for approval: the drafting circle, except the
 * author Vigie designated for a change waiting for that revision. He sees it (D-14) but writes the next one; taking
 * his change into the open revision is a graft, which is chosen on the record (D-26, lib/actions.ts graftChange).
 */
export function mayWorkOnDraft(ctx: Viewer, d: AccessDoc, ix: AccessIndex): boolean {
  const me = ctx.user.id;
  return ctx.seesAll || d.ownerId === me || ix.modifiers(d.id).has(me) || ix.approvers(d.id).has(me);
}

/** Named readers count for confidential and highly confidential documents only. */
export function readersApply(conf: string): boolean {
  return conf === 'confidentiel' || conf === 'tres_confidentiel';
}

/**
 * Can the user see the document at all (its revision in force, or its drafts if they belong to the drafting circle)?
 * Outside the drafting circle, the "read" permission of the matrix is required as well.
 */
export function canRead(ctx: Viewer, d: AccessDoc, ix: AccessIndex): boolean {
  if (inDraftingCircle(ctx, d, ix)) return true;
  if (!ctx.can('read')) return false;
  const me = ctx.user.id;
  // A document that never entered into force is a draft: only its drafting circle sees it.
  if (!d.revInForce) return false;
  switch (d.conf as Conf) {
    case 'public':
    case 'restreint':
    case 'interne':
      return true;
    case 'confidentiel':
      return ctx.user.department === d.department || ix.team(d.projectCode).has(me) || ix.readers(d.id).has(me);
    case 'tres_confidentiel':
      return ix.readers(d.id).has(me);
    default:
      return false;
  }
}

/** A template offered by "Nouveau depuis un modèle" and accepted by createDocument: FRM in force, active, visible. */
export function isUsableTemplate(ctx: Viewer, d: AccessDoc & { typeCode: string }, ix: AccessIndex): boolean {
  return d.typeCode === TEMPLATE_TYPE && !!d.revInForce && d.state === 'active' && canRead(ctx, d, ix);
}

/** Outside the drafting circle, only the final file of the revision in force is served or listed (§5). */
export function readerMaySeeVersion(circle: boolean, revStatus: string, isFinal: boolean): boolean {
  return circle || (revStatus === 'in_force' && isFinal);
}

/**
 * Revisions every reader of the document sees: the one in force and those it replaced. A draft, a revision under review
 * or waiting for its effective date, and a cancelled one belong to the drafting circle (D-14): outside it, they do not
 * exist, nor do their workflows, comments, designated author or change order.
 */
export function readerMaySeeRevision(circle: boolean, revStatus: string | null | undefined): boolean {
  return circle || revStatus === 'in_force' || revStatus === 'superseded';
}

/**
 * Does a reader see the change order and designated author of a change request (D-14)? Outside the drafting circle,
 * only once the revision carrying the change (the one it opened, or the open one it was grafted onto, D-26) is in force
 * or superseded; never while an accepted change waits to apply, which would tell a revision is open or about to open.
 */
export function readerMaySeeChange(circle: boolean, r: { kind: string; status: string; revisionId: number | null }, revStatus: string | null | undefined): boolean {
  if (circle) return true;
  if (r.kind === 'modification' && r.status === 'accepted') return false;
  return r.revisionId == null || readerMaySeeRevision(false, revStatus);
}

/**
 * A change request as a reader of its document sees it (D-14). When readerMaySeeChange says no, it names neither its
 * change order, its designated author nor its revision. A change grafted onto a revision the reader does not see (`rev`
 * carries another change order: the change did not open it, D-26) also keeps the status it had before the graft,
 * « Acceptée », while that revision is open: turning « Appliquée » with nothing entering into force would tell that a
 * hidden revision took it up. Once that revision is cancelled (an accepted withdrawal), the change will never apply:
 * it shows « Appliquée », like the change that opened the revision, rather than wait for good.
 * A change shown « Appliquée » while its revision is hidden also loses its decision date: applied at once, that date is
 * when the hidden revision opened, and the journal entry recording it follows that revision (readerMaySeeEntry). The
 * acceptance date of a change shown « Acceptée » stays: its journal entry concerns the document and is shown.
 */
export function changeAsSeen<R extends { id: string; kind: string; status: string; ecoRef: string | null; modifierId: string | null; revisionId: number | null; decidedAt: string | null }>(
  circle: boolean,
  r: R,
  rev: { status: string; changeRef: string | null } | null | undefined,
): R {
  if (readerMaySeeChange(circle, r, rev?.status)) return r;
  const grafted = r.kind === 'modification' && r.status === 'implemented' && !!rev && isOpenRevision(rev.status) && rev.changeRef !== (r.ecoRef ?? r.id);
  const masked = { ...r, ecoRef: null, modifierId: null, revisionId: null };
  return grafted ? { ...masked, status: 'accepted' } : r.status === 'implemented' ? { ...masked, decidedAt: null } : masked;
}

/**
 * The revision open on a document as its record shows it (D-14, D-26). `open`: told to whoever asks for a change now
 * (what an acceptance would do). `wait`: the revision an accepted change waits for (`awaiting`, as listChangeRequests
 * gives it), who writes it, and whether the user may graft the change onto it instead: 'yes' for a records manager or
 * the author of that revision (its designated modifier, else the owner; lib/actions.ts graftChange) while it is drafted,
 * 'reserved' for anyone else, 'in_review' or 'approved' when it can only wait. A lock or a missing permission is the
 * record's to add. Outside the drafting circle no revision is open: neither is given.
 */
export type OpenRevisionView = {
  open: { letter: string; status: OpenStatus } | null;
  wait: { letter: string; author: string; graft: 'yes' | 'reserved' | Exclude<OpenStatus, 'draft'> } | null;
};

export function openRevisionView(
  circle: boolean,
  viewer: Pick<Viewer, 'user' | 'seesAll'>,
  ownerId: string,
  working: { letter: string; status: string; modifierId: string | null } | null | undefined,
  awaiting: { kind: string; status: string } | null | undefined,
): OpenRevisionView {
  const status = working?.status;
  if (!circle || !working || !isOpenRevision(status)) return { open: null, wait: null };
  const open = { letter: working.letter, status };
  if (awaiting?.kind !== 'modification' || awaiting.status !== 'accepted') return { open, wait: null };
  const author = working.modifierId ?? ownerId;
  const graft = status !== 'draft' ? status : viewer.seesAll || author === viewer.user.id ? 'yes' : 'reserved';
  return { open, wait: { letter: working.letter, author, graft } };
}

/**
 * What a revision being drafted expects from `userId` (G19), or null. Sent back to drafting by a circuit (`rejection`,
 * with the author of its drafting step): 'rejected', for that author, the designated modifier and the owner. Never
 * submitted: 'eco' for the modifier an ECO designated (possibly the owner); 'draft' for the owner otherwise, also when
 * an ECO designated someone else to write it (the owner may still send it for approval, mayWorkOnDraft). Whether the
 * user may still work on it (mayWorkOnDraft, permissions, lock) is checked apart.
 */
export function draftTodo(userId: string, rev: { modifierId: string | null }, ownerId: string, rejection: { authorId: string } | null): 'rejected' | 'eco' | 'draft' | null {
  if (rejection) return [rejection.authorId, rev.modifierId, ownerId].includes(userId) ? 'rejected' : null;
  if (rev.modifierId === userId) return 'eco';
  return ownerId === userId ? 'draft' : null;
}

/**
 * Is the user the one to act on a review or expiry date of the document (G19)? Its owner, who may update the record
 * (lib/actions.ts updateMeta) or ask for a change; its process owner, who may only ask for a change (requestChange: a
 * revision in force, no request pending). Records managers follow every date in Archivage. The edit permission, the
 * lock and access to the document are checked apart.
 */
export function deadlineActor(userId: string, d: { ownerId: string; processOwnerId: string | null; revInForce: string | null }, changePending: boolean): boolean {
  if (d.ownerId === userId) return true;
  return d.processOwnerId === userId && !!d.revInForce && !changePending;
}

/**
 * Journal actions that only ever concern one revision (working versions, circuits and their comments, entry into force,
 * files, a change grafted onto the revision being drafted).
 */
const REVISION_ACTIONS = new Set(['upload', 'working', 'import', 'reclass', 'request', 'approve', 'sign', 'reject', 'delegate', 'comment', 'in_force', 'download', 'graft']);

/**
 * Journal entries outside the drafting circle (D-14). An entry about a revision records it (audit_log.revision_id) and
 * follows it: shown once that revision is in force or superseded (readerMaySeeRevision), hidden while it is drafted,
 * reviewed, waiting for its effective date, or after it was cancelled. An entry without a revision concerns the document
 * as a whole (metadata, readers, change requests and their refusal, withdrawal, hold, archiving) and is shown, unless
 * its action only ever concerns a revision: the revision is then unknown, and the entry stays hidden.
 * `revStatus` is the status of the entry's revision, undefined when that revision cannot be found.
 */
export function readerMaySeeEntry(circle: boolean, e: { action: string; revisionId: number | null }, revStatus: string | undefined): boolean {
  if (circle) return true;
  if (e.revisionId == null) return !REVISION_ACTIONS.has(e.action);
  return readerMaySeeRevision(false, revStatus);
}
