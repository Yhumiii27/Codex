import 'server-only';
import { cache } from 'react';
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { getDb, schema as s } from '@/db';
import type { AuditChange, AuditData, AuditTargetKind, AuditValue, Conf, LinkRel } from '@/db/schema';
import { canRead, changeAsSeen, deadlineActor, draftTodo, followsCircuit, getAccessIndex, inDraftingCircle, isUsableTemplate, mayDeleteSearch, mayEditLinks, mayGetApprovalRecord, mayRecall, mayWorkOnDraft, openRevisionView, readerMaySeeEntry, readerMaySeeRevision, savedSearchesSeenBy, type AccessIndex } from './access';
import { visaCircuit, type VisaRecord } from './approval';
import { revLabel } from './codification';
import type { Ctx } from './context';
import { inForceEffect } from './dates';
import { addDays, clip, daysBetween, fmtDate, fmtDateTime, fmtSize, fmtWhen, loc, nowStamp, parisStamp, todayIso } from './format';
import { CONF_LEVELS, MATRIX_ROLE_LABEL, TAGCLS, type T, type TKey } from './i18n';
import { decisionWait, lockOf, type DecisionWait } from './lifecycle';
import { LINK_RELS, otherEnd, relOf } from './links';
import { retainUntil } from './retention';
import { isExpired, isReviewOverdue } from './review';
import { featuredFilters, featuredOf } from './departments';
import { DATE_LABEL, FACET_KEYS, FACET_LABEL, searchHref, SORT_LABEL, type FacetKey, type Facets, type Period, type SearchDoc, type SearchInput, type SortKey } from './search';

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
  const today = todayIso();
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
    /**
     * Indicators on dates every reader of the record sees (lib/review.ts): an active document past its expiry date, or
     * past its review date with a revision in force. No status changes: withdrawing it remains Vigie's (D-17).
     */
    expired: isExpired(d, today),
    reviewOverdue: isReviewOverdue(d, today),
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

/** Journal actions on the record itself (no revision) that move documents.modified_at (a recorded review sets the next date). */
const RECORD_ACTIONS = ['edit', 'reviewed', 'archive', 'restore'];

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

/**
 * Date the revision in force of each document took effect, as its record shows it: the effective date set when it was
 * sent for approval, or the day it entered into force when that came later. Revisions in force only (D-14).
 */
async function effectiveDates(): Promise<Map<string, string>> {
  const db = await getDb();
  const rows = await db.select({ docId: s.revisions.docId, effectiveAt: s.revisions.effectiveAt, inForceAt: s.revisions.inForceAt })
    .from(s.revisions).where(eq(s.revisions.status, 'in_force'));
  const out = new Map<string, string>();
  for (const r of rows) {
    const at = inForceEffect(r);
    if (at) out.set(r.docId, at);
  }
  return out;
}

/**
 * Documents of /recherche and of its CSV export: those of listDocs (visible ones only), each with the date its revision
 * in force took effect, on copies that leave the shared list as it is. Read here only: no other screen needs that date.
 */
export async function listSearchDocs(ctx: Ctx): Promise<SearchDoc[]> {
  const [docs, eff] = await Promise.all([listDocs(ctx), effectiveDates()]);
  return docs.map((d) => ({ ...d, effectiveAt: eff.get(d.id) ?? null }));
}

/**
 * Documents the current user may see (records managers: all), most recently modified first. Without option, the list is
 * loaded once per request and shared (the layout, its templates and « À traiter », the page): never sort or change it in
 * place.
 */
export function listDocs(ctx: Ctx, opts: { includeHidden?: boolean } = {}): Promise<DocView[]> {
  return opts.includeHidden ? loadDocs(ctx, true) : visibleDocs(ctx);
}
const visibleDocs = cache((ctx: Ctx) => loadDocs(ctx, false));

async function loadDocs(ctx: Ctx, includeHidden: boolean): Promise<DocView[]> {
  const db = await getDb();
  const [rows, ix, wl] = await Promise.all([db.select().from(s.documents).orderBy(desc(s.documents.modifiedAt), desc(s.documents.id)), getAccessIndex(), workingLabels()]);
  const shown = rows.filter((d) => includeHidden || canRead(ctx, d, ix)).map((d) => ({ d, circle: inDraftingCircle(ctx, d, ix) }));
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

/**
 * Approval record of a revision (lib/approval.ts, « fiche de visa »), as /api/documents/[id]/approval serves it. The
 * document as getDoc finds it (a former ID resolves to it; one the user may not read gives null), then its revision
 * `letter`, only if it was approved and the user sees it (access.ts mayGetApprovalRecord: outside the drafting circle,
 * the revision in force or one it replaced, D-14). Its circuits with their steps, and the journal entries of the
 * revision (moments of the decisions, delegations, import), visible to whoever sees the revision, make the record, in
 * the user's language. The text of a circuit's comments and the holders of its steps never decided go only to whoever
 * follows that circuit (access.ts followsCircuit), as in /validations. Null otherwise: the route answers as for a
 * document that does not exist.
 */
export async function approvalRecord(ctx: Ctx, id: string, letter: string): Promise<{ docId: string; letter: string; revisionId: number; record: VisaRecord } | null> {
  const res = await getDoc(ctx, id);
  if (!res || res === 'hidden') return null;
  const { doc, circle } = res;
  const rev = (await listRevisions(ctx, doc.id)).find((r) => r.letter === letter);
  if (!rev || !mayGetApprovalRecord(circle, rev)) return null;
  const db = await getDb();
  const [wfs, entries] = await Promise.all([
    db.select().from(s.workflows).where(eq(s.workflows.revisionId, rev.id)),
    db.select().from(s.auditLog).where(eq(s.auditLog.revisionId, rev.id)).orderBy(asc(s.auditLog.at), asc(s.auditLog.id)),
  ]);
  const ids = wfs.map((w) => w.id);
  const [steps, comments] = ids.length
    ? await Promise.all([
      db.select().from(s.workflowSteps).where(inArray(s.workflowSteps.workflowId, ids)),
      db.select().from(s.workflowComments).where(inArray(s.workflowComments.workflowId, ids)).orderBy(asc(s.workflowComments.id)),
    ])
    : [[], []];
  const journal = entries.map((e) => ({ at: parisStamp(e.at), userId: e.userId, action: e.action, detail: e.detail }));
  // A revision migrated from the legacy system (lib/importer.ts): its import entry says when it came. It was approved
  // there unless it came as a draft, which only a circuit of Codex can have approved since (lib/lifecycle.ts approveRevision).
  const imported = journal.find((e) => e.action === 'import');
  const approvedInCodex = wfs.some((w) => w.outcome === 'approved');
  const order = (w: (typeof wfs)[number]) => Number(/\d+/.exec(w.id)?.[0] ?? 0);
  const { t, lang } = ctx;
  const record: VisaRecord = {
    doc: {
      id: doc.id, title: doc.title, type: `${doc.typeCode} · ${doc.typeLabel}`, context: doc.contextL, owner: doc.owner, conf: doc.confL,
      state: doc.state === 'obsolete' ? `${t.st_obsolete} · ${fmtDate(doc.obsoleteAt, lang)}` : doc.state === 'archived' ? `${t.st_archived} · ${fmtDate(doc.archivedAt, lang)}` : null,
    },
    rev: {
      letter: rev.letter, status: rev.statusLabel, createdAt: rev.createdAt, approvedAt: rev.approvedAt, effectiveAt: rev.effectiveAt, inForceAt: rev.inForceAt,
      supersededAt: rev.supersededAt, modifier: rev.modifier, changeRefs: rev.changeRefs,
    },
    imported: imported ? { at: imported.at, legacyRef: doc.legacyRef ?? imported.detail.split(' → ')[0], approved: !approvedInCodex } : null,
    circuits: [...wfs]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || order(a) - order(b))
      .map((w) => {
        const its = steps.filter((x) => x.workflowId === w.id);
        return visaCircuit(w, its, comments.filter((c) => c.workflowId === w.id), journal, lang, ctx.userName, followsCircuit(ctx, w, its));
      }),
    issued: { at: nowStamp(), by: ctx.user.name },
  };
  return { docId: doc.id, letter: rev.letter, revisionId: rev.id, record };
}

// ── Workflows ────────────────────────────────────────────────────────────

/**
 * Every workflow, with what the current user may see of it (`visible`). Loaded once per request and shared (the layout
 * through « À traiter », the page): never sort or change the list or its items in place, filter or copy it first.
 */
export const listWorkflows = cache(async (ctx: Ctx) => {
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
    const doc = docBy.get(w.docId);
    const rev = revBy.get(w.revisionId);
    const outcomeL = w.outcome === 'approved' ? t.wf_approved : w.outcome === 'rejected' ? t.wf_rejected : w.outcome === 'recalled' ? t.wf_recalled : null;
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
      stepName: (w.outcome === 'rejected' || w.outcome === 'recalled') && outcomeL ? outcomeL : cur && !w.outcome ? cur.nameL : t.wf_finished,
      /** « Approuvé », « Rejeté » or « Rappelé » once it ended, else null. */
      outcomeL,
      /** Who ended it (a rejection recorded without it: the step it stopped at), and when. */
      closer: w.closedBy ? ctx.userName(w.closedBy) : w.outcome === 'rejected' ? cur?.assignee ?? null : null,
      closedF: w.closedAt ? fmtDate(w.closedAt, lang) : '',
      /** Over once it has an outcome: a rejection or a recall stops the circuit at the step it had reached. */
      done: !!w.outcome || w.step >= ws.length,
      /** Running and waiting for the current user's decision. */
      mine: !w.outcome && !!cur && cur.assigneeId === ctx.user.id,
      requested: w.requesterId === ctx.user.id,
      /** The user may recall it (access.ts, mayRecall); a lock of the document still stops them (recallValidation). */
      recallable: !!doc && mayRecall(ctx, w, doc, ix),
      /**
       * Records managers follow every workflow; others the ones they take part in, as long as they may read the
       * document and see the revision (D-14: once the circuit is over, its approvers leave the drafting circle).
       */
      visible: followsCircuit(ctx, w, ws) && (ctx.seesAll || (!!doc && canRead(ctx, doc, ix) && readerMaySeeRevision(inDraftingCircle(ctx, doc, ix), rev?.status))),
      progress: `${Math.min(w.step, ws.length)}/${ws.length}`,
      comments: comments.filter((c) => c.workflowId === w.id).map((c) => {
        const who = ctx.userName(c.authorId);
        return { id: c.id, who, initials: ctx.users.get(c.authorId)?.initials ?? who.slice(0, 2), whenF: fmtDate(c.at, lang), text: loc(c.text, lang) };
      }),
      href: `/validations?r=${encodeURIComponent(w.id)}`,
    };
  });
});
export type WorkflowView = Awaited<ReturnType<typeof listWorkflows>>[number];

// ── Change requests (Vigie) ──────────────────────────────────────────────

/**
 * Requests on documents the user can see; the others are treated as if they did not exist. `mine`: only those the user
 * sent (Validations › Mes demandes Vigie). Outside a document's drafting circle, a request whose revision the user may
 * not see names neither its change order, its designated author nor that revision, nor its decision date once shown
 * « Appliquée », and one grafted onto that revision still shows « Acceptée » (access.ts, changeAsSeen; D-14, D-26).
 */
export async function listChangeRequests(ctx: Ctx, opts: { docId?: string; mine?: boolean } = {}) {
  const db = await getDb();
  const where = and(opts.docId ? eq(s.changeRequests.docId, opts.docId) : undefined, opts.mine ? eq(s.changeRequests.requesterId, ctx.user.id) : undefined);
  const all = await db.select().from(s.changeRequests).where(where).orderBy(desc(s.changeRequests.createdAt), desc(s.changeRequests.id));
  const ids = [...new Set(all.flatMap((r) => (r.replacementId ? [r.docId, r.replacementId] : [r.docId])))];
  const revIds = [...new Set(all.flatMap((r) => (r.revisionId == null ? [] : [r.revisionId])))];
  const ix = await getAccessIndex();
  const [docs, revs] = await Promise.all([
    ids.length ? db.select().from(s.documents).where(inArray(s.documents.id, ids)) : [],
    revIds.length ? db.select({ id: s.revisions.id, letter: s.revisions.letter, status: s.revisions.status, changeRef: s.revisions.changeRef }).from(s.revisions).where(inArray(s.revisions.id, revIds)) : [],
  ]);
  const docBy = new Map(docs.filter((d) => canRead(ctx, d, ix)).map((d) => [d.id, { d, circle: inDraftingCircle(ctx, d, ix) }]));
  const revBy = new Map(revs.map((x) => [x.id, x]));
  return all.flatMap((raw) => {
    const seen = docBy.get(raw.docId);
    if (!seen) return [];
    const { d, circle } = seen;
    // The replacement proposed with a withdrawal, only to who may read it (D-14: a draft stays in its drafting circle).
    const proposed = raw.replacementId ? docBy.get(raw.replacementId)?.d : undefined;
    const r = changeAsSeen(circle, { ...raw, replacementId: proposed ? raw.replacementId : null }, raw.revisionId == null ? null : revBy.get(raw.revisionId));
    // Still linked to its revision only when the reader may see that revision (changeAsSeen).
    const rev = r.kind === 'modification' && r.status === 'implemented' && r.revisionId != null ? revBy.get(r.revisionId) : undefined;
    return [{
      ...r,
      docTitle: d.title,
      docHref: `/documents/${encodeURIComponent(d.id)}`,
      kindL: ctx.t[`kind_${r.kind}` as TKey],
      statusL: ctx.t[`ecr_${r.status}` as TKey],
      requester: ctx.userName(r.requesterId),
      modifier: r.modifierId ? ctx.userName(r.modifierId) : null,
      when: fmtWhen(r.createdAt),
      /** With the year (Mes demandes Vigie lists requests of every year): day sent, day and time sent, of Vigie's decision. */
      sentDayF: fmtDate(r.createdAt, ctx.lang),
      sentF: fmtDateTime(r.createdAt, ctx.lang),
      decidedF: r.decidedAt ? fmtDateTime(r.decidedAt, ctx.lang) : null,
      /** What an acceptance still waits for, in words this reader may be given (acceptedWaitL), or null. */
      waitL: acceptedWaitL(ctx.t, r, d, circle),
      /** The revision an applied change is carried by, when the reader sees it: the one it opened, or the one it was grafted onto (D-26). */
      carrier: rev ? { letter: rev.letter, grafted: rev.changeRef !== (r.ecoRef ?? r.id) } : null,
      /** The replacement proposed with a withdrawal, when the reader may read it. */
      replacement: proposed ? { id: proposed.id, title: proposed.title, href: `/documents/${encodeURIComponent(proposed.id)}` } : null,
    }];
  });
}
export type ChangeRequestView = Awaited<ReturnType<typeof listChangeRequests>>[number];

/**
 * What a recorded acceptance waits for (lib/lifecycle.ts decisionWait, applyPendingDecision): the lock of the document,
 * then, for a change, the revision already open (D-26). An archived document under legal hold cannot be restored before
 * the hold is released: both are named. Outside the drafting circle, pass no revision: it does not exist for the reader (D-14).
 */
export function decisionWaitL(t: T, w: DecisionWait): string {
  const archived = w.state === 'archived';
  if (!w.revision) {
    if (archived) return w.legalHold ? t.ecr_wait_hold_archived : t.ecr_wait_archived;
    return w.state === 'active' && w.legalHold ? t.ecr_wait_hold : t.ecr_wait_lock;
  }
  // The revision is named first: it is what the change opens after; a lock only delays it further.
  const lock = archived
    ? (w.legalHold ? t.ecr_wait_not_before_hold_archived : t.ecr_wait_not_before_archived)
    : w.state === 'active' ? (w.legalHold ? t.ecr_wait_not_before_hold : null) : t.ecr_wait_not_while_locked;
  return `${t.ecr_wait_revision} ${w.revision}${lock ? `, ${lock}` : ''}`;
}

/**
 * What the record says an acceptance still waits for (`r`, as listChangeRequests gives it), or null when it says nothing.
 * In the drafting circle, decisionWaitL. Outside it, an accepted change may be waiting for a revision the reader does not
 * see, or be grafted onto one and shown « Acceptée » (changeAsSeen): the lifting of a lock is then only named as a moment
 * it will not apply before, never as the one it applies at, the same words whether a revision is open or not; without a
 * lock nothing is said (D-14, D-26). A withdrawal waits for the lock alone.
 */
export function acceptedWaitL(t: T, r: { kind: string; status: string }, d: Pick<DocRow, 'state' | 'legalHold' | 'revWorking'>, circle: boolean): string | null {
  if (r.status !== 'accepted') return null;
  const kind = r.kind === 'modification' ? 'modification' : 'obsolescence';
  const wait = decisionWait(kind, circle ? d : { ...d, revWorking: null });
  const locked = wait.state !== 'active' || wait.legalHold;
  if (circle || kind !== 'modification') return locked || wait.revision ? decisionWaitL(t, wait) : null;
  if (!locked) return null;
  if (wait.state === 'archived') return wait.legalHold ? t.ecr_wait_no_earlier_hold_archived : t.ecr_wait_no_earlier_archived;
  return wait.state === 'active' ? t.ecr_wait_no_earlier_hold : t.ecr_wait_no_earlier_lock;
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

// ── Links between documents ──────────────────────────────────────────────

/**
 * Links of a document, as its reader may see them (point 16 of docs/reste-a-faire.md): what the document is to each
 * other one (lib/links.ts relOf), « remplacé par » first, then « remplace » and « voir aussi », each by ID. A linked
 * document the reader may not read is left out (canRead): a draft never in force only shows to its drafting circle
 * (D-14), a confidential one to its audience. Its status is the one its reader sees (docView). `editable`: the user
 * has the link rights on that other document (mayEditLinks; those on this one are the caller's to check); `frozen`: it
 * is under legal hold.
 */
export async function listDocLinks(ctx: Ctx, docId: string) {
  const db = await getDb();
  const rows = await db.select().from(s.documentLinks).where(or(eq(s.documentLinks.sourceId, docId), eq(s.documentLinks.targetId, docId)));
  const ids = [...new Set(rows.map((l) => otherEnd(l, docId)))];
  const [docs, ix] = await Promise.all([ids.length ? db.select().from(s.documents).where(inArray(s.documents.id, ids)) : [], getAccessIndex()]);
  const docBy = new Map(docs.map((d) => [d.id, d]));
  return rows
    .flatMap((l) => {
      const d = docBy.get(otherEnd(l, docId));
      if (!d || !canRead(ctx, d, ix)) return [];
      const v = docView(ctx, d, null, inDraftingCircle(ctx, d, ix));
      const rel: LinkRel = relOf(l, docId);
      return [{ id: l.id, rel, relL: ctx.t[`link_${rel}`], editable: mayEditLinks(ctx, d), frozen: d.legalHold, doc: { id: v.id, title: v.title, href: v.href, statusLabel: v.statusLabel, tagClass: v.tagClass } }];
    })
    .sort((a, b) => LINK_RELS.indexOf(a.rel) - LINK_RELS.indexOf(b.rel) || a.doc.id.localeCompare(b.doc.id));
}

// ── Deadlines ────────────────────────────────────────────────────────────

export const DEADLINE_WINDOW_DAYS = 90;

/**
 * What falls due within 90 days (or is overdue): end of retention (action from the retention class),
 * expiry of permits, certificates and contracts (renew), planned periodic review (review). `overdue`: the expiry or
 * review indicator of the record (docView, lib/review.ts), never set for an end of retention; `dueL`: the label of the
 * date, which says so (« Expiré, valable jusqu’au », « Revue en retard, prévue le »).
 */
export function deadlines(ctx: Ctx, docs: DocView[]) {
  const { t } = ctx;
  const today = todayIso();
  const limit = addDays(today, DEADLINE_WINDOW_DAYS);
  const out: (DocView & { kind: 'retention' | 'expiry' | 'review'; end: string; endF: string; days: number; action: string; actionLabel: string; overdue: boolean; dueL: string })[] = [];
  for (const d of docs) {
    const push = (kind: 'retention' | 'expiry' | 'review', end: string, action: string, overdue = false) => out.push({
      ...d, kind, end, endF: fmtDate(end, ctx.lang), days: daysBetween(today, end), action, actionLabel: d.legalHold ? t.hold : t[`x_${action}` as TKey], overdue,
      dueL: kind === 'retention' ? t.until : kind === 'expiry' ? (overdue ? t.dl_expired : t.dl_expiry) : overdue ? t.dl_review_late : t.dl_review,
    });
    if (d.retainUntil && d.retainUntil <= limit) push('retention', d.retainUntil, d.retentionDisposition === 'destroy' ? 'destroy' : d.retentionDisposition === 'review' ? 'review' : 'archive');
    if (d.state !== 'active') continue;
    if (d.expiresAt && d.expiresAt <= limit) push('expiry', d.expiresAt, 'renew', d.expired);
    if (d.reviewDueAt && d.reviewDueAt <= limit && d.revInForce) push('review', d.reviewDueAt, 'review', d.reviewOverdue);
  }
  return out.sort((a, b) => a.end.localeCompare(b.end));
}
export type DeadlineView = ReturnType<typeof deadlines>[number];

// ── What waits for the user (G19) ────────────────────────────────────────

/**
 * An approval step to decide; a revision to draft again after a rejection or a recall, assigned by an ECO, or never
 * submitted; an accepted change that may be grafted onto the revision being drafted (D-26); a review or an expiry
 * falling due.
 */
export type ActionKind = 'step' | 'rejected' | 'recalled' | 'eco' | 'graft' | 'draft' | 'review' | 'renew';
const ACTION_ORDER: readonly ActionKind[] = ['step', 'rejected', 'recalled', 'eco', 'graft', 'draft', 'review', 'renew'];

/** Characters of a rejection's or a recall's reason quoted in « À traiter » (the record shows all of it). */
const REASON_SHOWN = 140;

/**
 * One thing waiting for the user: what to do (`detail`, in their language), why a circuit sent the revision back
 * (`note`, its reason abridged, shown on a line of its own) and where to do it (`href`).
 */
export type MyAction = { key: string; kind: ActionKind; docId: string; docTitle: string; detail: string; note: string | null; href: string; due: string | null };

/**
 * Everything waiting for the user, the one source of the home's « À traiter », the sidebar badge and the bell (G19).
 * An item is listed only on a document the user may see (listDocs, D-14) and when the server would let them act:
 * - steps of running circuits assigned to them, on a document not locked, with the approve permission and the
 *   Validations screen (decideStep);
 * - revisions being drafted (draftTodo: sent back by a circuit rejected or recalled, with its reason; assigned by an
 *   ECO; never submitted), when they may work on the draft of an unlocked document (mayWorkOnDraft) and upload a
 *   working version or, once there is one, send it for approval (addWorkingVersion, requestValidation);
 * - changes Vigie accepted while that revision is drafted, which they may graft onto it (openRevisionView, graftChange);
 * - review and expiry dates within DEADLINE_WINDOW_DAYS, or past, of the unlocked documents they own or own the process
 *   of (deadlineActor: the process owner records a review, and only asks for a change on an expiry), with the edit
 *   permission; an overdue one is worded as the record's indicator. End of retention stays with records managers, in
 *   Archivage.
 * Ordered by kind (ACTION_ORDER), then by date. Cached per request (see myTodo).
 */
export const myActions = cache(async (ctx: Ctx): Promise<MyAction[]> => {
  const db = await getDb();
  const { t } = ctx;
  const me = ctx.user.id;
  const [docs, workflows, open, pending, ix] = await Promise.all([
    listDocs(ctx),
    listWorkflows(ctx),
    db.select().from(s.revisions).where(inArray(s.revisions.status, ['draft', 'in_review', 'approved'])),
    db.select().from(s.changeRequests).where(inArray(s.changeRequests.status, ['submitted', 'accepted'])),
    getAccessIndex(),
  ]);
  const docBy = new Map(docs.map((d) => [d.id, d]));
  // Revisions being drafted that already have a working version (they may be sent for approval).
  const draftIds = open.filter((r) => r.status === 'draft').map((r) => r.id);
  const drafted = draftIds.length ? await db.selectDistinct({ revisionId: s.workingVersions.revisionId }).from(s.workingVersions).where(inArray(s.workingVersions.revisionId, draftIds)) : [];
  const withVersions = new Set(drafted.map((v) => v.revisionId));
  const out: MyAction[] = [];
  const push = (kind: ActionKind, d: DocView, detail: string, href: string, due: string | null = null, key = d.id, note: string | null = null) =>
    out.push({ key: `${kind}:${key}`, kind, docId: d.id, docTitle: d.title, detail, note, href, due });

  if (ctx.screens.workflow && ctx.can('approve')) {
    for (const w of workflows) {
      const d = docBy.get(w.docId);
      if (!d || !w.mine || w.locked || !w.visible) continue;
      push('step', d, `${d.id} · ${t.rev_short} ${w.letter} · ${t.requested_by} ${w.requester} · ${t.step} : ${w.stepName} · ${t.due} ${w.dueF}`, w.href, w.due, w.id);
    }
  }

  for (const r of open) {
    const d = docBy.get(r.docId);
    if (!d || r.status !== 'draft' || lockOf(d) || !mayWorkOnDraft(ctx, d, ix)) continue;
    if (!ctx.can('upload') && !(ctx.can('edit') && withVersions.has(r.id))) continue;
    // A draft revision with a circuit was sent back by it, rejected or recalled: the last one names who ended it, why,
    // and who drafted it (its first step).
    const last = workflows.filter((w) => w.revisionId === r.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || Number(b.id.slice(2)) - Number(a.id.slice(2)))[0];
    const sentBack = last?.outcome === 'rejected' || last?.outcome === 'recalled' ? last.outcome : null;
    if (last && !sentBack) continue;
    const kind = draftTodo(me, r, d.ownerId, last && sentBack ? { authorId: last.steps[0]?.assigneeId ?? r.modifierId ?? d.ownerId, outcome: sentBack } : null);
    if (!kind) continue;
    const rev = `${d.id} · ${t.rev_short} ${d.workingLabel ?? r.letter}`;
    const eco = r.changeRef ? ` · ${r.changeRef}` : '';
    // The owner's draft an ECO assigned to someone else names who was designated to write it.
    const assigned = r.modifierId && r.modifierId !== me ? ` · ${t.todo_assigned} ${ctx.userName(r.modifierId)}${eco}` : '';
    const sent = kind === 'rejected' || kind === 'recalled';
    const detail = sent
      ? `${rev} ${kind === 'rejected' ? t.todo_rejected : t.todo_recalled} ${last?.closer ?? '—'}${eco}`
      : kind === 'eco' ? `${rev} ${t.todo_eco}${eco}` : `${rev} ${t.todo_draft}${assigned}`;
    const note = sent && last?.reason ? `${t.ecr_reason} : ${clip(last.reason, REASON_SHOWN)}` : null;
    push(kind, d, detail, `${d.href}?tab=versions`, null, d.id, note);
  }

  if (ctx.can('edit')) {
    for (const c of pending) {
      const d = docBy.get(c.docId);
      if (!d || c.kind !== 'modification' || c.status !== 'accepted' || lockOf(d)) continue;
      const { wait } = openRevisionView(inDraftingCircle(ctx, d, ix), ctx, d.ownerId, open.find((r) => r.docId === d.id), c);
      if (wait?.graft === 'yes') push('graft', d, `${d.id} · ${c.ecoRef ?? c.id} ${t.ecr_accepted_l}, ${t.todo_graft} ${wait.letter}`, `${d.href}?tab=requests`);
    }
    const changing = new Set(pending.map((c) => c.docId));
    const own = docs.filter((d) => (d.ownerId === me || d.processOwnerId === me) && !lockOf(d));
    for (const x of deadlines(ctx, own)) {
      if (x.kind === 'retention' || !deadlineActor(me, x, x.kind, changing.has(x.id))) continue;
      const days = x.days >= 0 ? `${x.days} ${t.days_left}` : `${-x.days} ${t.days_late}`;
      // Worded as the record's indicator once overdue (dueL): « Expiré, valable jusqu’au … », « Revue en retard, prévue le … ».
      push(x.kind === 'review' ? 'review' : 'renew', x, `${x.id} · ${x.dueL} ${x.endF} · ${days}`, `${x.href}?tab=meta`, x.end);
    }
  }

  const rank = (a: MyAction) => ACTION_ORDER.indexOf(a.kind);
  return out.sort((a, b) => rank(a) - rank(b) || (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.docId.localeCompare(b.docId));
});

/** « À traiter » with the time it was computed (ms), so the shell keeps the most recent list it was given. */
export type Todo = { at: number; items: MyAction[] };

/**
 * myActions for the shell (components/shell/AppProvider.tsx). A client navigation renders the page again but not the
 * layout: the home page hands its list over, and the badge and the bell show whichever list is the most recent.
 * Cached per request: the layout and the page of one render get the same list and the same time.
 */
export const myTodo = cache(async (ctx: Ctx): Promise<Todo> => ({ at: Date.now(), items: await myActions(ctx) }));

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
  // Documents the entries are about, and the other end of the links they record.
  const docIds = [...new Set(rows.flatMap((a) => [...(a.docId == null ? [] : [cur(a.docId)]), ...(a.data?.link ? [cur(a.data.link.other)] : [])]))];
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
    // A link to a document the reader may not read is not shown on the record: nor is its trace (D-14).
    const linked = a.data?.link ? docBy.get(cur(a.data.link.other)) : undefined;
    if (a.data?.link && (!linked || !canRead(ctx, linked, ix))) return [];
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
  featured: 'featured_filters', reviewMonths: 'review_months',
};

/** One stored value of a change, in the reader's language. */
function changeValueL(ctx: Ctx, field: string, v: AuditValue | undefined): string {
  const { t } = ctx;
  if (v == null || (Array.isArray(v) && !v.length)) return field === 'circuit' ? t.no_approval : field === 'featured' ? t.featured_none : field === 'reviewMonths' ? t.review_months_none : '—';
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
    // Facets a department page puts forward ('default': those of every department without its own, lib/departments.ts).
    case 'featured': return v === 'default' ? t.featured_default : t[FACET_LABEL[v as FacetKey]] ?? v;
    case 'reviewMonths': return `${v} ${t.months_short}`;
    default: return v;
  }
}

/** "Label : before → after"; the label alone when the values are withheld. */
function changeL(ctx: Ctx, c: AuditChange): string {
  const label = c.field === 'holder' ? c.scope ?? ctx.t.scope_global : CHANGE_LABEL[c.field] ? ctx.t[CHANGE_LABEL[c.field]] : '';
  if (!('before' in c) && !('after' in c)) return label || c.field;
  return `${label ? `${label} : ` : ''}${changeValueL(ctx, c.field, c.before)} → ${changeValueL(ctx, c.field, c.after)}`;
}

const FACET_PREFIX: Partial<Record<FacetKey, string>> = { origin: 'or_', attachment: 'att_', status: 'st_', overdue: 'overdue_', conf: 'conf_', lang: 'lang_' };

/** A facet value of /recherche as the reader reads it: reference labels, people's names, coded values translated. */
export function facetValueL(ctx: Ctx, k: FacetKey, v: string): string {
  const prefixed = FACET_PREFIX[k] && ctx.t[`${FACET_PREFIX[k]}${v}` as TKey];
  if (prefixed) return prefixed;
  switch (k) {
    case 'project': {
      const name = ctx.projects.find((p) => p.code === v)?.name ?? ctx.programs.find((p) => p.code === v)?.name;
      return name ? `${v} · ${name}` : v;
    }
    case 'family': case 'type': case 'department': case 'site': return ctx.label(k, v);
    case 'owner': return ctx.userName(v);
    case 'author': return ctx.users.has(v) ? ctx.userName(v) : v;
    case 'lang': return v.toUpperCase();
    default: return v;
  }
}

/** "Date d'émission : du 01/01/2026 au 30/06/2026", "… depuis le …", "… jusqu'au …". */
export function periodL(ctx: Ctx, p: Period): string {
  const { t, lang } = ctx;
  const range = p.from && p.to ? `${t.period_from} ${fmtDate(p.from, lang)} ${t.period_to} ${fmtDate(p.to, lang)}`
    : p.from ? `${t.period_since} ${fmtDate(p.from, lang)}` : `${t.period_until} ${fmtDate(p.to, lang)}`;
  return `${t[DATE_LABEL[p.field]]}${lang === 'fr' ? ' : ' : ': '}${range}`;
}

/**
 * Criteria of a search as lines to read (save dialog, journal of the exports): the query, each facet with its values,
 * the period, and the order when one was chosen.
 */
export function searchCriteriaL(ctx: Ctx, x: SearchInput): string[] {
  const { t, lang } = ctx;
  const colon = lang === 'fr' ? ' : ' : ': ';
  return [
    ...(x.q ? [lang === 'fr' ? `« ${x.q} »` : `“${x.q}”`] : []),
    ...FACET_KEYS.filter((k) => x.facets?.[k]?.length).map((k) => `${t[FACET_LABEL[k]]}${colon}${x.facets![k]!.map((v) => facetValueL(ctx, k, v)).join(', ')}`),
    ...(x.period && (x.period.from || x.period.to) ? [periodL(ctx, x.period)] : []),
    ...(x.sort ? [`${t.sorted_by}${colon}${sortL(ctx, x.sort)}`] : []),
  ];
}

export function sortL(ctx: Ctx, k: SortKey): string {
  return ctx.t[SORT_LABEL[k]];
}

/** What an export wrote: "« béton » · Type de document : Procédure · Tri : Titre · 12 lignes", or "journal complet · 830 lignes". */
function exportL(ctx: Ctx, targetId: string | null, x: NonNullable<AuditData['export']>): string {
  const { t } = ctx;
  const what = targetId === 'search' ? searchCriteriaL(ctx, { q: x.q, facets: x.facets as Facets, period: x.period as Period | undefined, sort: x.sort as SortKey | undefined }) : [t.export_full];
  return [...(what.length ? what : [t.export_unfiltered]), `${x.interrupted ? `${t.export_interrupted} ` : ''}${x.rows} ${t.export_rows}`].join(' · ');
}

/** Detail of an entry in the reader's language: its free detail, then the link it records, its changes or export figures. */
export function auditDetailL(ctx: Ctx, a: Pick<AuditRow, 'detail' | 'data' | 'targetId'>): string {
  const x = a.data;
  const link = x?.link ? `${ctx.t[`link_${x.link.rel}`]} ${x.link.other}${x.link.skipped ? ` : ${ctx.t[`link_skip_${x.link.skipped}`]}` : ''}` : '';
  return [a.detail, link, x?.changes?.length ? x.changes.map((c) => changeL(ctx, c)).join(' ; ') : '', x?.export ? exportL(ctx, a.targetId, x.export) : ''].filter(Boolean).join(' · ');
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
    /** Periodic review of the type, « 36 mois », or « — » without one. */
    reviewL: x.reviewMonths ? `${x.reviewMonths} ${ctx.t.months_short}` : '—',
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

const SCOPE_ORDER: Record<string, number> = { group: 0, department: 1, personal: 2 };

/**
 * Saved searches the user sees (lib/access.ts seesSavedSearch, filtered in SQL by savedSearchesSeenBy): shared with the
 * group, then with a department, then their own, each in display order. `title` says who sees it and who shared it;
 * `mayDelete`, whether to offer deletion.
 */
export async function listSavedSearches(ctx: Ctx) {
  const db = await getDb();
  const rows = await db.select().from(s.savedSearches).where(savedSearchesSeenBy(ctx)).orderBy(asc(s.savedSearches.sort), asc(s.savedSearches.id));
  return rows
    .sort((a, b) => SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope])
    .map((x) => ({
      id: x.id, q: x.q, facets: x.facets as Facets, scope: x.scope, department: x.department,
      labelL: loc(x.label, ctx.lang),
      href: searchHref({ q: x.q, facets: x.facets as Facets, period: x.period, sort: x.orderBy }),
      title: x.scope === 'personal'
        ? ctx.t.search_is_personal
        : `${x.scope === 'department' ? `${ctx.t.search_is_department} ${ctx.label('department', x.department)}` : ctx.t.search_is_group} · ${ctx.t.by} ${ctx.userName(x.ownerId)}`,
      mayDelete: mayDeleteSearch(ctx, x),
    }));
}

// ── Department pages ─────────────────────────────────────────────────────

/**
 * A department's page (/departements/[code], G12, FON-06): its documents in force, review, expiry and retention dates
 * falling due, running circuits, the saved searches shared with it and with the whole group, and its featured filters.
 * Everything is read from the lists the other screens use, then narrowed to the department, so that the same rules
 * hold (D-14): documents the user may read (listDocs), circuits they may follow (listWorkflows, `visible`: records
 * managers all of them, others those they take part in, never outside the drafting circle), saved searches they may see
 * (listSavedSearches). Null for an unknown department.
 */
export async function departmentPage(ctx: Ctx, code: string) {
  const db = await getDb();
  const [row] = await db.select().from(s.departments).where(eq(s.departments.code, code));
  if (!row) return null;
  const [docs, workflows, saved] = await Promise.all([listDocs(ctx), listWorkflows(ctx), listSavedSearches(ctx)]);
  const own = docs.filter((d) => d.department === code);
  const ids = new Set(own.map((d) => d.id));
  const keys = featuredOf(row);
  const of = (facets: Facets) => searchHref({ facets: { department: [code], ...facets } });
  return {
    code,
    label: ctx.label('department', code),
    /** Documents of the department the user may read, in force, most recently modified first. */
    inForce: own.filter((d) => d.status === 'in_force'),
    deadlines: deadlines(ctx, own),
    workflows: workflows.filter((w) => w.visible && !w.done && ids.has(w.docId)),
    /** Shared with this department first, then with the whole group; personal searches stay on /recherche. */
    saved: [...saved.filter((x) => x.scope === 'department' && x.department === code), ...saved.filter((x) => x.scope === 'group')],
    featured: featuredFilters(docs, code, keys, (k, v) => facetValueL(ctx, k, v), ctx.lang),
    /** The featured facets follow the default ones (no setting of the department's own). */
    featuredDefault: row.featured == null,
    /** The facets put forward, in order (empty: Administration set none for the department). */
    featuredKeys: keys,
    /** /recherche on the department, and on its documents in force. */
    href: { all: of({}), inForce: of({ status: ['in_force'] }) },
  };
}

/** Templates available to "Nouveau depuis un modèle": template-type documents in force, with their file (same rule as createDocument). */
export async function listTemplates(ctx: Ctx) {
  const ix = await getAccessIndex();
  const docs = (await listDocs(ctx)).filter((d) => isUsableTemplate(ctx, d, ix));
  return docs.map((d) => ({ id: d.id, label: d.title, rev: d.revInForce!, owner: d.owner, department: d.department }));
}
