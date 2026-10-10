import 'server-only';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, schema as s } from '@/db';
import { canRead, getAccessIndex, inDraftingCircle, isUsableTemplate, readerMaySeeEntry, readerMaySeeRevision, type AccessIndex } from './access';
import { revLabel } from './codification';
import type { Ctx } from './context';
import { addDays, daysBetween, fmtDate, fmtSize, fmtWhen, loc, todayIso } from './format';
import { TAGCLS, type T, type TKey } from './i18n';
import { lockOf } from './lifecycle';
import { retainUntil } from './retention';

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
  entries.forEach((e) => later(e.docId, e.at.slice(0, 10)));
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

/** Revisions (newest first) with their working versions (newest first). */
export async function listRevisions(ctx: Ctx, docId: string) {
  const db = await getDb();
  const [revs, versions] = await Promise.all([
    db.select().from(s.revisions).where(eq(s.revisions.docId, docId)).orderBy(desc(s.revisions.id)),
    db.select().from(s.workingVersions).where(eq(s.workingVersions.docId, docId)).orderBy(desc(s.workingVersions.n)),
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

/** Requests on documents the user can see; the others are treated as if they did not exist. */
export async function listChangeRequests(ctx: Ctx, opts: { docId?: string } = {}) {
  const db = await getDb();
  const q = db.select().from(s.changeRequests).orderBy(desc(s.changeRequests.createdAt));
  const all = await (opts.docId ? q.where(eq(s.changeRequests.docId, opts.docId)) : q);
  const ids = [...new Set(all.map((r) => r.docId))];
  const ix = await getAccessIndex();
  const docs = ids.length ? await db.select().from(s.documents).where(inArray(s.documents.id, ids)) : [];
  const visible = new Set(docs.filter((d) => canRead(ctx, d, ix)).map((d) => d.id));
  const rows = all.filter((r) => visible.has(r.docId));
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
 * What an acceptance recorded on a locked document waits for (lib/lifecycle.ts applyPendingDecision). An archived
 * document under legal hold cannot be restored before the hold is released: both are named.
 */
export function decisionWaitL(t: T, d: Pick<DocRow, 'state' | 'legalHold'>): string {
  if (d.state === 'archived') return d.legalHold ? t.ecr_wait_hold_archived : t.ecr_wait_archived;
  return d.state === 'active' && d.legalHold ? t.ecr_wait_hold : t.ecr_wait_lock;
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
 * Journal entries the user may read: all of them for records managers; otherwise, outside a document's drafting
 * circle, its work in progress stays hidden (access.ts, readerMaySeeEntry). Shared by the screens and the CSV export.
 */
export async function auditForReader(ctx: Ctx, all: AuditRow[]): Promise<AuditRow[]> {
  if (ctx.seesAll || !all.length) return all;
  const db = await getDb();
  const docIds = [...new Set(all.map((a) => a.docId))];
  const revIds = [...new Set(all.flatMap((a) => (a.revisionId == null ? [] : [a.revisionId])))];
  const [docs, revs, ix] = await Promise.all([
    db.select().from(s.documents).where(inArray(s.documents.id, docIds)),
    revIds.length ? db.select({ id: s.revisions.id, status: s.revisions.status }).from(s.revisions).where(inArray(s.revisions.id, revIds)) : [],
    getAccessIndex(),
  ]);
  const circle = new Set(docs.filter((d) => inDraftingCircle(ctx, d, ix)).map((d) => d.id));
  const statusBy = new Map(revs.map((r) => [r.id, r.status]));
  return all.filter((a) => readerMaySeeEntry(circle.has(a.docId), a, a.revisionId == null ? undefined : statusBy.get(a.revisionId)));
}

/** Journal entries, newest first, as auditForReader lets the user read them. */
export async function listAudit(ctx: Ctx, opts: { docId?: string; limit?: number } = {}) {
  const db = await getDb();
  const q = db.select().from(s.auditLog).orderBy(desc(s.auditLog.at), desc(s.auditLog.id));
  const rows = await auditForReader(ctx, await (opts.docId ? q.where(eq(s.auditLog.docId, opts.docId)) : q).limit(opts.limit ?? 500));
  return rows.map((a) => ({
    ...a,
    when: fmtWhen(a.at),
    user: ctx.userName(a.userId),
    actionLabel: ctx.t[`act_${a.action}` as TKey] ?? a.action,
    ref: a.docId,
    href: `/documents/${encodeURIComponent(a.docId)}`,
  }));
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
