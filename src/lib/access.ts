import 'server-only';
import { cache } from 'react';
import { and, eq, inArray, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
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

// ── The same rules in SQL ───────────────────────────────────────────────
// Conditions on the row of `documents` of the query they go in (not aliased), so that lists, counts and pages are
// filtered by the database (lib/queries.ts searchDocs, explorerDocs, auditPage) instead of loading every document.
// Each subquery is uncorrelated: Postgres computes it once per query. The functions above stay the reference:
// tests/integration/access-sql.test.ts and seed-sql.test.ts check, person by person and role by role, that both
// select the same documents.

const docs = s.documents;
/** A text column JavaScript reads as true: neither null nor empty. */
const filled = (c: SQLWrapper) => sql`coalesce(${c}, '') <> ''`;

/** inDraftingCircle as an SQL condition: never null, so that it may be negated. */
export function draftingCircleSql(v: Viewer): SQL {
  if (v.seesAll) return sql`true`;
  const me = v.user.id;
  return sql`(${docs.ownerId} = ${me}
    or ${docs.id} in (select r.doc_id from revisions r where r.status in (${sql.join(OPEN_REVISION.map((x) => sql`${x}`), sql`, `)}) and r.modifier_id = ${me})
    or ${docs.id} in (select w.doc_id from workflows w join workflow_steps x on x.workflow_id = w.id
      where coalesce(w.outcome, '') = '' and x.assignee_id = ${me} and w.step < (select count(*) from workflow_steps y where y.workflow_id = w.id))
    or ${docs.id} in (select c.doc_id from change_requests c where c.kind = 'modification' and c.status = 'accepted' and c.modifier_id = ${me}))`;
}

/**
 * canRead as an SQL condition, never null. `circle`: draftingCircleSql(v), or a column already holding it. A project
 * team is the project's manager and whoever holds a function scoped to the project (buildAccessIndex).
 */
export function readableSql(v: Viewer, circle: SQL = draftingCircleSql(v)): SQL {
  if (v.seesAll) return sql`true`;
  if (!v.can('read')) return circle;
  const me = v.user.id;
  const named = sql`${docs.id} in (select r.doc_id from document_readers r where r.user_id = ${me})`;
  const team = sql`${docs.projectCode} in (select p.code from projects p
    where p.manager_id = ${me} or p.code in (select h.scope_value from function_holders h where h.user_id = ${me} and h.scope_value is not null))`;
  const department = v.user.department ? sql`${docs.department} = ${v.user.department} or ` : sql``;
  return sql`coalesce(${circle} or (${filled(docs.revInForce)} and (
    ${docs.conf} in ('public', 'restreint', 'interne')
    or (${docs.conf} = 'confidentiel' and (${department}${team} or ${named}))
    or (${docs.conf} = 'tres_confidentiel' and ${named})
  )), false)`;
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
 * May the browser keep the file it is shown, to ask again with its ETag rather than download it at every page of the
 * viewer? Only the final file of the revision in force below Confidentiel, which every reader of the document gets. Kept
 * copies are revalidated at each use (Cache-Control: no-cache), so access is checked again, but a browser's history may
 * show one again without asking: a draft (D-14) and a confidential or highly confidential file are never kept (no-store).
 */
export function browserMayKeep(revStatus: string, isFinal: boolean, conf: string): boolean {
  return readerMaySeeVersion(false, revStatus, isFinal) && !readersApply(conf);
}

/**
 * Who may look for files no working version points to and remove them (lib/orphans.ts): a records manager with access
 * to Administration. The stored names carry IDs and versions of drafts (`PRO-ING-0007_A.2.docx`), which only records
 * managers see whole (D-14).
 */
export function mayCleanStorage(ctx: Pick<Ctx, 'seesAll' | 'screens'>): boolean {
  return ctx.seesAll && ctx.screens.admin;
}

/**
 * Who may back up the database and files from Administration, and see the list of archives (lib/backup.ts): a records
 * manager with access to Administration. An archive holds every document, drafts included, and its manifest names the
 * stored files, whose names carry IDs and versions of drafts (D-14). Restoring is a command, run on the server.
 */
export function mayBackUp(ctx: Pick<Ctx, 'seesAll' | 'screens'>): boolean {
  return ctx.seesAll && ctx.screens.admin;
}

/**
 * Who may check the stored files against their SHA-256 from Administration (lib/integrity.ts) and read what the checks
 * found: a records manager with access to Administration. A check names the working versions it found altered or
 * missing, drafts included (D-14).
 */
export function mayCheckIntegrity(ctx: Pick<Ctx, 'seesAll' | 'screens'>): boolean {
  return ctx.seesAll && ctx.screens.admin;
}

/**
 * Who may download the full export (lib/full-export.ts, GET /api/export/full): a records manager with access to
 * Administration, as for a backup. The archive holds every document, drafts and confidential ones included, every
 * file and the whole journal, without any filter (D-14): it is an administration export, journaled at its start and end.
 */
export function mayExportAll(ctx: Pick<Ctx, 'seesAll' | 'screens'>): boolean {
  return ctx.seesAll && ctx.screens.admin;
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
 * May the user have the approval record of a revision (lib/approval.ts, « fiche de visa »)? Only once it was approved,
 * and only if they see it (readerMaySeeRevision): outside the drafting circle, the revision in force and those it
 * replaced (D-14). Reading the document itself (canRead) is checked apart.
 */
export function mayGetApprovalRecord(circle: boolean, rev: { status: string; approvedAt: string | null }): boolean {
  return !!rev.approvedAt && readerMaySeeRevision(circle, rev.status);
}

/**
 * Does the user follow a circuit: records managers follow every one, others the ones they take part in, as its
 * requester or the holder of one of its steps (after any delegation)? Only they open it in /validations (listWorkflows
 * `visible`, which also needs the document and the revision to be readable), comment on it, and read on the approval
 * record the text of its comments and who held the steps never decided. Whether they may read the document and see the
 * revision is checked apart.
 */
export function followsCircuit(ctx: Viewer, w: { requesterId: string }, steps: readonly { assigneeId: string }[]): boolean {
  return ctx.seesAll || w.requesterId === ctx.user.id || steps.some((x) => x.assigneeId === ctx.user.id);
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
 * What a revision being drafted expects from `userId` (G19), or null. Sent back to drafting by its last circuit
 * (`sentBack`, with the author of its drafting step and how the circuit ended): 'rejected' or 'recalled', for that
 * author, the designated modifier and the owner. Never submitted: 'eco' for the modifier an ECO designated (possibly
 * the owner); 'draft' for the owner otherwise, also when an ECO designated someone else to write it (the owner may still
 * send it for approval, mayWorkOnDraft). Whether the user may still work on it (mayWorkOnDraft, permissions, lock) is
 * checked apart.
 */
export function draftTodo(
  userId: string,
  rev: { modifierId: string | null },
  ownerId: string,
  sentBack: { authorId: string; outcome: 'rejected' | 'recalled' } | null,
): 'rejected' | 'recalled' | 'eco' | 'draft' | null {
  if (sentBack) return [sentBack.authorId, rev.modifierId, ownerId].includes(userId) ? sentBack.outcome : null;
  if (rev.modifierId === userId) return 'eco';
  return ownerId === userId ? 'draft' : null;
}

/**
 * May the user recall a running circuit (docs/modele-cible.md §6)? Its requester or a records manager, with the edit
 * permission that sent it for approval (lib/actions.ts requestValidation) and while they may work on the draft, as long
 * as it runs: the last approval ends it. The lock of the document is checked apart.
 */
export function mayRecall(ctx: Viewer, w: { requesterId: string; outcome: string | null }, d: AccessDoc, ix: AccessIndex): boolean {
  if (w.outcome || !ctx.can('edit')) return false;
  return (ctx.seesAll || w.requesterId === ctx.user.id) && mayWorkOnDraft(ctx, d, ix);
}

/**
 * Is the user the one to act on a review or expiry date of the document (G19)? Its owner, who may update the record
 * (lib/actions.ts updateMeta), record its review (recordReview) or ask for a change; its process owner, who may record
 * the review of a revision in force (mayRecordReview) and, for an expiry, only ask for a change (requestChange: a
 * revision in force, no request pending). Records managers follow every date in Archivage. The edit permission, the
 * lock and access to the document are checked apart.
 */
export function deadlineActor(userId: string, d: { ownerId: string; processOwnerId: string | null; revInForce: string | null }, kind: 'review' | 'expiry', changePending: boolean): boolean {
  if (d.ownerId === userId) return true;
  if (d.processOwnerId !== userId || !d.revInForce) return false;
  return kind === 'review' || !changePending;
}

/**
 * May the user record the periodic review of a document (lib/actions.ts recordReview)? Its owner, its process owner and
 * records managers, with the edit permission. Access to the document, its lock and its revision in force are checked
 * apart.
 */
export function mayRecordReview(ctx: Viewer, d: { ownerId: string; processOwnerId: string | null }): boolean {
  if (!ctx.can('edit')) return false;
  return ctx.seesAll || d.ownerId === ctx.user.id || d.processOwnerId === ctx.user.id;
}

/**
 * May the user manage retention (D-20): set a document's retention class, enter the date of its trigger event on any
 * document it reads, archive, freeze. The archive permission with the Archivage screen, as archiveDocuments.
 */
export function mayManageRetention(ctx: Pick<Ctx, 'can' | 'screens'>): boolean {
  return ctx.can('archive') && ctx.screens.retention;
}

/**
 * May the user enter the date of the event a document's retention counts from (lib/actions.ts setRetentionEvent)? Its
 * owner with the edit permission, while the record is editable (neither archived, obsolete nor frozen), or whoever
 * manages retention, on any record but a frozen one. Access to the document and the legal hold are checked apart.
 */
export function maySetRetentionEvent(ctx: Viewer & Pick<Ctx, 'screens'>, d: { ownerId: string; state: string; legalHold: boolean }): boolean {
  if (mayManageRetention(ctx)) return true;
  return ctx.can('edit') && d.ownerId === ctx.user.id && d.state === 'active' && !d.legalHold;
}

/**
 * May the user set the types a template is meant for (lib/actions.ts setTemplateTypes)? Only on a template (type FRM),
 * by its owner or a records manager, with the edit permission. Access to the document and its lock are checked apart.
 */
export function mayLinkTemplate(ctx: Viewer, d: { ownerId: string; typeCode: string }): boolean {
  if (d.typeCode !== TEMPLATE_TYPE || !ctx.can('edit')) return false;
  return ctx.seesAll || d.ownerId === ctx.user.id;
}

/**
 * May the user add or remove the links of this document (lib/actions.ts addDocLink, removeDocLink)? Its owner and
 * records managers, with the edit permission; a link needs it on both its documents, since it shows on both records.
 * Access to both and their legal hold are checked apart; an obsolete or archived document keeps receiving links, which
 * tell its readers where to go.
 */
export function mayEditLinks(ctx: Viewer, d: { ownerId: string }): boolean {
  return ctx.can('edit') && (ctx.seesAll || d.ownerId === ctx.user.id);
}

/**
 * Consultations (lib/lifecycle.ts journalConsultation): a record opened, a file shown in the preview. Left out of the
 * activity feeds and of the record's activity, which they would drown; the Journal tab and the record list them apart.
 */
export const CONSULT_ACTIONS = ['consult', 'view'] as const;

/**
 * Journal actions that only ever concern one revision (working versions, circuits, their recall and their comments,
 * entry into force, files, a change grafted onto the revision being drafted, the approval record issued for it, and
 * consultations: a record opened is tied to the revision in force, else the last superseded, else the latest).
 */
const REVISION_ACTIONS = new Set(['upload', 'working', 'import', 'reclass', 'request', 'approve', 'sign', 'reject', 'recall', 'delegate', 'comment', 'in_force', 'download', 'graft', 'visa', ...CONSULT_ACTIONS]);

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

// ── Saved searches ──────────────────────────────────────────────────────

type SavedSearchScope = { scope: string; ownerId: string; department: string | null };

/**
 * May the user share searches with a department or the whole group, and delete shared ones? Records managers and
 * whoever holds the admin permission.
 */
export function mayShareSearches(ctx: Viewer): boolean {
  return ctx.seesAll || ctx.can('admin');
}

/** May the user save a search with this scope? A personal one with the read permission; a shared one, mayShareSearches. */
export function maySaveSearch(ctx: Viewer, scope: string): boolean {
  if (!ctx.can('read')) return false;
  if (scope === 'personal') return true;
  return (scope === 'department' || scope === 'group') && mayShareSearches(ctx);
}

/**
 * Saved searches the user sees: their own personal ones, those shared with their department and those shared with the
 * whole group. Those who share also see the searches shared with other departments, to manage them. A saved search
 * holds criteria only: the documents it finds are always filtered by canRead.
 */
export function seesSavedSearch(ctx: Viewer, x: SavedSearchScope): boolean {
  if (x.scope === 'personal') return x.ownerId === ctx.user.id;
  if (x.scope === 'department') return (!!x.department && x.department === ctx.user.department) || mayShareSearches(ctx);
  return x.scope === 'group';
}

/**
 * seesSavedSearch as an SQL condition on saved_searches, so that a listing never loads other people's personal searches.
 * tests/integration/saved-searches.test.ts checks that both rules agree.
 */
export function savedSearchesSeenBy(ctx: Viewer): SQL {
  const x = s.savedSearches;
  const dept = mayShareSearches(ctx)
    ? eq(x.scope, 'department')
    : ctx.user.department ? and(eq(x.scope, 'department'), eq(x.department, ctx.user.department)) : undefined;
  return or(eq(x.scope, 'group'), and(eq(x.scope, 'personal'), eq(x.ownerId, ctx.user.id)), dept)!;
}

/** May the user delete a saved search? Their own personal ones; shared ones, mayShareSearches. */
export function mayDeleteSearch(ctx: Viewer, x: SavedSearchScope): boolean {
  if (x.scope === 'personal') return x.ownerId === ctx.user.id;
  return seesSavedSearch(ctx, x) && mayShareSearches(ctx);
}
