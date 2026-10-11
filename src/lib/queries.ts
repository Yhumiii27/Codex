import 'server-only';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { getDb, schema as s } from '@/db';
import type { AuditChange, AuditData, AuditTargetKind, AuditValue, Conf } from '@/db/schema';
import { canRead, changeAsSeen, getAccessIndex, inDraftingCircle, isUsableTemplate, readerMaySeeEntry, readerMaySeeRevision, type AccessIndex } from './access';
import { revLabel } from './codification';
import type { Ctx } from './context';
import { addDays, daysBetween, fmtDate, fmtSize, fmtWhen, loc, parisStamp, todayIso } from './format';
import { CONF_LEVELS, MATRIX_ROLE_LABEL, TAGCLS, type T, type TKey } from './i18n';
import { lockOf, type DecisionWait } from './lifecycle';
import { retainUntil } from './retention';
import { FACET_KEYS, type FacetKey } from './search';

type DocRow = typeof s.documents.$inferSelect;

/**
 * `workingL`: label of the revision being drafted with its last working version ("B.2"), see workingLabels().
 * `circle`: whether the user belongs to the document's drafting circle; outside it, no revision is being drafted (D-14).
 * `shownModified`: outside the circle, the date of the last change the user may see (visibleModified), when it differs.
 */
export function docView(ctx: Ctx, d: DocRow, workingL: string | null | undefined, circle: boolean, shownModified?: string) {
  const { t, lang, label } = ctx;
  const revWorking = circle ? d.revWorking : null;
  const modifiedAt = (!circle && shownModified) || d.modifiedAt;
  const typeLabel = label('type', d.typeCode), familyLabel = label('family', d.family);
  const contextL = d.attachment === 'project' ? `${d.projectCode} · ${label('project', d.projectCode)}` : d.attachment === 'research' ? `${d.programCode} · ${label('program', d.programCode)}` : label('department', d.department);
  const until = retainUntil(d);
  const years = d.retentionYears != null ? `${d.retentionYears} ${t.years_short} · ` : '';
  return {
    ...d,
    revWorking,
    modifiedAt,
    typeLabel, familyLabel, contextL,
    departmentL: label('department', d.department),
    siteL: d.site ? label('site', d.site) : '—',
    originL: t[`or_${d.origin}` as TKey],
    attachmentL: t[`att_${d.attachment}` as TKey],
    statusLabel: t[`st_${d.status}` as TKey] ?? d.status,
    tagClass: TAGCLS[d.status] ?? 'tag tag-neutral',
    confL: t[`conf_${d.conf}` as TKey] ?? d.conf,
    owner: ctx.userName(d.ownerId),
    author: d.authorText || ctx.userName(d.authorId ?? d.ownerId),
    /** Revision being drafted or reviewed, with its last working version ("B.2"); null when none. */
    workingLabel: revWorking ? workingL ?? revWorking : null,
    /** Revision shown in lists: the one in force, else the one being drafted. */
    rev: d.revInForce ?? (revWorking ? workingL ?? revWorking : '—'),
    /** Project or research programme code the document is attached to. */
    attachedCode: d.attachment === 'project' ? d.projectCode : d.attachment === 'research' ? d.programCode : null,
    modifiedF: fmtDate(modifiedAt, lang),
    createdF: fmtDate(d.createdAt, lang),
    issuedF: fmtDate(d.issuedAt, lang),
    expiresF: fmtDate(d.expiresAt, lang),
    reviewDueF: fmtDate(d.reviewDueAt, lang),
    retainUntil: until,
    untilF: until ? fmtDate(until, lang) : d.retentionTrigger === 'permanent' || d.retentionDisposition === 'permanent' ? t.disp_permanent : '—',
    retentionL: `${years}${t[`trig_${d.retentionTrigger}` as TKey]} · ${t[`disp_${d.retentionDisposition}` as TKey]}`,
    path: `${contextL} › ${familyLabel} › ${typeLabel}`,
    href: `/documents/${encodeURIComponent(d.id)}`,
  };
}
export type DocView = ReturnType<typeof docView>;

/** Label ("B.2", or "B" before any working version) of the revision being drafted or reviewed, per document. */
async function workingLabels(docId?: string): Promise<Map<string, string>> {
  const db = await getDb();
  const open = inArray(s.revisions.status, ['draft', 'in_review', 'approved']);
  const [revs, vs] = await Promise.all([
    db.select({ id: s.revisions.id, docId: s.revisions.docId, letter: s.revisions.letter, status: s.revisions.status }).from(s.revisions).where(docId ? and(open, eq(s.revisions.docId, docId)) : open),
    db.select({ revisionId: s.workingVersions.revisionId, n: s.workingVersions.n }).from(s.workingVersions).where(docId ? eq(s.workingVersions.docId, docId) : undefined),
  ]);
  const maxN = new Map<number, number>();
  vs.forEach((v) => maxN.set(v.revisionId, Math.max(maxN.get(v.revisionId) ?? 0, v.n)));
  return new Map(revs.map((r) => [r.docId, maxN.has(r.id) ? revLabel(r.letter, r.status, maxN.get(r.id)) : r.letter]));
}

/** Journal actions on the record itself (no revision) that move documents.modified_at. */
const RECORD_ACTIONS = ['edit', 'archive', 'restore'];

/**
 * documents.modified_at also moves with drafting work (working versions, validation requests). Outside the drafting
 * circle (D-14), a document with an open revision is dated by the last change its readers see instead: the entry into
 * force of its current revision, or a later change of the record itself (metadata, readers, archiving, restoration).
 */
async function visibleModified(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const db = await getDb();
  const [revs, entries] = await Promise.all([
    db.select({ docId: s.revisions.docId, at: s.revisions.inForceAt }).from(s.revisions).where(and(inArray(s.revisions.docId, ids), eq(s.revisions.status, 'in_force'))),
    db.select({ docId: s.auditLog.docId, at: s.auditLog.at }).from(s.auditLog).where(and(inArray(s.auditLog.docId, ids), isNull(s.auditLog.revisionId), inArray(s.auditLog.action, RECORD_ACTIONS))),
  ]);
  const later = (docId: string, at: string | null) => { if (at && at > (out.get(docId) ?? '')) out.set(docId, at); };
  revs.forEach((r) => later(r.docId, r.at));
  entries.forEach((e) => e.docId && later(e.docId, parisStamp(e.at).slice(0, 10)));
  return out;
}

/** Documents the current user may see (records managers: all), most recently modified first. */
export async function listDocs(ctx: Ctx, opts: { includeHidden?: boolean } = {}): Promise<DocView[]> {
  const db = await getDb();
  const [rows, ix, wl] = await Promise.all([db.select().from(s.documents).orderBy(desc(s.documents.modifiedAt), desc(s.documents.id)), getAccessIndex(), workingLabels()]);
  const shown = rows.filter((d) => opts.includeHidden || canRead(ctx, d, ix)).map((d) => ({ d, circle: inDraftingCircle(ctx, d, ix) }));
  const vm = await visibleModified(shown.filter((x) => !x.circle && x.d.revWorking).map((x) => x.d.id));
  const docs = shown.map((x) => docView(ctx, x.d, wl.get(x.d.id), x.circle, vm.get(x.d.id)));
  // Dates shown outside the drafting circle may differ from modified_at: sort again on what the user sees.
  if (vm.size) docs.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return docs;
}

/** One document, with what the user may do with its drafts. Returns `hidden` when it exists but is not visible. */
export async function getDoc(ctx: Ctx, id: string): Promise<{ doc: DocView; circle: boolean; ix: AccessIndex } | 'hidden' | null> {
  const db = await getDb();
  let [d] = await db.select().from(s.documents).where(eq(s.documents.id, id));
  if (!d) {
    // Former IDs (reclassification, migration) still resolve.
    const all = await db.select().from(s.documents);
    d = all.find((x) => x.aliases.includes(id))!;
    if (!d) return null;
  }
  const ix = await getAccessIndex();
  if (!canRead(ctx, d, ix)) return 'hidden';
  const circle = inDraftingCircle(ctx, d, ix);
  const [wl, vm] = await Promise.all([workingLabels(d.id), visibleModified(!circle && d.revWorking ? [d.id] : [])]);
  return { doc: docView(ctx, d, wl.get(d.id), circle, vm.get(d.id)), circle, ix };
}

/**
 * Revisions (newest first) with their working versions (newest first) and the change orders they carry: the one that
 * opened them, then those grafted onto them (D-26). Callers show a revision only to who may see it (readerMaySeeRevision).
 */
export async function listRevisions(ctx: Ctx, docId: string) {
  const db = await getDb();
  const [revs, versions, carried] = await Promise.all([
    db.select().from(s.revisions).where(eq(s.revisions.docId, docId)).orderBy(desc(s.revisions.id)),
    db.select().from(s.workingVersions).where(eq(s.workingVersions.docId, docId)).orderBy(desc(s.workingVersions.n)),
    db.select({ revisionId: s.changeRequests.revisionId, ref: sql<string>`coalesce(${s.changeRequests.ecoRef}, ${s.changeRequests.id})` }).from(s.changeRequests)
      .where(and(eq(s.changeRequests.docId, docId), isNotNull(s.changeRequests.revisionId))).orderBy(asc(s.changeRequests.decidedAt), asc(s.changeRequests.id)),
  ]);
  return revs.map((r) => {
    const vs = versions.filter((v) => v.revisionId === r.id).map((v) => ({
      ...v,
      label: `${r.letter}.${v.n}`,
      commentL: loc(v.comment, ctx.lang),
      author: ctx.userName(v.authorId),
      dateF: fmtDate(v.date, ctx.lang),
      sizeF: fmtSize(v.size, ctx.lang),
    }));
    const last = vs[0] ?? null;
    return {
      ...r,
      label: last ? revLabel(r.letter, r.status, last.n) : r.letter,
      statusLabel: ctx.t[`st_${r.status}` as TKey],
      tagClass: TAGCLS[r.status] ?? 'tag tag-neutral',
      modifier: r.modifierId ? ctx.userName(r.modifierId) : null,
      changeRefs: [...new Set([...(r.changeRef ? [r.changeRef] : []), ...carried.filter((c) => c.revisionId === r.id).map((c) => c.ref)])],
      effectiveF: fmtDate(r.effectiveAt, ctx.lang),
      approvedF: fmtDate(r.approvedAt, ctx.lang),
      inForceF: fmtDate(r.inForceAt, ctx.lang),
      supersededF: fmtDate(r.supersededAt, ctx.lang),
      createdF: fmtDate(r.createdAt, ctx.lang),
      versions: vs,
      /** File that represents the revision: its last working version. */
      file: last,
    };
  });
}
export type RevisionView = Awaited<ReturnType<typeof listRevisions>>[number];

// ── Workflows ────────────────────────────────────────────────────────────

export async function listWorkflows(ctx: Ctx) {
  const db = await getDb();
  const [wfs, steps, comments, docs, revs, ix] = await Promise.all([
    db.select().from(s.workflows).orderBy(asc(s.workflows.due), asc(s.workflows.id)),
    db.select().from(s.workflowSteps).orderBy(asc(s.workflowSteps.idx)),
    db.select().from(s.workflowComments).orderBy(asc(s.workflowComments.id)),
    db.select().from(s.documents),
    db.select({ id: s.revisions.id, letter: s.revisions.letter, status: s.revisions.status }).from(s.revisions),
    getAccessIndex(),
  ]);
  const docBy = new Map(docs.map((d) => [d.id, d]));
  const revBy = new Map(revs.map((r) => [r.id, r]));
  const { t, lang } = ctx;
  return wfs.map((w) => {
    const ws = steps.filter((x) => x.workflowId === w.id).map((st) => {
      const state = st.idx < w.step ? 'done' : st.idx === w.step ? 'current' : 'todo';
      return {
        ...st,
        nameL: loc(st.name, lang),
        assignee: ctx.userName(st.assigneeId),
        state: state as 'done' | 'current' | 'todo',
        stateLabel: t[`st_${state}` as TKey],
        dateF: st.date ? fmtDate(st.date, lang) : '',
      };
    });
    const cur = ws[w.step];
    const involved = w.requesterId === ctx.user.id || ws.some((x) => x.assigneeId === ctx.user.id);
    const doc = docBy.get(w.docId);
    const rev = revBy.get(w.revisionId);
    return {
      ...w,
      docTitle: doc?.title ?? w.docId,
      typeCode: doc?.typeCode ?? '',
      /** Why nobody can decide right now (document archived, obsolete or under legal hold), or null. */
      locked: doc ? lockOf(doc) : null,
      letter: rev?.letter ?? '',
      revStatus: rev?.status ?? null,
      requester: ctx.userName(w.requesterId),
      dueF: fmtDate(w.due, lang),
      steps: ws,
      current: cur ?? null,
      stepName: w.outcome === 'rejected' ? t.wf_rejected : cur && !w.outcome ? cur.nameL : t.wf_finished,
      /** Over once it has an outcome: a rejection stops the circuit at the rejecting step. */
      done: !!w.outcome || w.step >= ws.length,
      /** Running and waiting for the current user's decision. */
      mine: !w.outcome && !!cur && cur.assigneeId === ctx.user.id,
      requested: w.requesterId === ctx.user.id,
      /**
       * Records managers follow every workflow; others the ones they take part in, as long as they may read the
       * document and see the revision (D-14: once the circuit is over, its approvers leave the drafting circle).
       */
      visible: ctx.seesAll || (involved && !!doc && canRead(ctx, doc, ix) && readerMaySeeRevision(inDraftingCircle(ctx, doc, ix), rev?.status)),
      progress: `${Math.min(w.step, ws.length)}/${ws.length}`,
      comments: comments.filter((c) => c.workflowId === w.id).map((c) => {
        const who = ctx.userName(c.authorId);
        return { id: c.id, who, initials: ctx.users.get(c.authorId)?.initials ?? who.slice(0, 2), whenF: fmtDate(c.at, lang), text: loc(c.text, lang) };
      }),
      href: `/validations?r=${encodeURIComponent(w.id)}`,
    };
  });
}
export type WorkflowView = Awaited<ReturnType<typeof listWorkflows>>[number];

// ── Change requests (Vigie) ──────────────────────────────────────────────

/**
 * Requests on documents the user can see; the others are treated as if they did not exist. Outside a document's drafting
 * circle, a request whose revision the user may not see names neither its change order, its designated author nor that
 * revision, and one grafted onto that revision still shows « Acceptée » (access.ts, changeAsSeen; D-14, D-26).
 */
export async function listChangeRequests(ctx: Ctx, opts: { docId?: string } = {}) {
  const db = await getDb();
  const q = db.select().from(s.changeRequests).orderBy(desc(s.changeRequests.createdAt));
  const all = await (opts.docId ? q.where(eq(s.changeRequests.docId, opts.docId)) : q);
  const ids = [...new Set(all.map((r) => r.docId))];
  const revIds = [...new Set(all.flatMap((r) => (r.revisionId == null ? [] : [r.revisionId])))];
  const ix = await getAccessIndex();
  const [docs, revs] = await Promise.all([
    ids.length ? db.select().from(s.documents).where(inArray(s.documents.id, ids)) : [],
    revIds.length ? db.select({ id: s.revisions.id, status: s.revisions.status, changeRef: s.revisions.changeRef }).from(s.revisions).where(inArray(s.revisions.id, revIds)) : [],
  ]);
  const circleOf = new Map(docs.filter((d) => canRead(ctx, d, ix)).map((d) => [d.id, inDraftingCircle(ctx, d, ix)]));
  const revBy = new Map(revs.map((x) => [x.id, x]));
  const rows = all
    .filter((r) => circleOf.has(r.docId))
    .map((r) => changeAsSeen(circleOf.get(r.docId)!, r, r.revisionId == null ? null : revBy.get(r.revisionId)));
  return rows.map((r) => ({
    ...r,
    kindL: ctx.t[`kind_${r.kind}` as TKey],
    statusL: ctx.t[`ecr_${r.status}` as TKey],
    requester: ctx.userName(r.requesterId),
    modifier: r.modifierId ? ctx.userName(r.modifierId) : null,
    when: fmtWhen(r.createdAt),
  }));
}
export type ChangeRequestView = Awaited<ReturnType<typeof listChangeRequests>>[number];

/**
 * What a recorded acceptance waits for (lib/lifecycle.ts decisionWait, applyPendingDecision): the lock of the document,
 * then, for a change, the revision already open (D-26). An archived document under legal hold cannot be restored before
 * the hold is released: both are named. Outside the drafting circle, pass no revision: it does not exist for the reader (D-14).
 */
export function decisionWaitL(t: T, w: DecisionWait): string {
  const rev = w.revision ? ` (${t.rev_short} ${w.revision})` : '';
  const lock = w.state === 'archived' ? (w.legalHold ? t.ecr_wait_hold_archived : t.ecr_wait_archived) : w.state === 'active' && w.legalHold ? t.ecr_wait_hold : w.state === 'active' ? null : t.ecr_wait_lock;
  if (!lock) return `${t.ecr_wait_revision}${rev}`;
  return w.revision ? `${lock}, ${t.ecr_wait_then_revision}${rev}` : lock;
}

/**
 * Warning shown on an obsolete or archived document (record, explorer quick view): since when and, when known, the
 * change order that withdrew it. Who may still read or download such a document is not settled (A13, P07): it only informs.
 */
export function stateNotice(ctx: Ctx, d: DocView, requests: ChangeRequestView[]): { state: 'obsolete' | 'archived'; text: string } | null {
  if (d.state === 'active') return null;
  const { t, lang } = ctx;
  // An accepted withdrawal carries Vigie's change order, else the request itself (lib/lifecycle.ts applyChangeDecision).
  const w = requests.find((r) => r.docId === d.id && r.kind === 'obsolescence' && r.status === 'implemented');
  const ref = w ? w.ecoRef ?? w.id : null;
  const obsolete = `${d.obsoleteAt ? `${t.obsolete_since} ${fmtDate(d.obsoleteAt, lang)}` : t.st_obsolete}${ref ? ` (${ref})` : ''} — ${t.do_not_apply}`;
  if (d.state === 'obsolete') return { state: 'obsolete', text: obsolete };
  const archived = d.archivedAt ? `${t.archived_on} ${fmtDate(d.archivedAt, lang)}` : t.st_archived;
  // An obsolete document archived later keeps both facts (obsoleteAt is never cleared).
  return { state: 'archived', text: d.obsoleteAt ? `${archived} · ${obsolete}` : archived };
}

// ── Deadlines ────────────────────────────────────────────────────────────

export const DEADLINE_WINDOW_DAYS = 90;

/**
 * What falls due within 90 days (or is overdue): end of retention (action from the retention class),
 * expiry of permits, certificates and contracts (renew), planned periodic review (review).
 */
export function deadlines(ctx: Ctx, docs: DocView[]) {
  const today = todayIso();
  const limit = addDays(today, DEADLINE_WINDOW_DAYS);
  const out: (DocView & { kind: 'retention' | 'expiry' | 'review'; end: string; endF: string; days: number; action: string; actionLabel: string })[] = [];
  for (const d of docs) {
    const push = (kind: 'retention' | 'expiry' | 'review', end: string, action: string) =>
      out.push({ ...d, kind, end, endF: fmtDate(end, ctx.lang), days: daysBetween(today, end), action, actionLabel: d.legalHold ? ctx.t.hold : ctx.t[`x_${action}` as TKey] });
    if (d.retainUntil && d.retainUntil <= limit) push('retention', d.retainUntil, d.retentionDisposition === 'destroy' ? 'destroy' : d.retentionDisposition === 'review' ? 'review' : 'archive');
    if (d.state !== 'active') continue;
    if (d.expiresAt && d.expiresAt <= limit) push('expiry', d.expiresAt, 'renew');
    if (d.reviewDueAt && d.reviewDueAt <= limit && d.revInForce) push('review', d.reviewDueAt, 'review');
  }
  return out.sort((a, b) => a.end.localeCompare(b.end));
}
export type DeadlineView = ReturnType<typeof deadlines>[number];

// ── Audit ────────────────────────────────────────────────────────────────

type AuditRow = typeof s.auditLog.$inferSelect;

/**
 * Current ID of each former one (reclassification before the first approval, migrated reference). The journal keeps
 * the ID an entry was written under; IDs are never handed out twice (lib/codification.ts), so the mapping is safe.
 */
async function currentIds(): Promise<Map<string, string>> {
  const db = await getDb();
  const rows = await db.select({ id: s.documents.id, aliases: s.documents.aliases }).from(s.documents).where(sql`jsonb_array_length(${s.documents.aliases}) > 0`);
  return new Map(rows.flatMap((d) => d.aliases.map((a): [string, string] => [a, d.id])));
}

/** Entry as a reader gets it; `readable`: the reader may open the document it is about (always, for an entry without document). */
export type AuditEntry = AuditRow & { readable: boolean };

/**
 * Do the values of a metadata edit reach a reader outside the drafting circle who reads the document now? Only when a
 * revision was in force at the time (otherwise they were work on a draft, D-14) and the document was then no stricter
 * than it is now (otherwise they were meant for a narrower audience, as before a lowering of its level).
 */
function editValuesShown(doc: AuditData['doc'], conf: string): boolean {
  return !!doc && doc.inForce && CONF_LEVELS.indexOf(doc.conf) <= CONF_LEVELS.indexOf(conf as Conf);
}

/**
 * Journal entries the user may read. Entries without a document (administration, exports) belong to the
 * administration screen. Records managers read every entry about a document. Others, whatever ID the entry was
 * written under: outside a document's drafting circle, its work in progress stays hidden (access.ts,
 * readerMaySeeEntry); about a document they cannot read (canRead), an entry keeps its action and ID but loses its
 * detail; outside the circle, the values of a metadata edit only show when editValuesShown says so (the fields
 * changed still do). Shared by the screens and the CSV export.
 */
export async function auditForReader(ctx: Ctx, all: AuditRow[]): Promise<AuditEntry[]> {
  const rows = ctx.screens.admin ? all : all.filter((a) => a.docId != null);
  if (ctx.seesAll || !rows.length) return rows.map((a) => ({ ...a, readable: true }));
  const db = await getDb();
  const current = await currentIds();
  const cur = (id: string) => current.get(id) ?? id;
  const docIds = [...new Set(rows.flatMap((a) => (a.docId == null ? [] : [cur(a.docId)])))];
  const revIds = [...new Set(rows.flatMap((a) => (a.revisionId == null ? [] : [a.revisionId])))];
  const [docs, revs, ix] = await Promise.all([
    docIds.length ? db.select().from(s.documents).where(inArray(s.documents.id, docIds)) : [],
    revIds.length ? db.select({ id: s.revisions.id, status: s.revisions.status, changeRef: s.revisions.changeRef }).from(s.revisions).where(inArray(s.revisions.id, revIds)) : [],
    getAccessIndex(),
  ]);
  const docBy = new Map(docs.map((d) => [d.id, d]));
  const statusBy = new Map(revs.map((r) => [r.id, r.status]));
  return rows.flatMap((a): AuditEntry[] => {
    if (a.docId == null) return [{ ...a, readable: true }];
    const d = docBy.get(cur(a.docId));
    const circle = !!d && inDraftingCircle(ctx, d, ix);
    if (!readerMaySeeEntry(circle, a, a.revisionId == null ? undefined : statusBy.get(a.revisionId))) return [];
    if (!d || !canRead(ctx, d, ix)) return [{ ...a, detail: '', data: null, readable: false }];
    if (!circle && a.data?.changes && !editValuesShown(a.data.doc, d.conf)) {
      return [{ ...a, data: { ...a.data, changes: a.data.changes.map(({ field, scope }) => ({ field, scope })) }, readable: true }];
    }
    return [{ ...a, readable: true }];
  });
}

const TARGET_LABEL: Record<AuditTargetKind, TKey> = { permission: 'target_permission', department: 'department', site: 'site', function: 'function_label', type: 'type', export: 'target_export' };

/** What an entry without document is about, as the Journal tab and its export name it: "Fonction · Responsable qualité". */
export function auditTargetL(ctx: Ctx, kind: AuditTargetKind | null, id: string | null): string {
  if (!kind || !id) return '—';
  const { t } = ctx;
  const [role, perm] = id.split(':');
  const name =
    kind === 'permission' ? `${t[MATRIX_ROLE_LABEL[role]] ?? role} · ${t[`perm_${perm}` as TKey] ?? perm}`
    : kind === 'department' ? `${id} · ${ctx.label('department', id)}`
    : kind === 'site' ? ctx.label('site', id)
    : kind === 'function' ? ctx.label('function', id)
    : kind === 'type' ? `${id} · ${ctx.label('type', id)}`
    : id === 'search' ? t.adv_search : t.ad_audit;
  return `${t[TARGET_LABEL[kind]]} · ${name}`;
}

/** Labels of the fields a journal change names; `granted` and `active` have none (the target, or the value, says it). */
const CHANGE_LABEL: Record<string, TKey> = {
  title: 'title_label', typeCode: 'type', subtype: 'subtype', origin: 'origin', attachment: 'attachment', projectCode: 'project', programCode: 'program',
  department: 'department', site: 'site', ownerId: 'owner', authorText: 'author_text', conf: 'conf', keywords: 'keywords', lang: 'language',
  reviewDueAt: 'review_due_at', expiresAt: 'expires_at', sourceOrg: 'source_org', externalRef: 'external_ref', receivedAt: 'received_at',
  projectPhase: 'project_phase', workPackage: 'work_package', discipline: 'discipline', researchTheme: 'research_theme', studyId: 'study_id',
  ipStatus: 'ip_status', processOwnerId: 'process_owner', retention: 'retention', circuit: 'circuit', confAllowed: 'conf_allowed', confDefault: 'conf_default',
};

/** One stored value of a change, in the reader's language. */
function changeValueL(ctx: Ctx, field: string, v: AuditValue | undefined): string {
  const { t } = ctx;
  if (v == null || (Array.isArray(v) && !v.length)) return field === 'circuit' ? t.no_approval : '—';
  if (typeof v === 'boolean') return field === 'granted' ? (v ? '✓' : '✕') : v ? t.active_label : t.inactive;
  if (Array.isArray(v)) return v.map((x) => changeValueL(ctx, field, x)).join(field === 'circuit' ? ' → ' : ', ');
  if (typeof v === 'object') {
    return `${v.years != null ? `${v.years} ${t.years_short} · ` : ''}${t[`trig_${v.trigger}` as TKey] ?? v.trigger} · ${t[`disp_${v.disposition}` as TKey] ?? v.disposition}`;
  }
  const key = (prefix: string) => t[`${prefix}${v}` as TKey] ?? v;
  switch (field) {
    case 'title': return ctx.lang === 'fr' ? `« ${v} »` : `“${v}”`;
    case 'ownerId': case 'processOwnerId': case 'holder': return ctx.userName(v);
    case 'conf': case 'confAllowed': case 'confDefault': return key('conf_');
    case 'origin': return key('or_');
    case 'attachment': return key('att_');
    case 'lang': return key('lang_');
    case 'site': return ctx.label('site', v);
    case 'circuit': return ctx.label('function', v);
    default: return v;
  }
}

/** "Label : before → after"; the label alone when the values are withheld. */
function changeL(ctx: Ctx, c: AuditChange): string {
  const label = c.field === 'holder' ? c.scope ?? ctx.t.scope_global : CHANGE_LABEL[c.field] ? ctx.t[CHANGE_LABEL[c.field]] : '';
  if (!('before' in c) && !('after' in c)) return label || c.field;
  return `${label ? `${label} : ` : ''}${changeValueL(ctx, c.field, c.before)} → ${changeValueL(ctx, c.field, c.after)}`;
}

const FACET_LABEL: Record<FacetKey, TKey> = { project: 'project_program', family: 'family', type: 'type', origin: 'origin', attachment: 'attachment', department: 'department', status: 'status', conf: 'conf' };
const FACET_PREFIX: Partial<Record<FacetKey, string>> = { origin: 'or_', attachment: 'att_', status: 'st_', conf: 'conf_' };

/** What an export wrote: "« béton » · Type : PRO, NCR · 12 lignes", or "journal complet · 830 lignes". */
function exportL(ctx: Ctx, targetId: string | null, x: NonNullable<AuditData['export']>): string {
  const { t } = ctx;
  const value = (k: FacetKey, v: string) => (FACET_PREFIX[k] && t[`${FACET_PREFIX[k]}${v}` as TKey]) || (k === 'family' ? ctx.label('family', v) : v);
  const filters = FACET_KEYS.filter((k) => x.facets?.[k]?.length).map((k) => `${t[FACET_LABEL[k]]} : ${x.facets![k]!.map((v) => value(k, v)).join(', ')}`);
  const what = targetId === 'search' ? [...(x.q ? [ctx.lang === 'fr' ? `« ${x.q} »` : `“${x.q}”`] : []), ...filters] : [t.export_full];
  return [...(what.length ? what : [t.export_unfiltered]), `${x.interrupted ? `${t.export_interrupted} ` : ''}${x.rows} ${t.export_rows}`].join(' · ');
}

/** Detail of an entry in the reader's language: its free detail, then its changes or export figures. */
export function auditDetailL(ctx: Ctx, a: Pick<AuditRow, 'detail' | 'data' | 'targetId'>): string {
  const x = a.data;
  return [a.detail, x?.changes?.length ? x.changes.map((c) => changeL(ctx, c)).join(' ; ') : '', x?.export ? exportL(ctx, a.targetId, x.export) : ''].filter(Boolean).join(' · ');
}

/** Screen where the target of an entry without document is managed. */
function auditTargetHref(ctx: Ctx, kind: AuditTargetKind | null, id: string | null): string {
  switch (kind) {
    case 'permission': return '/administration?tab=roles';
    case 'department': case 'site': return '/administration?tab=org';
    case 'function': return '/administration?tab=functions';
    case 'type': {
      const family = id ? ctx.typeByCode.get(id)?.family : undefined;
      return `/administration${family ? `?family=${encodeURIComponent(family)}` : ''}`;
    }
    case 'export': return id === 'search' ? '/recherche' : '/administration?tab=audit';
    default: return '/administration?tab=audit';
  }
}

/**
 * Journal entries, newest first, as auditForReader lets the user read them. For a document, its entries under its
 * current ID and its former ones. Each entry keeps the ID it was written under (`ref`, Journal tab and export) and
 * gives the document's current one (`currentId`, activity feeds) when the user may read it. `docsOnly` (activity
 * feeds) leaves out, in the query itself, the entries without document, which would otherwise take up the `limit`;
 * so does a user without the administration screen, who never reads them.
 */
export async function listAudit(ctx: Ctx, opts: { docId?: string; limit?: number; docsOnly?: boolean } = {}) {
  const db = await getDb();
  const current = await currentIds();
  const ids = opts.docId ? [opts.docId, ...[...current].filter(([, id]) => id === opts.docId).map(([former]) => former)] : [];
  const where = opts.docId ? inArray(s.auditLog.docId, ids) : opts.docsOnly || !ctx.screens.admin ? isNotNull(s.auditLog.docId) : undefined;
  const rows = await auditForReader(ctx, await db.select().from(s.auditLog).where(where).orderBy(desc(s.auditLog.at), desc(s.auditLog.id)).limit(opts.limit ?? 500));
  return rows.map((a) => {
    const local = parisStamp(a.at);
    // An unreadable document is named by the ID of the time only: its current one would tell a reclassification apart.
    const currentId = a.docId == null || !a.readable ? null : current.get(a.docId) ?? a.docId;
    return {
      ...a,
      /** Paris time, "YYYY-MM-DD HH:mm:ss" (`at` is the UTC instant). */
      local,
      when: fmtWhen(local),
      user: ctx.userName(a.userId),
      actionLabel: ctx.t[`act_${a.action}` as TKey] ?? a.action,
      /** Free detail, then the changes or export figures, in the user's language. */
      detail: auditDetailL(ctx, a),
      /** The document under its current ID; null for an entry without document, or about a document the user cannot read. */
      currentId,
      /** The document under the ID of the time, or the target of an entry without document. */
      ref: a.docId ?? auditTargetL(ctx, a.targetKind, a.targetId),
      href: a.docId != null ? `/documents/${encodeURIComponent(currentId ?? a.docId)}` : auditTargetHref(ctx, a.targetKind, a.targetId),
    };
  });
}
export type AuditView = Awaited<ReturnType<typeof listAudit>>[number];

// ── Registry and organisation ────────────────────────────────────────────

export function typeView(ctx: Ctx, x: typeof s.docTypes.$inferSelect) {
  const fr = ctx.lang === 'fr';
  return {
    ...x,
    label: fr ? x.labelFr : x.labelEn,
    familyLabel: ctx.label('family', x.family),
    circuitL: x.circuit.length ? x.circuit.map((k) => ctx.label('function', k)).join(' → ') : ctx.t.no_approval,
    subtypesL: x.subtypes.map((st) => (fr ? st.fr : st.en)),
    retentionL: `${x.retentionYears != null ? `${x.retentionYears} ${ctx.t.years_short} · ` : ''}${ctx.t[`trig_${x.retentionTrigger}` as TKey]} · ${ctx.t[`disp_${x.retentionDisposition}` as TKey]}`,
    confL: x.confAllowed.map((c) => ctx.t[`conf_${c}` as TKey]).join(', '),
    confDefaultL: ctx.t[`conf_${x.confDefault}` as TKey],
  };
}
export type TypeView = ReturnType<typeof typeView>;

export async function listFunctionHolders(ctx: Ctx) {
  const db = await getDb();
  const rows = await db.select().from(s.functionHolders);
  return ctx.functions.map((f) => ({
    ...f,
    label: ctx.lang === 'fr' ? f.labelFr : f.labelEn,
    holders: rows.filter((h) => h.functionKey === f.key).map((h) => ({ id: h.id, scopeValue: h.scopeValue, scopeL: h.scopeValue ?? ctx.t.scope_global, userId: h.userId, user: ctx.userName(h.userId) })),
  }));
}

export async function getMatrix() {
  const db = await getDb();
  const rows = await db.select().from(s.rolePermissions);
  return new Map(rows.map((r) => [`${r.role}:${r.perm}`, r.granted]));
}

export async function listSavedSearches(ctx: Ctx) {
  const db = await getDb();
  const rows = await db.select().from(s.savedSearches).orderBy(asc(s.savedSearches.sort));
  return rows.map((x) => ({ ...x, labelL: loc(x.label, ctx.lang) }));
}

/** Templates available to "Nouveau depuis un modèle": template-type documents in force, with their file (same rule as createDocument). */
export async function listTemplates(ctx: Ctx) {
  const ix = await getAccessIndex();
  const docs = (await listDocs(ctx)).filter((d) => isUsableTemplate(ctx, d, ix));
  return docs.map((d) => ({ id: d.id, label: d.title, rev: d.revInForce!, owner: d.owner, department: d.department }));
}
