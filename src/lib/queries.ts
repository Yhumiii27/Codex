import 'server-only';
import { cache } from 'react';
import { and, asc, desc, eq, inArray, isNotNull, isNull, notInArray, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { getDb, schema as s } from '@/db';
import type { AuditChange, AuditData, AuditTargetKind, AuditText, AuditValue, Conf, LinkRel, RetentionTrigger, TermField } from '@/db/schema';
import { canRead, changeAsSeen, CONSULT_ACTIONS, deadlineActor, draftingCircleSql, draftTodo, followsCircuit, getAccessIndex, inDraftingCircle, isUsableTemplate, mayDeleteSearch, mayTransferHoldings, mayEditLinks, mayGetApprovalRecord, mayRecall, mayWorkOnDraft, openRevisionView, readableSql, readerMaySeeEntry, readerMaySeeRevision, readerMaySeeVersion, savedSearchesSeenBy, type AccessIndex } from './access';
import { visaCircuit, type VisaRecord } from './approval';
import { isFinalStatus, TEMPLATE_TYPE } from './codes';
import { revLabel } from './codification';
import type { Ctx } from './context';
import { extensionOf } from './filetypes';
import { addDays, clip, daysBetween, fmtDate, fmtDateTime, fmtSize, fmtWhen, loc, nowStamp, parisStamp, parseIsoDay, TIME_ZONE, todayIso } from './format';
import { CONF_LEVELS, MATRIX_ROLE_LABEL, phaseLabel, retentionBasisL, TAGCLS, type T, type TKey } from './i18n';
import { decisionWait, lockOf, type DecisionWait, type Tx } from './lifecycle';
import { LINK_RELS, otherEnd, relOf } from './links';
import { NO_USAGE, type OrgUsage } from './org-rules';
import { BUILT_IN_FUNCTIONS, BUILT_IN_TYPES } from './registry-rules';
import { EVENT_TRIGGERS, isEventTrigger, retainUntil, retentionGap } from './retention';
import { isExpired, isReviewOverdue } from './review';
import { featuredFilters, featuredOf } from './departments';
import { simulateTransfer, type TransferPlan } from './transfer';
import { bothDocumentValues, documentValues, loadTerms } from './vocab';
import { canonicalSubtype, termKeys, vocabKey, type VocabKind } from './vocab-rules';
import { DATE_LABEL, FACET_KEYS, FACET_LABEL, fold, hit, SCORE_WEIGHT, searchHref, SORT_LABEL, sortOf, wordStartPrefix, type DateField, type FacetKey, type Facets, type Period, type SearchDoc, type SearchInput, type SortKey } from './search';

type DocRow = typeof s.documents.$inferSelect;

/** `column` is one of `values`, passed as one array (a list of thousands of IDs would make as many parameters). */
const anyOf = (column: SQLWrapper, values: string[]) => sql`${column} = any(${sql.param(values)}::text[])`;

/**
 * `workingL`: label of the revision being drafted with its last working version ("B.2"), see workingLabels().
 * `circle`: whether the user belongs to the document's drafting circle; outside it, no revision is being drafted (D-14).
 * `shownModified`: outside the circle, the date of the last change the user may see (visibleModified), when it differs.
 * `version` (lib/concurrency.ts): 0 outside the circle, where nobody may edit the record; it moves with the drafting
 * too (an upload, a revision opened or sent for approval), which stays within the circle (D-14).
 */
export function docView(ctx: Ctx, d: DocRow, workingL: string | null | undefined, circle: boolean, shownModified?: string) {
  const { t, lang, label } = ctx;
  const revWorking = circle ? d.revWorking : null;
  const modifiedAt = (!circle && shownModified) || d.modifiedAt;
  const version = circle ? d.version : 0;
  const typeLabel = label('type', d.typeCode), familyLabel = label('family', d.family);
  const contextL = d.attachment === 'project' ? `${d.projectCode} · ${label('project', d.projectCode)}` : d.attachment === 'research' ? `${d.programCode} · ${label('program', d.programCode)}` : label('department', d.department);
  const until = retainUntil(d);
  const years = d.retentionYears != null ? `${d.retentionYears} ${t.years_short} · ` : '';
  const today = todayIso();
  return {
    ...d,
    revWorking,
    modifiedAt,
    version,
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
    untilF: until ? fmtDate(until, lang) : d.retentionTrigger === 'permanent' || d.retentionDisposition === 'permanent' ? t.disp_permanent : untilGapL(t, retentionGap(d)),
    /** The trigger waits for a date entered on the record (end of life of the asset, departure of the employee). */
    eventTrigger: isEventTrigger(d.retentionTrigger),
    retentionEventF: fmtDate(d.retentionEventAt, lang),
    retentionL: `${years}${t[`trig_${d.retentionTrigger}` as TKey]} · ${t[`disp_${d.retentionDisposition}` as TKey]}`,
    path: `${contextL} › ${familyLabel} › ${typeLabel}`,
    href: `/documents/${encodeURIComponent(d.id)}`,
  };
}
export type DocView = ReturnType<typeof docView>;

/** « Fin de conservation » of a document without one: what it waits for. */
function untilGapL(t: Ctx['t'], gap: ReturnType<typeof retentionGap>): string {
  return gap === 'event_missing' ? t.until_event_missing : gap === 'no_duration' ? t.until_no_duration : '—';
}

/**
 * Label ("B.2", or "B" before any working version) of the revision being drafted or reviewed, per document: of every
 * document, or of those of `docIds`.
 */
async function workingLabels(docIds?: string[]): Promise<Map<string, string>> {
  if (docIds && !docIds.length) return new Map();
  const db = await getDb();
  const open = inArray(s.revisions.status, ['draft', 'in_review', 'approved']);
  const [revs, vs] = await Promise.all([
    db.select({ id: s.revisions.id, docId: s.revisions.docId, letter: s.revisions.letter, status: s.revisions.status }).from(s.revisions).where(docIds ? and(open, anyOf(s.revisions.docId, docIds)) : open),
    db.select({ revisionId: s.workingVersions.revisionId, n: s.workingVersions.n }).from(s.workingVersions).where(docIds ? anyOf(s.workingVersions.docId, docIds) : undefined),
  ]);
  const maxN = new Map<number, number>();
  vs.forEach((v) => maxN.set(v.revisionId, Math.max(maxN.get(v.revisionId) ?? 0, v.n)));
  return new Map(revs.map((r) => [r.docId, maxN.has(r.id) ? revLabel(r.letter, r.status, maxN.get(r.id)) : r.letter]));
}

/** Changes to a document's retention (lib/actions.ts setRetentionClass, setRetentionEvent, updateType). */
export const RETENTION_ACTIONS = ['retention', 'retention_type', 'retention_event'] as const;

/** Journal actions on the record itself (no revision) that move documents.modified_at (a recorded review sets the next date). */
const RECORD_ACTIONS = ['edit', 'reviewed', 'archive', 'restore', ...RETENTION_ACTIONS];

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
 * Documents the current user may see (records managers: all), most recently modified first. Every document is read:
 * the screens read only what they show (visibleWhere and the functions built on it); this list stays the reference the
 * tests compare them with. Without option, it is loaded once per request and shared: never sort or change it in place.
 */
export function listDocs(ctx: Ctx, opts: { includeHidden?: boolean } = {}): Promise<DocView[]> {
  return opts.includeHidden ? loadDocs(ctx, true) : visibleDocs(ctx);
}
const visibleDocs = cache((ctx: Ctx) => loadDocs(ctx, false));

/** `where`: only the documents it selects (a condition on documents), with what they need. */
async function loadDocs(ctx: Ctx, includeHidden: boolean, where?: SQL): Promise<DocView[]> {
  const db = await getDb();
  const rows = await db.select().from(s.documents).where(where).orderBy(desc(s.documents.modifiedAt), desc(s.documents.id));
  const [ix, wl] = await Promise.all([getAccessIndex(ctx), workingLabels(where ? rows.map((d) => d.id) : undefined)]);
  const shown = rows.filter((d) => includeHidden || canRead(ctx, d, ix)).map((d) => ({ d, circle: inDraftingCircle(ctx, d, ix) }));
  const vm = await visibleModified(shown.filter((x) => !x.circle && x.d.revWorking).map((x) => x.d.id));
  const docs = shown.map((x) => docView(ctx, x.d, wl.get(x.d.id), x.circle, vm.get(x.d.id)));
  // Dates shown outside the drafting circle may differ from modified_at: sort again on what the user sees.
  if (vm.size) docs.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return docs;
}

// ── Lists filtered, counted and paged by the database (/recherche, /explorateur, their exports) ──────
// The same documents, in the same order, with the same counts as listDocs and lib/search.ts runSearch, which stay the
// reference (tests/integration/search-sql.test.ts and seed-sql.test.ts compare them), without loading every document:
// the visibility rules run as access.ts readableSql, and only the rows of the page shown are read whole.

/** Documents per page of /recherche and /explorateur. */
export const PAGE_SIZE = 50;

const D = s.documents;
/** A column of documents under its bare name, as the queries on the common table expressions below read it. */
const col = (c: { name: string }) => sql`${sql.identifier(c.name)}`;
const list = (xs: readonly string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);
const ALL = sql`true`;
/** `expr` equals `v`; a value holding a NUL character equals no stored text, and the database refuses it as a parameter. */
const is = (expr: SQL, v: string) => (v.includes('\0') ? sql`false` : sql`${expr} = ${v}`);

/**
 * The order of listDocs, which lists then keep for their ties: the date shown (docView, visibleModified), then the
 * modification date and the ID as the database orders them.
 */
const LIST_ORDER = sql`shown desc, ${col(D.modifiedAt)} desc, ${col(D.id)} desc`;

/** The date the revision in force of document `id` took effect, as text (lib/dates.ts inForceEffect). */
const effectiveOf = (id: SQL) => sql`(select (case when r.effective_at is not null and (r.in_force_at is null or r.effective_at >= r.in_force_at)
  then r.effective_at else r.in_force_at end)::text from ${s.revisions} r where r.doc_id = ${id} and r.status = 'in_force')`;

/**
 * Common table expressions `in_circle`, then `vis`: the documents `ctx` may read (access.ts readableSql), with the
 * columns of documents and what a list filters and sorts them by, as docView gives it: `circle` (inDraftingCircle),
 * `shown` (the modification date the user sees: outside the drafting circle, a document with an open revision is dated
 * by visibleModified), `expired` and `review_late` (lib/review.ts, as of `today`), `rank` (place in the order of
 * listDocs). `effective` adds the date the revision in force took effect (inForceEffect), `score` and `match` a search.
 */
function visibleCte(ctx: Ctx, today: string, opts: { effective?: boolean; score?: SQL; match?: SQL } = {}): SQL {
  const circle = ctx.seesAll ? ALL : sql`${D.id} in (select id from in_circle)`;
  const shown = sql`(case when not (${circle}) and coalesce(${D.revWorking}, '') <> '' then coalesce(greatest(
      (select r.in_force_at from ${s.revisions} r where r.doc_id = ${D.id} and r.status = 'in_force'),
      (select max((a.at at time zone ${TIME_ZONE})::date) from ${s.auditLog} a
        where a.doc_id = ${D.id} and a.revision_id is null and a.action in (${list(RECORD_ACTIONS)}))
    ), ${D.modifiedAt}) else ${D.modifiedAt} end)::text`;
  const expired = sql`(${D.state} = 'active' and ${D.expiresAt} is not null and ${D.expiresAt}::text < ${today})`;
  const reviewLate = sql`(${D.state} = 'active' and coalesce(${D.revInForce}, '') <> '' and ${D.reviewDueAt} is not null and ${D.reviewDueAt}::text < ${today})`;
  return sql`in_circle as (select ${D.id} as id from ${D} where ${ctx.seesAll ? sql`false` : draftingCircleSql(ctx)}),
  vis0 as (
    select ${D}.*, ${circle} as circle, ${shown} as shown, ${opts.effective ? effectiveOf(sql`${D.id}`) : sql`null::text`} as effective,
      ${expired} as expired, ${reviewLate} as review_late, ${opts.score ?? sql`0`} as score
    from ${D} where ${readableSql(ctx, circle)} and ${opts.match ?? ALL}
  ),
  vis as (select *, row_number() over (order by ${LIST_ORDER}) as rank from vis0)`;
}

/**
 * Regular expression of PostgreSQL that finds the folded query `n` (an SQL text) at the start of a word of a folded
 * value, as hit() scores 2 (lib/search.ts wordStartPrefix): its ASCII punctuation escaped, anything else standing for
 * itself.
 */
export const wordStartSql = (n: SQL) => sql`(${wordStartPrefix()} || regexp_replace(${n}, ${'([^0-9A-Za-z\\u0080-\\U0010ffff])'}, ${'\\\\\\1'}, 'g'))`;

/**
 * The text search of runSearch (score, matches) on the folded values of document_terms: `match` holds the documents
 * score() finds, `score` gives the same relevance. The database folds the query as it folded the values it stores
 * (codex_fold), so that both follow the same Unicode tables whatever the version of Node. Values that are not the
 * record's own are scored here, as score() does: the label of the type in the user's language, the names of the owner
 * and of the author (when it is a person).
 */
function textSearch(ctx: Ctx, q: string): { match: SQL; score: SQL } {
  const n = fold(q);
  // A NUL character is in no stored text, and the database refuses it as a parameter.
  if (!n || q.includes('\0')) return { match: sql`false`, score: sql`0` };
  const folded = sql`codex_fold(${q})`;
  const like = sql`('%' || replace(replace(replace(${folded}, ${'\\'}, ${'\\\\'}), '%', ${'\\%'}), '_', ${'\\_'}) || '%')`;
  const scored = (pairs: [string, number][]) => pairs.filter(([, level]) => level > 0);
  const types = scored(ctx.types.map((ty) => [ty.code, hit(ctx.label('type', ty.code), n)]));
  const people = scored([...ctx.users.keys()].map((id) => [id, hit(ctx.userName(id), n)]));
  const levelOf = (key: SQL, pairs: [string, number][]) =>
    pairs.length ? sql`(case ${key} ${sql.join(pairs.map(([k, level]) => sql`when ${k} then ${sql.raw(String(level))}`), sql` `)} else 0 end)` : sql`0`;
  const author = sql`(case when coalesce(codex_unbom(${D.authorText}), '') = '' then ${levelOf(sql`coalesce(${D.authorId}, ${D.ownerId})`, people)} else 0 end)`;
  const elsewhere = sql`greatest(${levelOf(sql`${D.typeCode}`, types)}, ${levelOf(sql`${D.ownerId}`, people)}, ${author})`;
  const t = s.documentTerms;
  const level = sql`case when t.term = ${folded} then 3 when t.term ~ ${wordStartSql(folded)} then 2 else 1 end`;
  const w = (f: TermField) => sql.raw(String(SCORE_WEIGHT[f]));
  const best = (f: TermField) => sql`coalesce(max(case when t.field = ${f} then t.level end), 0)`;
  const score = sql`(select ${w('id')} * ${best('id')} + ${w('title')} * ${best('title')} + ${w('keyword')} * ${best('keyword')}
      + ${w('ref')} * ${best('ref')} + ${w('other')} * greatest(${best('other')}, ${elsewhere})
    from (select t.field, ${level} as level from ${t} t where t.doc_id = ${D.id} and t.term like ${like}) t)`;
  // A query the database folds to nothing finds nothing among the stored values, as one JavaScript folds to nothing.
  return { match: sql`((${folded} <> '' and ${D.id} in (select t.doc_id from ${t} t where t.term like ${like})) or ${elsewhere} > 0)`, score };
}

/** Values of facet `k` on a row of `hits` (lib/search.ts facetValues), but for keywords and overdue, which hold several. */
const FACET_SQL: Record<Exclude<FacetKey, 'keywords' | 'overdue'>, SQL> = (() => {
  // Free text the application did not write itself may start with a byte order mark, which the reference never saw
  // (codex_unbom, src/db/index.ts); codes and IDs do not.
  const text = (c: { name: string }) => sql`nullif(codex_unbom(${col(c)}), '')`;
  return {
    project: sql`nullif(coalesce(${col(D.projectCode)}, ${col(D.programCode)}), '')`,
    family: col(D.family), type: col(D.typeCode), subtype: text(D.subtype), origin: col(D.origin), attachment: col(D.attachment),
    department: col(D.department), site: sql`nullif(${col(D.site)}, '')`, owner: col(D.ownerId),
    author: sql`coalesce(nullif(codex_unbom(${col(D.authorText)}), ''), nullif(${col(D.authorId)}, ''), nullif(${col(D.ownerId)}, ''))`,
    status: col(D.status), conf: col(D.conf), lang: sql`nullif(${col(D.lang)}, '')`, source: text(D.sourceOrg), phase: text(D.projectPhase),
    lot: text(D.workPackage), discipline: text(D.discipline), theme: text(D.researchTheme),
  };
})();

/** A facet filter (lib/search.ts passes): a document passes with any of the values chosen. */
function facetHolds(k: FacetKey, values: string[]): SQL {
  const vs = values.filter((v) => !v.includes('\0'));
  if (!vs.length) return sql`false`;
  if (k === 'keywords') return sql`(${col(D.keywords)} ?| array[${list(vs)}]::text[])`;
  if (k === 'overdue') {
    const on = [...(vs.includes('expired') ? [sql`expired`] : []), ...(vs.includes('review') ? [sql`review_late`] : [])];
    return on.length ? sql`(${sql.join(on, sql` or `)})` : sql`false`;
  }
  return sql`(${FACET_SQL[k]} in (${list(vs)}))`;
}

/** Every facet filter except `skip` (see runSearch tally). */
function facetsHold(facets: Facets, skip?: FacetKey): SQL {
  const on = FACET_KEYS.filter((k) => k !== skip && facets[k]?.length).map((k) => facetHolds(k, facets[k]!));
  return on.length ? sql.join(on, sql` and `) : ALL;
}

/** Dates of runSearch periods (lib/search.ts dateOf), as text; `shown` is the modification date the user sees. */
const DATE_SQL: Record<DateField, SQL> = {
  modified: sql`shown`, issued: sql`${col(D.issuedAt)}::text`, effective: sql`effective`, review: sql`${col(D.reviewDueAt)}::text`, expiry: sql`${col(D.expiresAt)}::text`,
};

function periodHolds(p: Period | null | undefined): SQL {
  if (!p || (!p.from && !p.to)) return ALL;
  const v = DATE_SQL[p.field];
  return sql`(${v} is not null${p.from ? sql` and ${v} >= ${p.from}` : sql``}${p.to ? sql` and ${v} <= ${p.to}` : sql``})`;
}

/**
 * Orders of runSearch (lib/search.ts COMPARE); ties keep the order of listDocs (`rank`). codex_fr sorts as its
 * Intl.Collator.
 */
const SORT_SQL: Record<SortKey, SQL> = {
  relevance: sql`score desc, rank`,
  modified: sql`rank`,
  issued: sql`${col(D.issuedAt)} desc nulls last, rank`,
  due: sql`least(${col(D.reviewDueAt)}, ${col(D.expiresAt)}) asc nulls last, rank`,
  id: sql`${col(D.id)} collate codex_fr, rank`,
  title: sql`${col(D.title)} collate codex_fr, ${col(D.id)} collate codex_fr, rank`,
};

/** `limit` and `offset` of page `asked`, or of the last one when it lies beyond (`total`: a CTE with the number of rows). */
const pageWindow = (asked: number) =>
  sql`limit ${PAGE_SIZE} offset (least(${asked}, greatest(ceil((select n from total) / ${PAGE_SIZE}::numeric)::int, 1)) - 1) * ${PAGE_SIZE}`;

type Listed = { id: string; circle: boolean; shown: string; effective: string | null };

/**
 * Documents of `entries` as lists show them (docView), in that order, each read whole, five thousand at a time: what
 * listDocs gives for them.
 */
async function viewsOf(ctx: Ctx, entries: Listed[]): Promise<DocView[]> {
  const db = await getDb();
  const out: DocView[] = [];
  for (let i = 0; i < entries.length; i += 5000) {
    const part = entries.slice(i, i + 5000);
    const drafting = part.filter((e) => e.circle).map((e) => e.id);
    const [rows, wl] = await Promise.all([db.select().from(D).where(anyOf(D.id, part.map((e) => e.id))), workingLabels(drafting)]);
    const byId = new Map(rows.map((d) => [d.id, d]));
    for (const e of part) {
      const d = byId.get(e.id);
      if (d) out.push(docView(ctx, d, wl.get(d.id), e.circle, e.shown));
    }
  }
  return out;
}

const pages = (total: number, size: number) => Math.max(1, Math.ceil(total / size));
const clampPage = (page: number | undefined, last: number) => Math.min(Math.max(1, Math.floor(page ?? 1) || 1), last);

/**
 * Counts per facet value on `hits` under every other facet chosen (runSearch tally), each value with the place its
 * first document holds in the order of listDocs (`first`), so that the values come in the order runSearch meets them.
 * One pass over the documents for the facets holding one value each; keywords and dates past due hold several.
 */
function talliesSql(facets: Facets): SQL {
  const single = FACET_KEYS.filter((k): k is keyof typeof FACET_SQL => k !== 'keywords' && k !== 'overdue');
  // A value counts for facet k only on a document that passes the other facets chosen: null otherwise, as no value.
  const value = (k: keyof typeof FACET_SQL) => {
    const others = facetsHold(facets, k);
    return others === ALL ? sql`(${FACET_SQL[k]})::text` : sql`(case when ${others} then (${FACET_SQL[k]})::text end)`;
  };
  const cols = single.map((_, i) => sql.raw(`v${i}`));
  const which = sql.join(single.map((k, i) => sql`when ${sql.raw(String((2 ** single.length - 1) ^ (2 ** (single.length - 1 - i))))} then ${k}`), sql` `);
  return sql`select (case g ${which} end)::text as k, coalesce(${sql.join(cols, sql`, `)}) as v, n, first from (
      select ${sql.join(cols, sql`, `)}, count(*)::int as n, min(rank * 1000000)::float8 as first, grouping(${sql.join(cols, sql`, `)}) as g
      from (select rank, ${sql.join(single.map((k, i) => sql`${value(k)} as ${cols[i]}`), sql`, `)} from hits) h
      group by grouping sets (${sql.join(cols.map((c) => sql`(${c})`), sql`, `)})
    ) t where coalesce(${sql.join(cols, sql`, `)}) is not null
    union all select 'keywords', e.v, count(distinct h.${col(D.id)})::int, min(h.rank * 1000000 + e.o)::float8
      from hits h cross join lateral jsonb_array_elements_text(h.${col(D.keywords)}) with ordinality as e(v, o)
      where ${facetsHold(facets, 'keywords')} group by e.v
    union all select 'overdue', x.v, count(*)::int, min(h.rank * 1000000 + x.o)::float8
      from hits h cross join lateral (values ('expired', h.expired, 1), ('review', h.review_late, 2)) as x(v, f, o)
      where x.f and ${facetsHold(facets, 'overdue')} group by x.v`;
}

/**
 * A search of /recherche (lib/search.ts runSearch) run by the database over the documents the user may see, in one
 * query: the page `page` of the results (PAGE_SIZE each, the last one for a page beyond it), or all of them with `all`
 * (CSV export, which needs no `counts`); `total` results; `tally(k)` counts the documents per value of facet `k` under
 * every other criterion, its values in the order runSearch meets them. Only the results returned are read whole.
 */
export async function searchDocs(ctx: Ctx, search: SearchInput, opts: { page?: number; all?: boolean; counts?: boolean } = {}) {
  const db = await getDb();
  const q = search.q?.trim() ?? '';
  const facets = search.facets ?? {};
  const text = q ? textSearch(ctx, q) : null;
  const sort = SORT_SQL[sortOf(search)];
  const asked = Math.max(1, Math.floor(opts.page ?? 1) || 1);
  // The page asked for, or the last one; every result for the export.
  const window = opts.all ? sql`` : pageWindow(asked);
  const { rows: [row] } = await db.execute<{ total: number; tallies: { k: FacetKey; v: string; n: number }[]; listed: Listed[] }>(sql`with
    ${visibleCte(ctx, todayIso(), { effective: search.period?.field === 'effective', ...(text ?? {}) })},
    hits as (select * from vis where ${periodHolds(search.period)}),
    total as (select count(*)::int as n from hits where ${facetsHold(facets)}),
    listed as (
      select x.ord, x.id, x.circle, x.shown, ${effectiveOf(sql`x.id`)} as effective
      from (select ${col(D.id)}, circle, shown, row_number() over (order by ${sort}) as ord from hits where ${facetsHold(facets)} order by ${sort} ${window}) x
    )
    select (select n from total) as total,
      ${(opts.counts ?? !opts.all) ? sql`(select coalesce(json_agg(t order by t.k, t.first), '[]') from (${talliesSql(facets)}) t)` : sql`'[]'::json`} as tallies,
      (select coalesce(json_agg(l order by l.ord), '[]') from listed l) as listed`);
  const byFacet = new Map<FacetKey, Map<string, number>>();
  for (const t of row.tallies) {
    if (!byFacet.has(t.k)) byFacet.set(t.k, new Map());
    byFacet.get(t.k)!.set(t.v, t.n);
  }
  const last = pages(row.total, PAGE_SIZE);
  const effective = new Map(row.listed.map((e) => [e.id, e.effective]));
  const results: SearchDoc[] = (await viewsOf(ctx, row.listed)).map((d) => ({ ...d, effectiveAt: effective.get(d.id) ?? null }));
  const none = new Map<string, number>();
  return { results, total: row.total, page: opts.all ? 1 : clampPage(asked, last), pages: last, tally: (k: FacetKey) => byFacet.get(k) ?? none };
}
export type SearchResults = Awaited<ReturnType<typeof searchDocs>>;

/** Classification axes of /explorateur (docs/modele-cible.md §2). */
export const EXPLORER_AXES = ['family', 'department', 'project', 'type', 'origin'] as const;
export type ExplorerAxis = (typeof EXPLORER_AXES)[number];
/** Status filters of /explorateur; « En révision » covers revisions under review and approved ones waiting for their effective date. */
export const EXPLORER_STATUSES = ['all', 'in_force', 'in_review', 'draft', 'obsolete', 'archived'] as const;
export type ExplorerStatus = (typeof EXPLORER_STATUSES)[number];
/** Dates past due of /explorateur: the record's indicators (lib/review.ts, docView), no status (D-17). */
export const EXPLORER_DUES = ['expired', 'review_late'] as const;
export type ExplorerDue = (typeof EXPLORER_DUES)[number];
/** Node of the project axis for documents attached to neither a project nor a research programme. */
export const NO_ATTACHMENT = 'none';

/** Node of a document on an axis: the project axis takes the project or programme it is attached to (docView attachedCode). */
const AXIS_SQL: Record<ExplorerAxis, SQL> = {
  family: col(D.family),
  department: col(D.department),
  project: sql`coalesce(case ${col(D.attachment)} when 'project' then ${col(D.projectCode)} when 'research' then ${col(D.programCode)} end, ${NO_ATTACHMENT})`,
  type: col(D.typeCode),
  origin: col(D.origin),
};

/**
 * What /explorateur lists, over the documents the user may see: their number (`all`), per node of `axis` (`nodes`, in
 * the order listDocs meets them) and per type under the selected `node` (`children`, same order), the expired ones
 * and those with a review overdue (`dues`, over all of them), the documents under the node, the type `sub`, the
 * status and the due filter (`rows`, the page `page` of PAGE_SIZE, in the order of listDocs; `total`), and `sel` when
 * the user sees it.
 */
export async function explorerDocs(ctx: Ctx, f: { axis: ExplorerAxis; node?: string; sub?: string; status: ExplorerStatus; due?: ExplorerDue; sel?: string; page?: number }) {
  const db = await getDb();
  const axis = AXIS_SQL[f.axis];
  const shown = [
    ...(f.node ? [is(axis, f.node)] : []),
    ...(f.sub ? [is(col(D.typeCode), f.sub)] : []),
    ...(f.status === 'all' ? [] : f.status === 'in_review' ? [sql`${col(D.status)} in ('in_review', 'approved')`] : [sql`${col(D.status)} = ${f.status}`]),
    ...(f.due ? [f.due === 'expired' ? sql`expired` : sql`review_late`] : []),
  ];
  const where = shown.length ? sql.join(shown, sql` and `) : ALL;
  const asked = Math.max(1, Math.floor(f.page ?? 1) || 1);
  const { rows: [row] } = await db.execute<{ total: number; counts: { k: string; v: string | null; n: number }[]; listed: Listed[]; sel: Listed[] }>(sql`with
    ${visibleCte(ctx, todayIso())},
    total as (select count(*)::int as n from vis where ${where})
    select (select n from total) as total,
      (select coalesce(json_agg(t order by t.k, t.first), '[]') from (
        select 'node' as k, (${axis})::text as v, count(*)::int as n, min(rank) as first from vis group by 2
        union all select 'child', ${col(D.typeCode)}, count(*)::int, min(rank) from vis where ${f.node && f.axis !== 'type' ? is(axis, f.node) : sql`false`} group by 2
        union all select 'expired', null, count(*)::int, 0 from vis where expired
        union all select 'review_late', null, count(*)::int, 0 from vis where review_late
      ) t) as counts,
      (select coalesce(json_agg(l order by l.rank), '[]') from (
        select ${col(D.id)}, circle, shown, null as effective, rank from vis where ${where} order by rank ${pageWindow(asked)}
      ) l) as listed,
      (select coalesce(json_agg(x), '[]') from (select ${col(D.id)}, circle, shown, null as effective from vis where ${f.sel ? is(col(D.id), f.sel) : sql`false`}) x) as sel`);
  const nodes = new Map<string, number>(), children = new Map<string, number>();
  const dues: Record<ExplorerDue, number> = { expired: 0, review_late: 0 };
  for (const r of row.counts) {
    if (r.k === 'node') nodes.set(r.v!, r.n);
    else if (r.k === 'child') children.set(r.v!, r.n);
    else dues[r.k as ExplorerDue] = r.n;
  }
  const last = pages(row.total, PAGE_SIZE);
  const [views, [selDoc]] = await Promise.all([viewsOf(ctx, row.listed), viewsOf(ctx, row.sel)]);
  return {
    all: [...nodes.values()].reduce((a, b) => a + b, 0), nodes, children, dues,
    rows: views, total: row.total, page: clampPage(asked, last), pages: last, sel: selDoc as DocView | undefined,
  };
}

// ── Documents read for what a screen shows (the shell, home, Archivage, department pages, record) ──────
// Each list is listDocs narrowed to the documents a condition selects, in its order, without reading the others
// (tests/integration/targeted-reads.test.ts compares them with listDocs, person by person and role by role).

/**
 * Documents the user may see that `where` selects, in the order of listDocs, at most `limit`: listDocs filtered on the
 * same condition. `where` is a condition on the columns of `vis0` (visibleCte): those of documents under their bare
 * names (col), `circle`, `shown`, `expired`, `review_late`.
 */
async function visibleWhere(ctx: Ctx, where: SQL, limit?: number): Promise<DocView[]> {
  const db = await getDb();
  const { rows } = await db.execute<Listed>(sql`with ${visibleCte(ctx, todayIso())}
    select ${col(D.id)} as id, circle, shown, null as effective from vis0 where ${where} order by ${LIST_ORDER} ${limit == null ? sql`` : sql`limit ${limit}`}`);
  return viewsOf(ctx, rows);
}

/** The `n` documents the user may see that were modified last, as listDocs begins (home, « Récents »). */
export function recentDocs(ctx: Ctx, n: number): Promise<DocView[]> {
  return visibleWhere(ctx, ALL, n);
}

/**
 * Date the retention of a document counts from, by trigger (lib/retention.ts triggerDate), as an SQL date; null where
 * Codex does not know it (end of project, O-03) or keeps the document permanently. Typed on every trigger: a new one
 * cannot be forgotten here.
 */
const TRIGGER_DATE_SQL: Record<RetentionTrigger, SQL | null> = {
  creation: col(D.createdAt),
  in_force: col(D.issuedAt),
  superseded: sql`coalesce(${col(D.obsoleteAt)}, ${col(D.archivedAt)})`,
  contract_end: col(D.expiresAt),
  expiry: col(D.expiresAt),
  fiscal_year_end: sql`make_date(extract(year from coalesce(${col(D.issuedAt)}, ${col(D.createdAt)}))::int, 12, 31)`,
  asset_life: col(D.retentionEventAt),
  employee_departure: col(D.retentionEventAt),
  project_end: null,
  permanent: null,
};

/**
 * Documents that may have a date falling due by `limit` (deadlines): an expiry or a review of an active document, an
 * end of retention. A superset (one day of margin on the retention): deadlines() decides on each.
 */
function mayFallDueSql(limit: string): SQL {
  const known = Object.entries(TRIGGER_DATE_SQL).filter((e): e is [string, SQL] => e[1] != null);
  const base = sql`(case ${col(D.retentionTrigger)} ${sql.join(known.map(([k, v]) => sql`when ${k} then ${v}`), sql` `)} end)`;
  return sql`((${col(D.state)} = 'active' and ${col(D.expiresAt)} <= ${limit}::date)
    or (${col(D.state)} = 'active' and coalesce(${col(D.revInForce)}, '') <> '' and ${col(D.reviewDueAt)} <= ${limit}::date)
    or (${col(D.retentionDisposition)} <> 'permanent' and ${col(D.retentionYears)} is not null
      and ${base} + make_interval(years => ${col(D.retentionYears)}) <= ${limit}::date + 1))`;
}

/** What falls due within DEADLINE_WINDOW_DAYS among the documents the user may see: deadlines over listDocs. */
export async function dueDeadlines(ctx: Ctx) {
  return deadlines(ctx, await visibleWhere(ctx, mayFallDueSql(addDays(todayIso(), DEADLINE_WINDOW_DAYS))));
}

/** Documents of a department the user may see, in the order of listDocs. */
export function departmentDocs(ctx: Ctx, code: string): Promise<DocView[]> {
  return visibleWhere(ctx, is(col(D.department), code));
}

/** Documents the user may see whose retention counts from a date entered on the record (Archivage, « Dates d'événement »). */
export function eventDocs(ctx: Ctx): Promise<DocView[]> {
  return visibleWhere(ctx, sql`${col(D.retentionTrigger)} in (${list(EVENT_TRIGGERS)})`);
}

/** Archived documents the user may see (Archivage, « Archives »). */
export function archivedDocs(ctx: Ctx): Promise<DocView[]> {
  return visibleWhere(ctx, sql`${col(D.state)} = 'archived'`);
}

/** Per type, the documents the user may see (`n`) and those holding a retention class of their own (`overrides`). */
export async function typeCounts(ctx: Ctx): Promise<Map<string, { n: number; overrides: number }>> {
  const db = await getDb();
  const { rows } = await db.execute<{ code: string; n: number; overrides: number }>(sql`with ${visibleCte(ctx, todayIso())}
    select ${col(D.typeCode)} as code, count(*)::int as n, (count(*) filter (where ${col(D.retentionOverride)}))::int as overrides from vis0 group by 1`);
  return new Map(rows.map((r) => [r.code, { n: r.n, overrides: r.overrides }]));
}

/**
 * The documents the user may see, as a record's dialogs offer them (a replacement on withdrawal, a link): ID, title,
 * state, withdrawal date and owner only, by ID.
 */
export async function readableBriefs(ctx: Ctx): Promise<{ id: string; title: string; state: string; obsoleteAt: string | null; ownerId: string }[]> {
  const db = await getDb();
  const { rows } = await db.execute<{ id: string; title: string; state: string; obsolete_at: string | null; owner_id: string }>(sql`with ${visibleCte(ctx, todayIso())}
    select ${col(D.id)} as id, ${col(D.title)} as title, ${col(D.state)} as state, ${col(D.obsoleteAt)}::text as obsolete_at, ${col(D.ownerId)} as owner_id from vis0`);
  return rows.map((r) => ({ id: r.id, title: r.title, state: r.state, obsoleteAt: r.obsolete_at, ownerId: r.owner_id })).sort((a, b) => a.id.localeCompare(b.id));
}

/** Every document attached to a project, whether the user sees it or not (the record's checklist of expected pieces). */
export function projectDocs(ctx: Ctx, code: string): Promise<DocView[]> {
  return loadDocs(ctx, true, and(eq(s.documents.attachment, 'project'), eq(s.documents.projectCode, code)));
}

/**
 * Documents the user may see whose revision in force entered into force in the last 7 days, Paris time (home, KPI):
 * the journal's `in_force` entries of the week the user may read (auditForReader: outside the drafting circle, an entry
 * whose revision is in force or superseded), each under the document's current ID, whose revision is still the one in
 * force. Counted over the whole week, not over the last entries of the journal.
 */
export async function inForceThisWeek(ctx: Ctx): Promise<number> {
  const db = await getDb();
  const weekAgo = addDays(todayIso(), -7);
  const { rows: [row] } = await db.execute<{ n: number }>(sql`with ${visibleCte(ctx, todayIso())},
    entries as (
      select coalesce((select d.id from ${D} d where d.aliases @> jsonb_build_array(a.doc_id) limit 1), a.doc_id) as cur, a.detail, a.revision_id
      from ${s.auditLog} a where a.action = 'in_force' and a.doc_id is not null and (a.at at time zone ${TIME_ZONE})::date >= ${weekAgo}::date
    )
    select count(distinct e.cur)::int as n from entries e join vis0 v on v.${col(D.id)} = e.cur
    where v.${col(D.revInForce)} = e.detail
      and (v.circle or e.revision_id in (select r.id from ${s.revisions} r where r.status in ('in_force', 'superseded')))`);
  return row?.n ?? 0;
}

/** One document, with what the user may do with its drafts. Returns `hidden` when it exists but is not visible. */
export async function getDoc(ctx: Ctx, id: string): Promise<{ doc: DocView; circle: boolean; ix: AccessIndex } | 'hidden' | null> {
  const db = await getDb();
  let [d] = await db.select().from(s.documents).where(eq(s.documents.id, id));
  if (!d) {
    // Former IDs (reclassification, migration) still resolve, through the index documents_aliases. An ID is never
    // handed out again once kept as an alias (lib/codification.ts): one document at most holds it.
    [d] = await db.select().from(s.documents).where(sql`${s.documents.aliases} @> ${JSON.stringify([id])}::jsonb`).limit(1);
    if (!d) return null;
  }
  const ix = await getAccessIndex(ctx);
  if (!canRead(ctx, d, ix)) return 'hidden';
  const circle = inDraftingCircle(ctx, d, ix);
  const [wl, vm] = await Promise.all([workingLabels([d.id]), visibleModified(!circle && d.revWorking ? [d.id] : [])]);
  return { doc: docView(ctx, d, wl.get(d.id), circle, vm.get(d.id)), circle, ix };
}

/** The people named as readers of a document (document_readers), for its record; the caller has checked it may be read. */
export async function namedReaders(docId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select({ userId: s.documentReaders.userId }).from(s.documentReaders).where(eq(s.documentReaders.docId, docId)).orderBy(asc(s.documentReaders.userId));
  return rows.map((r) => r.userId);
}

/** A working version the user may have, as the file route serves it: the row and its label ("B", "B.2"). */
export type ReadableVersion = { version: typeof s.workingVersions.$inferSelect; label: string };

/**
 * Those of the working versions `ids` of a document that the user may have, under the rules of the file route
 * (src/app/api/documents/[id]/file/route.ts): a document they read, and, outside its drafting circle, only the final
 * file of the revision in force (readerMaySeeVersion, D-14). A version of another document, unknown or withheld is
 * simply absent. Null when the document is unknown or hidden from them. Used by the comparison of versions
 * (lib/compare.ts).
 */
export async function readableVersions(ctx: Ctx, docId: string, ids: readonly number[]): Promise<{ doc: DocView; circle: boolean; versions: Map<number, ReadableVersion> } | null> {
  const res = await getDoc(ctx, docId);
  if (!res || res === 'hidden') return null;
  const { doc, circle } = res;
  const db = await getDb();
  const [revs, versions] = await Promise.all([
    db.select().from(s.revisions).where(eq(s.revisions.docId, doc.id)),
    db.select().from(s.workingVersions).where(eq(s.workingVersions.docId, doc.id)).orderBy(asc(s.workingVersions.n)),
  ]);
  const out = new Map<number, ReadableVersion>();
  for (const id of ids) {
    const version = versions.find((v) => v.id === id);
    const rev = version && revs.find((r) => r.id === version.revisionId);
    if (!version || !rev) continue;
    const isFinal = versions.findLast((v) => v.revisionId === rev.id)?.id === version.id;
    if (!readerMaySeeVersion(circle, rev.status, isFinal)) continue;
    out.set(id, { version, label: isFinalStatus(rev.status) && isFinal ? rev.letter : `${rev.letter}.${version.n}` });
  }
  return { doc, circle, versions: out };
}

/** A working version whose file has a given SHA-256, as sameFiles gives it: its document, label and title. */
export type SameFile = { docId: string; label: string; title: string };

/**
 * Documents already holding a file with this SHA-256 (the duplicate warning of an upload or an import, point 31 of
 * docs/reste-a-faire.md), among the files `viewer` may have: a document they read, and, outside its drafting circle,
 * only the final file of the revision in force (readerMaySeeVersion, D-14): a draft, a working version or a document
 * they cannot read is never named. One version per document (the newest they may have), at most `limit` documents.
 * `viewer` may be another person than the user (lib/importer.ts, for the migration tool).
 */
export async function sameFiles(viewer: Pick<Ctx, 'user' | 'seesAll' | 'can'>, sha256: string, limit = 3): Promise<SameFile[]> {
  const db = await getDb();
  const rows = await db
    .select({
      docId: s.workingVersions.docId, n: s.workingVersions.n, letter: s.revisions.letter, status: s.revisions.status,
      last: sql<number>`(select max(x.n) from working_versions x where x.revision_id = ${s.workingVersions.revisionId})::int`,
    })
    .from(s.workingVersions)
    .innerJoin(s.revisions, eq(s.revisions.id, s.workingVersions.revisionId))
    .where(eq(s.workingVersions.sha256, sha256))
    .orderBy(asc(s.workingVersions.docId), desc(s.workingVersions.id));
  if (!rows.length) return [];
  const [docs, ix] = await Promise.all([
    db.select().from(s.documents).where(anyOf(s.documents.id, [...new Set(rows.map((r) => r.docId))])),
    getAccessIndex(viewer),
  ]);
  const docBy = new Map(docs.map((d) => [d.id, d]));
  const out: SameFile[] = [];
  for (const r of rows) {
    if (out.length >= limit) break;
    if (out.some((x) => x.docId === r.docId)) continue;
    const d = docBy.get(r.docId);
    if (!d || !canRead(viewer, d, ix)) continue;
    const isFinal = r.n === r.last;
    if (!readerMaySeeVersion(inDraftingCircle(viewer, d, ix), r.status, isFinal)) continue;
    out.push({ docId: d.id, label: isFinal && isFinalStatus(r.status) ? r.letter : `${r.letter}.${r.n}`, title: d.title });
  }
  return out;
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
    db.select().from(s.auditLog).where(and(eq(s.auditLog.revisionId, rev.id), notInArray(s.auditLog.action, [...CONSULT_ACTIONS]))).orderBy(asc(s.auditLog.at), asc(s.auditLog.id)),
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
      file: rev.file?.fileKey ? { name: rev.file.fileName ?? `${doc.id}_${rev.letter}`, size: rev.file.sizeF, sha256: rev.file.sha256 } : null,
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
 * Every workflow, with what the current user may see of it (`visible`). Loaded once per request and shared (/validations
 * and the pages that list them all): never sort or change the list or its items in place, filter or copy it first.
 * Screens that need only some read them with workflowsWhere.
 */
export const listWorkflows = cache((ctx: Ctx) => workflowsWhere(ctx));

/** `column` is one of the integers `values`, passed as one array. */
const anyInt = (column: SQLWrapper, values: number[]) => sql`${column} = any(${sql.param(values)}::int[])`;

/** Rows grouped by key, in their order. */
function groupBy<T, K>(rows: T[], key: (r: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return m;
}

/**
 * The workflows `where` selects (a condition on workflows; all of them without it), as listWorkflows gives them, in its
 * order: only their steps, comments, documents and revisions are read.
 */
export async function workflowsWhere(ctx: Ctx, where?: SQL) {
  const db = await getDb();
  const wfs = await db.select().from(s.workflows).where(where).orderBy(asc(s.workflows.due), asc(s.workflows.id));
  const ids = wfs.map((w) => w.id), docIds = [...new Set(wfs.map((w) => w.docId))], revIds = [...new Set(wfs.map((w) => w.revisionId))];
  // Without a condition, the whole tables: a list of every ID would only weigh on the query.
  const only = <C extends SQLWrapper>(column: C, values: string[]) => (where ? anyOf(column, values) : undefined);
  const [steps, comments, docs, revs, ix] = wfs.length ? await Promise.all([
    db.select().from(s.workflowSteps).where(only(s.workflowSteps.workflowId, ids)).orderBy(asc(s.workflowSteps.idx)),
    db.select().from(s.workflowComments).where(only(s.workflowComments.workflowId, ids)).orderBy(asc(s.workflowComments.id)),
    db.select().from(s.documents).where(only(s.documents.id, docIds)),
    db.select({ id: s.revisions.id, letter: s.revisions.letter, status: s.revisions.status }).from(s.revisions).where(where ? anyInt(s.revisions.id, revIds) : undefined),
    getAccessIndex(ctx),
  ]) : [[], [], [], [], null];
  if (!ix) return [];
  const stepsBy = groupBy(steps, (x) => x.workflowId), commentsBy = groupBy(comments, (c) => c.workflowId);
  const docBy = new Map(docs.map((d) => [d.id, d]));
  const revBy = new Map(revs.map((r) => [r.id, r]));
  const { t, lang } = ctx;
  return wfs.map((w) => {
    const ws = (stepsBy.get(w.id) ?? []).map((st) => {
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
      comments: (commentsBy.get(w.id) ?? []).map((c) => {
        const who = ctx.userName(c.authorId);
        return { id: c.id, who, initials: ctx.users.get(c.authorId)?.initials ?? who.slice(0, 2), whenF: fmtDate(c.at, lang), text: loc(c.text, lang) };
      }),
      href: `/validations?r=${encodeURIComponent(w.id)}`,
    };
  });
}
export type WorkflowView = Awaited<ReturnType<typeof workflowsWhere>>[number];

// ── /validations, filtered and paged by the database ─────────────────────
// The same circuits, in the same order and with the same counts as listWorkflows filtered in memory (the reference of
// tests/integration/validations-sql.test.ts), without reading every circuit: visibility (followsCircuit, canRead,
// readerMaySeeRevision) and the filters run as SQL; only the circuits of the page shown are read whole.

export const WORKFLOW_FILTERS = ['mine', 'requested', 'active', 'done'] as const;
export type WorkflowFilter = (typeof WORKFLOW_FILTERS)[number];
/** Circuits listed per page in /validations. */
export const VALIDATIONS_PAGE_SIZE = 50;

const W = s.workflows;
/** Steps of the circuit of the row: their number, as `ws.length` in workflowsWhere. */
const stepCount = sql`(select count(*) from ${s.workflowSteps} y where y.workflow_id = ${W.id})`;
const wfDoneSql = sql`(coalesce(${W.outcome}, '') <> '' or ${W.step} >= ${stepCount})`;

/** The filters of /validations as SQL conditions on the workflow row (WorkflowView mine, requested, done). */
function workflowFilterSql(ctx: Ctx, f: WorkflowFilter): SQL {
  const me = ctx.user.id;
  switch (f) {
    case 'mine': return sql`(coalesce(${W.outcome}, '') = '' and exists (select 1 from ${s.workflowSteps} x where x.workflow_id = ${W.id} and x.idx = ${W.step} and x.assignee_id = ${me}))`;
    case 'requested': return sql`${W.requesterId} = ${me}`;
    case 'active': return sql`not ${wfDoneSql}`;
    case 'done': return wfDoneSql;
  }
}

/**
 * WorkflowView `visible` as an SQL condition on workflows joined to their document (`documents`, not aliased) and
 * revision (`revisions`): records managers every circuit; others those they requested or hold a step of, on a document
 * they may read, whose revision they see (D-14: once a circuit is over, its approvers leave the drafting circle).
 */
function workflowVisibleSql(ctx: Ctx): SQL {
  if (ctx.seesAll) return sql`true`;
  const me = ctx.user.id;
  const circle = draftingCircleSql(ctx);
  return sql`((${W.requesterId} = ${me} or exists (select 1 from ${s.workflowSteps} x where x.workflow_id = ${W.id} and x.assignee_id = ${me}))
    and ${readableSql(ctx, circle)} and (${circle} or coalesce(${s.revisions.status}, '') in ('in_force', 'superseded')))`;
}

/** Order of a filter's list: by due date then ID; the finished ones most recent first; mine requested, running first. */
function workflowOrder(f: WorkflowFilter | null): SQL {
  if (f === 'done') return sql`${W.due} desc, ${W.id} desc`;
  if (f === 'requested') return sql`${wfDoneSql}, ${W.due} asc, ${W.id} asc`;
  return sql`${W.due} asc, ${W.id} asc`;
}

/** IDs of the visible circuits `where` selects, in the order of `f`, one page (or all of them when `limit` is null). */
async function workflowIds(ctx: Ctx, where: SQL | undefined, order: WorkflowFilter | null, limit: number | null, offset = 0): Promise<string[]> {
  const db = await getDb();
  const q = db.select({ id: W.id }).from(W)
    .innerJoin(s.documents, eq(s.documents.id, W.docId))
    .leftJoin(s.revisions, eq(s.revisions.id, W.revisionId))
    .where(and(workflowVisibleSql(ctx), where))
    .orderBy(workflowOrder(order));
  const rows = limit == null ? await q : await q.limit(limit).offset(offset);
  return rows.map((r) => r.id);
}

/** The circuits `ids`, as workflowsWhere gives them, in that order. */
async function workflowsByIds(ctx: Ctx, ids: string[]): Promise<WorkflowView[]> {
  if (!ids.length) return [];
  const views = await workflowsWhere(ctx, anyOf(W.id, ids));
  const by = new Map(views.map((w) => [w.id, w]));
  return ids.flatMap((id) => (by.has(id) ? [by.get(id)!] : []));
}

export type ValidationsPage = {
  /** Visible circuits per filter, and in all. */
  counts: Record<WorkflowFilter, number>;
  total: number;
  /** The filter shown, its page (1-based) and number of pages, and the circuits of that page. */
  filter: WorkflowFilter;
  page: number;
  pages: number;
  list: WorkflowView[];
  /** The circuit shown: the one asked for, else the first of the list, else the first visible one. */
  selected: WorkflowView | null;
  /**
   * The circuit asked for (`r`) exists but is not visible: `took part` when the user requested it or held a step of it
   * (an approver who left the drafting circle), else null for any other one. Undefined when nothing is hidden.
   */
  hidden?: { tookPart: boolean };
};

/**
 * What /validations shows: counts of each filter, the page of the filter asked for (`filter`, else the one the circuit
 * asked for `r` belongs to, else the first with something in it), and the circuit shown. `page`: asked for (from 1);
 * without it, the page that holds `r`. `size`: circuits per page (VALIDATIONS_PAGE_SIZE; tests set fewer).
 */
export async function validationsPage(ctx: Ctx, opts: { filter?: WorkflowFilter | null; r?: string | null; page?: number | null; size?: number } = {}): Promise<ValidationsPage> {
  const db = await getDb();
  const size = opts.size ?? VALIDATIONS_PAGE_SIZE;
  const visible = workflowVisibleSql(ctx);
  const n = (f: WorkflowFilter) => sql<number>`(count(*) filter (where ${workflowFilterSql(ctx, f)}))::int`;
  const [counted] = await db.select({ total: sql<number>`count(*)::int`, mine: n('mine'), requested: n('requested'), active: n('active'), done: n('done') })
    .from(W)
    .innerJoin(s.documents, eq(s.documents.id, W.docId))
    .leftJoin(s.revisions, eq(s.revisions.id, W.revisionId))
    .where(visible);
  const counts = Object.fromEntries(WORKFLOW_FILTERS.map((f) => [f, Number(counted?.[f] ?? 0)])) as Record<WorkflowFilter, number>;
  const total = Number(counted?.total ?? 0);
  const landing: WorkflowFilter = WORKFLOW_FILTERS.find((f) => counts[f] > 0) ?? 'mine';

  let requested: WorkflowView | undefined;
  let hidden: ValidationsPage['hidden'];
  if (opts.r) {
    const [one] = await workflowsByIds(ctx, [opts.r]);
    if (one?.visible) requested = one;
    else if (one) hidden = { tookPart: one.requested || one.steps.some((st) => st.assigneeId === ctx.user.id) };
  }
  const filter: WorkflowFilter =
    opts.filter ??
    (requested ? (requested.mine ? 'mine' : requested.requested ? 'requested' : requested.done ? 'done' : 'active') : landing);
  const pages = Math.max(1, Math.ceil(counts[filter] / size));
  let page = opts.page && opts.page >= 1 ? Math.min(Math.floor(opts.page), pages) : 1;
  if (!opts.page && requested) {
    // The page of the filter's list that holds the circuit asked for, if it is in that list.
    const ids = await db.execute<{ n: number }>(sql`select t.n::int as n from (
      select ${W.id} as id, row_number() over (order by ${workflowOrder(filter)}) as n from ${W}
      join ${s.documents} on ${s.documents.id} = ${W.docId} left join ${s.revisions} on ${s.revisions.id} = ${W.revisionId}
      where ${visible} and ${workflowFilterSql(ctx, filter)}) t where t.id = ${requested.id}`);
    const n = Number(ids.rows[0]?.n ?? 0);
    if (n) page = Math.ceil(n / size);
  }
  const list = await workflowsByIds(ctx, await workflowIds(ctx, workflowFilterSql(ctx, filter), filter, size, (page - 1) * size));
  const selected = requested ?? list[0] ?? (total ? (await workflowsByIds(ctx, await workflowIds(ctx, undefined, null, 1)))[0] ?? null : null);
  return { counts, total, filter, page, pages, list, selected, ...(hidden ? { hidden } : {}) };
}

/** The circuits of a document, as listWorkflows gives them (the record). */
export function docWorkflows(ctx: Ctx, docId: string): Promise<WorkflowView[]> {
  return workflowsWhere(ctx, eq(s.workflows.docId, docId));
}

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
  const ix = await getAccessIndex(ctx);
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
  const [docs, ix] = await Promise.all([ids.length ? db.select().from(s.documents).where(inArray(s.documents.id, ids)) : [], getAccessIndex(ctx)]);
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
 * Ordered by kind (ACTION_ORDER), then by date. Only the documents and workflows an item may come from are read
 * (actionsAmong decides). Cached per request (see myTodo).
 */
export const myActions = cache(async (ctx: Ctx): Promise<MyAction[]> => {
  const db = await getDb();
  const me = ctx.user.id;
  const { pending } = await todoSources();
  // Revisions being drafted that may wait for the user (draftTodo): they were designated to write it, own the document,
  // or wrote it before its last circuit sent it back (the first step of a circuit of it).
  const drafts = await db.select({ id: s.revisions.id, docId: s.revisions.docId }).from(s.revisions).where(and(
    eq(s.revisions.status, 'draft'),
    or(
      eq(s.revisions.modifierId, me),
      sql`${s.revisions.docId} in (select d.id from ${s.documents} d where d.owner_id = ${me})`,
      sql`${s.revisions.id} in (select w.revision_id from ${s.workflows} w join ${s.workflowSteps} x on x.workflow_id = w.id where x.idx = 0 and x.assignee_id = ${me})`,
    ),
  ));
  // The workflows an item may come from: running ones holding a step of the user's, and every one of those revisions
  // (the last one may have sent it back).
  const workflows = await workflowsWhere(ctx, or(
    drafts.length ? anyInt(s.workflows.revisionId, drafts.map((r) => r.id)) : undefined,
    and(sql`coalesce(${s.workflows.outcome}, '') = ''`, sql`${s.workflows.id} in (select x.workflow_id from ${s.workflowSteps} x where x.assignee_id = ${me})`),
  ));
  // The documents an item may be about, among those the user may see: of these workflows and revisions, of the changes
  // Vigie accepted, and the ones they own or own the process of that may fall due.
  const ids = [...new Set([...workflows.map((w) => w.docId), ...drafts.map((r) => r.docId), ...pending.filter((c) => c.status === 'accepted').map((c) => c.docId)])];
  const limit = addDays(todayIso(), DEADLINE_WINDOW_DAYS);
  const docs = await visibleWhere(ctx, sql`(${anyOf(col(D.id), ids)} or ((${col(D.ownerId)} = ${me} or ${col(D.processOwnerId)} = ${me}) and ${mayFallDueSql(limit)}))`);
  return actionsAmong(ctx, docs, workflows);
});

/** Open revisions and the changes Vigie has not closed yet: what « À traiter » starts from. Read once per request. */
const todoSources = cache(async () => {
  const db = await getDb();
  const [open, pending] = await Promise.all([
    db.select().from(s.revisions).where(inArray(s.revisions.status, ['draft', 'in_review', 'approved'])),
    db.select().from(s.changeRequests).where(inArray(s.changeRequests.status, ['submitted', 'accepted'])),
  ]);
  return { open, pending };
});

/**
 * « À traiter » over `docs` (documents the user may see, in the order of listDocs) and `workflows` (as listWorkflows
 * gives them): myActions hands it those its items may come from. Given every document and every workflow, it lists the
 * same items (tests/integration/targeted-reads.test.ts).
 */
export async function actionsAmong(ctx: Ctx, docs: DocView[], workflows: WorkflowView[]): Promise<MyAction[]> {
  const db = await getDb();
  const { t } = ctx;
  const me = ctx.user.id;
  const [{ open, pending }, ix] = await Promise.all([todoSources(), getAccessIndex(ctx)]);
  const docBy = new Map(docs.map((d) => [d.id, d]));
  // Revisions being drafted that already have a working version (they may be sent for approval).
  const draftIds = open.filter((r) => r.status === 'draft' && docBy.has(r.docId)).map((r) => r.id);
  const drafted = draftIds.length ? await db.selectDistinct({ revisionId: s.workingVersions.revisionId }).from(s.workingVersions).where(anyInt(s.workingVersions.revisionId, draftIds)) : [];
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
}

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
    getAccessIndex(ctx),
  ]);
  const docBy = new Map(docs.map((d) => [d.id, d]));
  const statusBy = new Map(revs.map((r) => [r.id, r.status]));
  return rows.flatMap((a): AuditEntry[] => {
    if (a.docId == null) return [{ ...a, readable: true }];
    const d = docBy.get(cur(a.docId));
    const circle = !!d && inDraftingCircle(ctx, d, ix);
    if (!readerMaySeeEntry(circle, a, a.revisionId == null ? undefined : statusBy.get(a.revisionId))) return [];
    if (!d || !canRead(ctx, d, ix)) return [{ ...a, detail: '', data: null, readable: false }];
    // The fingerprint of a file received tells a draft's file apart: kept within the drafting circle (D-14).
    if (!circle && a.data?.sha256) {
      const data = { ...a.data };
      delete data.sha256;
      a = { ...a, data };
    }
    // A link to a document the reader may not read is not shown on the record: nor is its trace (D-14).
    const linked = a.data?.link ? docBy.get(cur(a.data.link.other)) : undefined;
    if (a.data?.link && (!linked || !canRead(ctx, linked, ix))) return [];
    if (!circle && a.data?.changes && !editValuesShown(a.data.doc, d.conf)) {
      return [{ ...a, data: { ...a.data, changes: a.data.changes.map(({ field, scope }) => ({ field, scope })) }, readable: true }];
    }
    return [{ ...a, readable: true }];
  });
}

const TARGET_LABEL: Record<AuditTargetKind, TKey> = { permission: 'target_permission', department: 'department', site: 'site', function: 'function_label', family: 'family', type: 'type', program: 'program', export: 'target_export', file: 'target_file', storage: 'target_storage', backup: 'target_backup', integrity: 'target_integrity', user: 'target_user', source_org: 'target_source_org', keyword: 'target_keyword' };

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
    : kind === 'family' ? ctx.label('family', id)
    : kind === 'type' ? `${id} · ${ctx.label('type', id)}`
    : kind === 'program' ? `${id} · ${ctx.label('program', id)}`
    : kind === 'file' ? t[`file_entry_${id}` as TKey] ?? id
    : kind === 'storage' ? t[`store_${id}` as TKey] ?? id
    : kind === 'backup' ? id
    : kind === 'integrity' ? t.integrity_all
    : kind === 'user' ? ctx.userName(id)
    : kind === 'source_org' || kind === 'keyword' ? id
    : id === 'search' ? t.adv_search : id === 'full' ? t.target_export_full : t.ad_audit;
  return `${t[TARGET_LABEL[kind]]} · ${name}`;
}

/** Labels of the fields a journal change names; `granted` and `active` have none (the target, or the value, says it). */
const CHANGE_LABEL: Record<string, TKey> = {
  title: 'title_label', typeCode: 'type', subtype: 'subtype', origin: 'origin', attachment: 'attachment', projectCode: 'project', programCode: 'program',
  department: 'department', site: 'site', ownerId: 'owner', authorId: 'author_label', authorText: 'author_text', templateTypes: 'template_types', conf: 'conf', keywords: 'keywords', lang: 'language',
  reviewDueAt: 'review_due_at', expiresAt: 'expires_at', sourceOrg: 'source_org', externalRef: 'external_ref', receivedAt: 'received_at',
  projectPhase: 'project_phase', workPackage: 'work_package', discipline: 'discipline', researchTheme: 'research_theme', studyId: 'study_id',
  ipStatus: 'ip_status', processOwnerId: 'process_owner', retention: 'retention', circuit: 'circuit', confAllowed: 'conf_allowed', confDefault: 'conf_default',
  featured: 'featured_filters', reviewMonths: 'review_months', retentionOverride: 'retention_override_label', retentionEventAt: 'retention_event_at',
  typeRetention: 'retention_type_rule', retentionDocs: 'retention_docs',
  // Register and research programmes (Administration).
  code: 'rule_id', key: 'key_label', labelFr: 'label_fr', labelEn: 'label_en', family: 'family', origins: 'origin', attachments: 'attachment',
  subtypes: 'subtypes_label', retentionBasis: 'retention_basis', retentionBasisEn: 'retention_basis_en', iso: 'iso_clause', clientDeliverable: 'client_deliverable', grp: 'family_group',
  scope: 'scope', name: 'program_name', managerId: 'manager',
  // Holdings handed to a replacement (lib/transfer.ts) and controlled vocabularies (lib/vocab.ts).
  modifierId: 'modifier', assigneeId: 'assignee', reader: 'reader_label', term: 'vocab_term', aliases: 'vocab_aliases',
};

/** One stored value of a change, in the reader's language. */
function changeValueL(ctx: Ctx, field: string, v: AuditValue | undefined): string {
  const { t } = ctx;
  if (v == null || (Array.isArray(v) && !v.length)) return field === 'circuit' ? t.no_approval : field === 'featured' ? t.featured_none : field === 'reviewMonths' ? t.review_months_none : '—';
  if (typeof v === 'boolean') return field === 'granted' ? (v ? '✓' : '✕') : field === 'clientDeliverable' ? (v ? t.yes : t.no) : field === 'retentionOverride' ? (v ? t.retention_override : t.retention_follows_type) : v ? t.active_label : t.inactive;
  if (Array.isArray(v)) return v.map((x) => changeValueL(ctx, field, x)).join(field === 'circuit' ? ' → ' : ', ');
  if (typeof v === 'object') {
    return `${v.years != null ? `${v.years} ${t.years_short} · ` : ''}${t[`trig_${v.trigger}` as TKey] ?? v.trigger} · ${t[`disp_${v.disposition}` as TKey] ?? v.disposition}`;
  }
  const key = (prefix: string) => t[`${prefix}${v}` as TKey] ?? v;
  switch (field) {
    case 'title': return ctx.lang === 'fr' ? `« ${v} »` : `“${v}”`;
    case 'ownerId': case 'authorId': case 'processOwnerId': case 'holder': case 'managerId': case 'modifierId': case 'assigneeId': case 'reader': return ctx.userName(v);
    case 'conf': case 'confAllowed': case 'confDefault': return key('conf_');
    case 'origin': case 'origins': return key('or_');
    case 'attachment': case 'attachments': return key('att_');
    case 'family': return ctx.label('family', v);
    case 'grp': return key('grp_');
    case 'scope': return key('scope_');
    case 'lang': return key('lang_');
    case 'site': return ctx.label('site', v);
    case 'projectPhase': return phaseLabel(v, ctx.lang);
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
  // A value recorded alongside a change (the type's rule next to a document's class), not changed itself.
  if (!('before' in c)) return `${label ? `${label} : ` : ''}${changeValueL(ctx, c.field, c.after)}`;
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
    case 'phase': return phaseLabel(v, ctx.lang);
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

/**
 * A structured detail (AuditData.text, entries since 18 October 2026) in the reader's language: sizes in their units,
 * a step under its name in their language. A parameter of an unexpected type is left out rather than shown raw.
 */
export function auditTextL(ctx: Ctx, x: AuditText): string {
  const { t, lang } = ctx;
  const p = x.params;
  const str = (k: string) => {
    const v = p[k];
    return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : v && typeof v === 'object' ? loc(v, lang) : '';
  };
  const size = typeof p.size === 'number' ? fmtSize(p.size, lang) : '';
  const join = (...xs: string[]) => xs.filter(Boolean).join(' · ');
  switch (x.code) {
    case 'version': return join(str('label'), size, p.template ? t.audit_from_template.replace('{id}', str('template')) : '');
    case 'version_restored': return join(str('label'), t.audit_restored_from.replace('{from}', str('from')), size);
    case 'import': return join(`${str('ref')} → ${str('label')}`, size);
    case 'readers': return `${t.readers} (${str('n')})`;
    case 'step_delegated': return join(str('wf'), `${str('step')} → ${str('to')}`);
    case 'step_reassigned': return join(str('wf'), `${str('step')}${lang === 'fr' ? ' : ' : ': '}${str('from')} → ${str('to')}`);
    case 'step_transferred': return join(str('wf'), str('step'));
    case 'modifier_swap': return join(str('ref'), `${str('from')} → ${str('to')}${p.denied === true ? ` (${t.not_allowed}${lang === 'fr' ? ' : ' : ': '}${t.perm_upload})` : ''}`);
    default: return '';
  }
}

/**
 * Detail of an entry in the reader's language: its free detail (or, since 18 October 2026, its structured detail), then
 * the link it records, its changes or export figures.
 */
export function auditDetailL(ctx: Ctx, a: Pick<AuditRow, 'detail' | 'data' | 'targetId'>): string {
  const x = a.data;
  const link = x?.link ? `${ctx.t[`link_${x.link.rel}`]} ${x.link.other}${x.link.skipped ? ` : ${ctx.t[`link_skip_${x.link.skipped}`]}` : ''}` : '';
  return [x?.text ? auditTextL(ctx, x.text) || a.detail : a.detail, link, x?.changes?.length ? x.changes.map((c) => changeL(ctx, c)).join(' ; ') : '', x?.export ? exportL(ctx, a.targetId, x.export) : '', x?.file ? refusedFileL(ctx, a.targetId, x.file) : '', x?.purge ? purgeL(ctx, x.purge) : '', x?.backup ? backupL(ctx, x.backup) : '', x?.archive ? archiveL(ctx, x.archive) : '', x?.integrity ? integrityL(ctx, x.integrity) : '', x?.transfer ? transferL(ctx, x.transfer) : '', x?.sha256 ? `SHA-256 ${x.sha256.slice(0, 16)}…` : ''].filter(Boolean).join(' · ');
}

/**
 * Holdings handed to a replacement (lib/transfer.ts): to whom, and to records managers only, what by kind and how many
 * could not go (the counts include drafts, D-14).
 */
export function transferL(ctx: Ctx, x: NonNullable<AuditData['transfer']>): string {
  const { t } = ctx;
  const to = t.transfer_summary_l.replace('{to}', ctx.userName(x.to));
  if (!ctx.seesAll) return to;
  const done = Object.entries(x.done).filter(([, n]) => n).map(([k, n]) => `${t[`transfer_kind_${k}` as TKey] ?? k}${ctx.lang === 'fr' ? ' : ' : ': '}${n}`);
  return [to, ...done, x.skipped ? t.transfer_summary_skipped.replace('{n}', String(x.skipped)) : ''].filter(Boolean).join(' · ');
}

/**
 * An integrity check (lib/integrity-core.mjs): files read and their size, altered and missing ones, fingerprints
 * recorded, files out of reach; the working versions concerned, by document and label. Counts and documents to records
 * managers only: they count drafts and name them (D-14); other readers learn whether something was found.
 */
export function integrityL(ctx: Ctx, x: NonNullable<AuditData['integrity']>): string {
  const { t, lang } = ctx;
  const named = (xs: { doc: string; label: string }[], n: number) => `${xs.map((v) => `${v.doc} ${v.label}`).join(', ')}${n > xs.length ? ` ${t.integrity_more.replace('{n}', String(n - xs.length))}` : ''}`;
  if (!ctx.seesAll) return [x.failed ? t.integrity_failed_short : '', x.alteredCount || x.missingCount ? t.integrity_found : t.integrity_none].filter(Boolean).join(' · ');
  return [
    x.failed ? t.integrity_failed_short : '',
    x.by === 'cli' ? t.backup_by_cli : '',
    t.integrity_checked_n.replace('{n}', String(x.checked)).replace('{size}', fmtSize(x.bytes, lang)),
    x.alteredCount ? `${t.integrity_altered_n.replace('{n}', String(x.alteredCount))} : ${named(x.altered, x.alteredCount)}` : '',
    x.missingCount ? `${t.integrity_missing_n.replace('{n}', String(x.missingCount))} : ${named(x.missing, x.missingCount)}` : '',
    x.filled ? t.integrity_filled_n.replace('{n}', String(x.filled)) : '',
    x.skipped ? t.integrity_skipped_n.replace('{n}', String(x.skipped)) : '',
    !x.failed && !x.alteredCount && !x.missingCount ? t.integrity_none : '',
  ].filter(Boolean).join(' · ');
}

/**
 * A backup written or restored (lib/backup-core.mjs): for a restore, when the backup was made; what it holds; the
 * archive's size and the start of its SHA-256 (of the whole file, to compare with the archive kept elsewhere). What it
 * holds and its size to records managers only: they count every document, drafts and confidential ones included, so
 * that another reader would learn how many are hidden from them, and when one is added out of their sight (D-14).
 */
function backupL(ctx: Ctx, b: NonNullable<AuditData['backup']>): string {
  const { t, lang } = ctx;
  const all = ctx.seesAll;
  return [
    b.createdAt ? t.backup_of.replace('{date}', fmtDateTime(parisStamp(b.createdAt), lang)) : '',
    all ? t.backup_docs.replace('{n}', String(b.documents)) : '',
    all ? t.backup_files.replace('{n}', String(b.files)).replace('{size}', fmtSize(b.bytes, lang)) : '',
    all && b.missing ? t.backup_missing_n.replace('{n}', String(b.missing)) : '',
    all && b.sharepoint ? t.backup_sharepoint_n.replace('{n}', String(b.sharepoint)) : '',
    all && b.sha256 ? t.backup_archive.replace('{size}', fmtSize(b.size, lang)).replace('{sha}', b.sha256.slice(0, 16)) : '',
    b.replaced ? t.backup_replaced : '',
  ].filter(Boolean).join(' · ');
}

/**
 * A full export (lib/export-core.mjs): at its start, the documents and files it holds; at its end, the archive's size and
 * SHA-256 (or where it stopped), files missing from the store or not reachable. Like a backup's, the counts and sizes
 * are shown to records managers only: they count drafts (D-14). An interruption or a failure is shown to every reader.
 */
function archiveL(ctx: Ctx, x: NonNullable<AuditData['archive']>): string {
  const { t, lang } = ctx;
  const all = ctx.seesAll;
  const stopped = x.interrupted ? t.export_all_interrupted : x.failed ? t.export_all_failed : null;
  return [
    stopped ? `${stopped}${all ? ` ${t.export_all_after.replace('{size}', fmtSize(x.size ?? 0, lang))}` : ''}` : '',
    all && x.documents != null ? t.backup_docs.replace('{n}', String(x.documents)) : '',
    all && x.files != null ? t.backup_files.replace('{n}', String(x.files)).replace('{size}', fmtSize(x.bytes ?? 0, lang)) : '',
    all && x.missing ? t.backup_missing_n.replace('{n}', String(x.missing)) : '',
    all && x.skipped ? t.backup_sharepoint_n.replace('{n}', String(x.skipped)) : '',
    all && x.altered ? t.export_all_altered.replace('{n}', String(x.altered)) : '',
    all && x.sha256 ? t.backup_archive.replace('{size}', fmtSize(x.size ?? 0, lang)).replace('{sha}', x.sha256.slice(0, 16)) : '',
  ].filter(Boolean).join(' · ');
}

/**
 * Orphan files removed (lib/orphans.ts): how many, the space freed, failures; their names to records managers only, since
 * a stored name may give a draft's ID and version ("…-PRO-ING-0007_A.2.docx", D-14).
 */
function purgeL(ctx: Ctx, p: NonNullable<AuditData['purge']>): string {
  const { t, lang } = ctx;
  return [
    t.purge_files.replace('{n}', String(p.files.length)).replace('{size}', fmtSize(p.bytes, lang)),
    p.failed ? t.purge_failed.replace('{n}', String(p.failed)) : '',
    ctx.seesAll ? p.files.map((f) => f.key).join(', ') : '',
  ].filter(Boolean).join(' · ');
}

/**
 * A file refused by the virus scan: name, size, what was found, and the legacy reference of an import. Outside the
 * drafting circle, work in progress stays unseen (D-14): the name of a file sent from a screen (a new document, a
 * working version, the copy of a template) may give a draft's ID, version and subject ("PRO-ING-0007_A.2.docx"), so it is
 * shown, with the document it was meant for, to records managers only; other readers get its extension.
 */
function refusedFileL(ctx: Ctx, entry: string | null, f: NonNullable<AuditData['file']>): string {
  const threat = ctx.lang === 'fr' ? `« ${f.threat} »` : `“${f.threat}”`;
  const named = ctx.seesAll || entry === 'import';
  return [named ? f.name : extensionOf(f.name), fmtSize(f.size, ctx.lang), threat, f.ref ?? '', ctx.seesAll && f.doc ? f.doc : ''].filter(Boolean).join(' · ');
}

/**
 * The latest integrity check (lib/integrity-core.mjs, Administration or npm run integrity): when, by whom, what it found;
 * null when none was journaled. For the Journal tab, records managers only (lib/access.ts mayCheckIntegrity).
 */
export async function latestIntegrityCheck() {
  const db = await getDb();
  const [row] = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'integrity_checked')).orderBy(desc(s.auditLog.at), desc(s.auditLog.id)).limit(1);
  return row?.data?.integrity ? { at: row.at, userId: row.userId, integrity: row.data.integrity } : null;
}

/** Screen where the target of an entry without document is managed. */
function auditTargetHref(ctx: Ctx, kind: AuditTargetKind | null, id: string | null): string {
  switch (kind) {
    case 'permission': return '/administration?tab=roles';
    case 'department': case 'site': return '/administration?tab=org';
    case 'function': case 'program': return '/administration?tab=functions';
    case 'family': return `/administration${id && ctx.families.some((f) => f.key === id) ? `?family=${encodeURIComponent(id)}` : ''}`;
    case 'type': {
      const family = id ? ctx.typeByCode.get(id)?.family : undefined;
      return `/administration${family ? `?family=${encodeURIComponent(family)}` : ''}`;
    }
    case 'export': return id === 'search' ? '/recherche' : '/administration?tab=audit';
    case 'backup': return '/administration?tab=audit&backups=1';
    default: return '/administration?tab=audit';
  }
}

/**
 * Actions that change a record's metadata (the record's "Métadonnées" history): its fields, values before → after
 * (lib/actions.ts updateMeta, setReaders), the new ID a reclassification gives it, and its retention; a holding handed to
 * a replacement (owner, process owner, reader, designated author, step: lib/transfer.ts) and a vocabulary term renamed or
 * merged (lib/actions.ts applyTerm).
 */
export const METADATA_ACTIONS = ['edit', 'reclass', 'transfer', 'vocab_apply', ...RETENTION_ACTIONS] as const;

/**
 * Journal entries, newest first, as auditForReader lets the user read them. For a document, its entries under its
 * current ID and its former ones. Each entry keeps the ID it was written under (`ref`, Journal tab and export) and
 * gives the document's current one (`currentId`, activity feeds) when the user may read it. `docsOnly` (activity
 * feeds) leaves out, in the query itself, the entries without document, which would otherwise take up the `limit`;
 * so does a user without the administration screen, who never reads them. `consultations`: 'without' leaves out the
 * records opened and files previewed (activity feeds, the record's activity), 'only' lists them alone.
 */
export async function listAudit(ctx: Ctx, opts: { docId?: string; limit?: number; docsOnly?: boolean; consultations?: 'without' | 'only' } = {}) {
  const db = await getDb();
  const current = await currentIds();
  const ids = opts.docId ? [opts.docId, ...[...current].filter(([, id]) => id === opts.docId).map(([former]) => former)] : [];
  const where = opts.docId ? inArray(s.auditLog.docId, ids) : opts.docsOnly || !ctx.screens.admin ? isNotNull(s.auditLog.docId) : undefined;
  // Consultations (records opened, files previewed) left out of activity, or listed alone.
  const kind = opts.consultations === 'without' ? notInArray(s.auditLog.action, [...CONSULT_ACTIONS]) : opts.consultations === 'only' ? inArray(s.auditLog.action, [...CONSULT_ACTIONS]) : undefined;
  const rows = await auditForReader(ctx, await db.select().from(s.auditLog).where(and(where, kind)).orderBy(desc(s.auditLog.at), desc(s.auditLog.id)).limit(opts.limit ?? 500));
  return auditViews(ctx, rows, current);
}

/**
 * The `n` latest entries about documents the user may see (activity feeds: the bell's `window` is 60, the home's 500),
 * consultations left out, each under the document's current ID: listAudit over the `window` latest entries about
 * documents, narrowed to the documents listDocs gives, read by batches until `n` are found.
 */
export async function recentActivity(ctx: Ctx, n: number, window: number) {
  const db = await getDb();
  const step = Math.min(window, Math.max(n * 10, 50));
  const out: ReturnType<typeof auditViews> = [];
  let current: Map<string, string> | null = null;
  for (let offset = 0; offset < window && out.length < n; offset += step) {
    const size = Math.min(step, window - offset);
    const rows = await db.select().from(s.auditLog).where(and(isNotNull(s.auditLog.docId), notInArray(s.auditLog.action, [...CONSULT_ACTIONS])))
      .orderBy(desc(s.auditLog.at), desc(s.auditLog.id)).limit(size).offset(offset);
    current ??= await currentIds();
    // auditViews names the document under its current ID only when the user may read it; records managers read the
    // entries of every document, of which only those that exist are listed.
    const views = auditViews(ctx, await auditForReader(ctx, rows), current);
    const ids = [...new Set(views.flatMap((v) => (v.currentId ? [v.currentId] : [])))];
    const existing = new Set(ids.length ? (await db.select({ id: s.documents.id }).from(s.documents).where(anyOf(s.documents.id, ids))).map((r) => r.id) : []);
    out.push(...views.filter((v) => v.currentId && existing.has(v.currentId)));
    if (rows.length < size) break;
  }
  return out.slice(0, n);
}

/** Entries as the journal lists show them, in the user's language; `current`: current ID of each former one (currentIds). */
function auditViews(ctx: Ctx, rows: AuditEntry[], current: Map<string, string>) {
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

/** Entries per page of the Journal tab. */
export const AUDIT_PAGE_SIZE = 100;
/** Highest ID of an entry of the journal (a serial of the database, int4): a cursor beyond it points to none. */
export const AUDIT_ID_MAX = 2_147_483_647;

/** Filters of the Journal tab: who acted, the action, a piece of a document ID or of a target, days in Paris time. */
export type AuditFilter = { who?: string; action?: string; doc?: string; from?: string; to?: string };

/**
 * A page of the Journal tab: entries the user may read (auditForReader), newest first, under the filters `f`,
 * AUDIT_PAGE_SIZE of them: the newest ones, those just older than entry `before`, or those just newer than entry
 * `after` (keyset on the time and the ID, as the CSV export reads the journal). `doc` looks for a piece of the ID an
 * entry was written under, or of its target, case ignored, and finds the entries written under the former IDs of a
 * document whose current ID holds it, if the user may read it (its current ID would tell a reclassification apart).
 * `older` and `newer`: the entries to page from, or null when there is nothing beyond (the screen always offers the
 * newest entries again).
 */
export async function auditPage(ctx: Ctx, f: AuditFilter, at: { before?: number; after?: number } = {}) {
  const db = await getDb();
  const A = s.auditLog;
  const current = await currentIds();
  const empty = { rows: auditViews(ctx, [], current), older: null as number | null, newer: null as number | null };
  // A NUL character is in no stored text, and the database refuses it as a parameter.
  if (Object.values(f).some((v) => v?.includes('\0'))) return empty;
  const conds: SQL[] = [];
  if (!ctx.screens.admin) conds.push(isNotNull(A.docId));
  if (f.who) conds.push(eq(A.userId, f.who));
  if (f.action) conds.push(eq(A.action, f.action));
  if (f.doc) {
    const like = `%${f.doc.replace(/[\\%_]/g, '\\$&')}%`;
    const former = sql`select jsonb_array_elements_text(${D.aliases}) from ${D} where ${D.id} ilike ${like} and ${readableSql(ctx)}`;
    conds.push(sql`(${A.docId} ilike ${like} or ${A.targetId} ilike ${like} or ${A.docId} in (${former}))`);
  }
  // Midnight in Paris, computed by the database: it reads every day a date field accepts, from 0001 to 9999.
  const day = (v?: string) => (v && parseIsoDay(v) === v ? v : undefined);
  const since = day(f.from), until = day(f.to);
  if (since) conds.push(sql`${A.at} >= (${since}::date::timestamp at time zone ${TIME_ZONE})`);
  if (until) conds.push(sql`${A.at} < ((${until}::date + 1)::timestamp at time zone ${TIME_ZONE})`);
  const cursor = (v?: number) => (v != null && Number.isSafeInteger(v) && v >= 1 && v <= AUDIT_ID_MAX ? v : undefined);
  const pivotId = cursor(at.after) ?? cursor(at.before);
  const [pivot] = pivotId != null ? await db.select({ at: A.at, id: A.id }).from(A).where(eq(A.id, pivotId)) : [];
  const newer = !!pivot && cursor(at.after) != null;
  // Read a batch at a time, until one entry more than a page is readable: it tells there is more beyond.
  const found: AuditEntry[] = [];
  let from = pivot ?? null;
  for (;;) {
    const beyond = from ? (newer ? sql`(${A.at}, ${A.id}) > (${from.at}::timestamptz, ${from.id})` : sql`(${A.at}, ${A.id}) < (${from.at}::timestamptz, ${from.id})`) : undefined;
    const batch = await db.select().from(A).where(and(...conds, beyond)).orderBy(...(newer ? [asc(A.at), asc(A.id)] : [desc(A.at), desc(A.id)])).limit(500);
    found.push(...(await auditForReader(ctx, batch)));
    if (found.length > AUDIT_PAGE_SIZE || batch.length < 500) break;
    from = batch[batch.length - 1];
  }
  const more = found.length > AUDIT_PAGE_SIZE;
  const page = found.slice(0, AUDIT_PAGE_SIZE);
  if (newer) page.reverse();
  const rows = auditViews(ctx, page, current);
  if (!rows.length) return empty;
  return {
    rows,
    // Coming from a page, there is that page beyond.
    older: newer || more ? rows[rows.length - 1].id : null,
    newer: pivot && !newer ? rows[0].id : newer && more ? rows[0].id : null,
  };
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
    /** What the retention rests on, in the reader's language (lib/i18n.ts retentionBasisL). */
    basisL: retentionBasisL(x, ctx.lang),
    confL: x.confAllowed.map((c) => ctx.t[`conf_${c}` as TKey]).join(', '),
    confDefaultL: ctx.t[`conf_${x.confDefault}` as TKey],
  };
}
export type TypeView = ReturnType<typeof typeView>;

/**
 * Retention classes of each type's documents (all of them: the rule applies to every one, whoever reads it), for the
 * type dialog to say how many a change of the type's rule would reach (lib/actions.ts updateType, applyTypeRetention):
 * `following`, the classes of those that follow the type's rule, by value, frozen ones apart; `overrides`, the number of
 * derogations, never changed by it. Counts only, to whoever edits the register.
 */
export async function retentionByType(tx?: Tx) {
  const db = tx ?? (await getDb());
  const D = s.documents;
  const rows = await db.select({ code: D.typeCode, years: D.retentionYears, trigger: D.retentionTrigger, disposition: D.retentionDisposition, override: D.retentionOverride, held: D.legalHold, n: sql<number>`count(*)::int` })
    .from(D).groupBy(D.typeCode, D.retentionYears, D.retentionTrigger, D.retentionDisposition, D.retentionOverride, D.legalHold);
  const out = new Map<string, RetentionByType>();
  for (const r of rows) {
    const x = out.get(r.code) ?? { following: [], overrides: 0 };
    if (r.override) x.overrides += Number(r.n);
    else x.following.push({ retentionYears: r.years, retentionTrigger: r.trigger, retentionDisposition: r.disposition, held: r.held, n: Number(r.n) });
    out.set(r.code, x);
  }
  return out;
}
export type RetentionByType = { following: { retentionYears: number | null; retentionTrigger: string; retentionDisposition: string; held: boolean; n: number }[]; overrides: number };

/**
 * What refers to each entry of the register, counted over every document whatever its state or confidentiality (shown
 * in Administration only): an entry referred to keeps its code or key and cannot be deleted (lib/actions.ts). The
 * entries Codex's own rules name count as referred to (lib/registry-rules.ts BUILT_IN_TYPES, BUILT_IN_FUNCTIONS).
 * - types: documents of the type, pieces Keystone expects of it on a project;
 * - families: types and documents of the family;
 * - functions: types whose circuit has it, holders, steps of circuits started (they keep its key);
 * - programs: documents of the programme, holders of a research-scoped function for it.
 * `docs`: documents only, per type and per programme, for the counts on screen.
 */
export async function registryUsage(tx?: Tx) {
  const db = tx ?? (await getDb());
  const count = sql<number>`count(*)::int`;
  const [byType, expected, templated, byFamily, typesByFamily, holders, steps, byProgram, programHolders, circuits] = await Promise.all([
    db.select({ k: s.documents.typeCode, n: count }).from(s.documents).groupBy(s.documents.typeCode),
    db.select({ k: s.projectExpected.typeCode, n: count }).from(s.projectExpected).where(isNotNull(s.projectExpected.typeCode)).groupBy(s.projectExpected.typeCode),
    db.select({ k: s.templateTypes.typeCode, n: count }).from(s.templateTypes).groupBy(s.templateTypes.typeCode),
    db.select({ k: s.documents.family, n: count }).from(s.documents).groupBy(s.documents.family),
    db.select({ k: s.docTypes.family, n: count }).from(s.docTypes).groupBy(s.docTypes.family),
    db.select({ k: s.functionHolders.functionKey, n: count }).from(s.functionHolders).groupBy(s.functionHolders.functionKey),
    db.select({ k: s.workflowSteps.functionKey, n: count }).from(s.workflowSteps).where(isNotNull(s.workflowSteps.functionKey)).groupBy(s.workflowSteps.functionKey),
    db.select({ k: s.documents.programCode, n: count }).from(s.documents).where(isNotNull(s.documents.programCode)).groupBy(s.documents.programCode),
    db.select({ k: s.functionHolders.scopeValue, n: count }).from(s.functionHolders).innerJoin(s.functions, eq(s.functions.key, s.functionHolders.functionKey))
      .where(and(eq(s.functions.scope, 'research'), isNotNull(s.functionHolders.scopeValue))).groupBy(s.functionHolders.scopeValue),
    db.select({ circuit: s.docTypes.circuit }).from(s.docTypes),
  ]);
  const tally = (...lists: { k: string | null; n: number }[][]) => {
    const m = new Map<string, number>();
    for (const xs of lists) for (const { k, n } of xs) if (k) m.set(k, (m.get(k) ?? 0) + n);
    return m;
  };
  const inCircuits = circuits.flatMap((c) => [...new Set(c.circuit)].map((k) => ({ k, n: 1 })));
  const builtIn = (keys: readonly string[]) => keys.map((k) => ({ k, n: 1 }));
  return {
    types: tally(byType, expected, templated, builtIn(BUILT_IN_TYPES)),
    families: tally(byFamily, typesByFamily),
    functions: tally(inCircuits, holders, steps, builtIn(BUILT_IN_FUNCTIONS)),
    programs: tally(byProgram, programHolders),
    docs: { types: tally(byType), programs: tally(byProgram) },
  };
}
export type RegistryUsage = Awaited<ReturnType<typeof registryUsage>>;

/**
 * What refers to each department and site (lib/org-rules.ts OrgUsage), counted over every document whatever its state
 * or confidentiality (Administration only): one referred to is made inactive rather than deleted (lib/actions.ts).
 * - departments: documents, people (system actors aside), holders of a department-scoped function for it, searches
 *   shared with it, and the identifiers given under its code (the counters of lib/codification.ts, kept for good:
 *   `doc:TYPE-CONTEXT`, a type code holding no dash);
 * - sites: documents and people.
 */
export async function orgUsage(tx?: Tx): Promise<{ departments: Map<string, OrgUsage>; sites: Map<string, OrgUsage> }> {
  const db = tx ?? (await getDb());
  const count = sql<number>`count(*)::int`;
  const context = sql<string>`substring(${s.idCounters.scope} from '^doc:[^-]+-(.*)$')`;
  const [docsByDept, docsBySite, peopleByDept, peopleBySite, holders, searches, ids] = await Promise.all([
    db.select({ k: s.documents.department, n: count }).from(s.documents).groupBy(s.documents.department),
    db.select({ k: s.documents.site, n: count }).from(s.documents).where(isNotNull(s.documents.site)).groupBy(s.documents.site),
    db.select({ k: s.users.department, n: count }).from(s.users).where(and(eq(s.users.isSystem, false), isNotNull(s.users.department))).groupBy(s.users.department),
    db.select({ k: s.users.site, n: count }).from(s.users).where(and(eq(s.users.isSystem, false), isNotNull(s.users.site))).groupBy(s.users.site),
    db.select({ k: s.functionHolders.scopeValue, n: count }).from(s.functionHolders).innerJoin(s.functions, eq(s.functions.key, s.functionHolders.functionKey))
      .where(and(eq(s.functions.scope, 'department'), isNotNull(s.functionHolders.scopeValue))).groupBy(s.functionHolders.scopeValue),
    db.select({ k: s.savedSearches.department, n: count }).from(s.savedSearches).where(isNotNull(s.savedSearches.department)).groupBy(s.savedSearches.department),
    db.select({ k: context, n: count }).from(s.idCounters).where(sql`${s.idCounters.scope} like 'doc:%'`).groupBy(context),
  ]);
  const tally = (parts: Partial<Record<keyof OrgUsage, { k: string | null; n: number }[]>>) => {
    const m = new Map<string, OrgUsage>();
    for (const [field, rows] of Object.entries(parts) as [keyof OrgUsage, { k: string | null; n: number }[]][]) {
      for (const { k, n } of rows) if (k) m.set(k, { ...(m.get(k) ?? NO_USAGE), [field]: n });
    }
    return m;
  };
  // A counter's context may also be a project, a programme or QMS: read by department code, those are never looked up.
  return { departments: tally({ documents: docsByDept, people: peopleByDept, holders, searches, ids }), sites: tally({ documents: docsBySite, people: peopleBySite }) };
}

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
 * The same rules hold as on the other screens (D-14), read for the department only: documents the user may read
 * (departmentDocs, listDocs narrowed to it), circuits they may follow (workflowsWhere, `visible`: records managers all
 * of them, others those they take part in, never outside the drafting circle), saved searches they may see
 * (listSavedSearches). Null for an unknown department.
 */
export async function departmentPage(ctx: Ctx, code: string) {
  const db = await getDb();
  const [row] = await db.select().from(s.departments).where(eq(s.departments.code, code));
  if (!row) return null;
  const [own, workflows, saved] = await Promise.all([
    departmentDocs(ctx, code),
    // Running circuits on the department's documents (the list keeps those the user may follow and that are not over).
    workflowsWhere(ctx, and(sql`coalesce(${s.workflows.outcome}, '') = ''`, sql`${s.workflows.docId} in (select d.id from ${s.documents} d where d.department = ${code})`)),
    listSavedSearches(ctx),
  ]);
  const ids = new Set(own.map((d) => d.id));
  const keys = featuredOf(row);
  const of = (facets: Facets) => searchHref({ facets: { department: [code], ...facets } });
  return {
    code,
    label: ctx.label('department', code),
    /** Inactive (Administration › Organisation): no longer offered to a new document; its page stays for its documents. */
    active: row.active,
    /** Documents of the department the user may read, in force, most recently modified first. */
    inForce: own.filter((d) => d.status === 'in_force'),
    deadlines: deadlines(ctx, own),
    workflows: workflows.filter((w) => w.visible && !w.done && ids.has(w.docId)),
    /** Shared with this department first, then with the whole group; personal searches stay on /recherche. */
    saved: [...saved.filter((x) => x.scope === 'department' && x.department === code), ...saved.filter((x) => x.scope === 'group')],
    featured: featuredFilters(own, code, keys, (k, v) => facetValueL(ctx, k, v), ctx.lang),
    /** The featured facets follow the default ones (no setting of the department's own). */
    featuredDefault: row.featured == null,
    /** The facets put forward, in order (empty: Administration set none for the department). */
    featuredKeys: keys,
    /** /recherche on the department, and on its documents in force. */
    href: { all: of({}), inForce: of({ status: ['in_force'] }) },
  };
}

/** Types each of these templates is meant for (lib/actions.ts setTemplateTypes), in register order. */
export async function templateTypesOf(ctx: Ctx, docIds: string[]): Promise<Map<string, string[]>> {
  const m = new Map<string, string[]>();
  if (!docIds.length) return m;
  const db = await getDb();
  const rows = await db.select().from(s.templateTypes).where(anyOf(s.templateTypes.docId, docIds));
  const order = new Map(ctx.types.map((x, i) => [x.code, i]));
  for (const r of rows) m.set(r.docId, [...(m.get(r.docId) ?? []), r.typeCode]);
  for (const codes of m.values()) codes.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return m;
}

/**
 * Templates available to "Nouveau depuis un modèle": template-type documents in force, with their file (same rule as
 * createDocument), and the types each is meant for (`types`, empty when none is set).
 */
export async function listTemplates(ctx: Ctx) {
  const [ix, candidates] = await Promise.all([getAccessIndex(ctx), visibleWhere(ctx, is(col(D.typeCode), TEMPLATE_TYPE))]);
  const docs = candidates.filter((d) => isUsableTemplate(ctx, d, ix));
  const [types, uses] = await Promise.all([templateTypesOf(ctx, docs.map((d) => d.id)), templateUses(ctx, docs.map((d) => d.id))]);
  return docs.map((d) => ({ id: d.id, label: d.title, rev: d.revInForce!, owner: d.owner, ownerId: d.ownerId, typeCode: d.typeCode, department: d.department, state: d.state, legalHold: d.legalHold, version: d.version, types: types.get(d.id) ?? [], uses: uses.get(d.id) ?? 0 }));
}

/**
 * Uses of each template (documents.template_id, point 66): the documents created from it that the reader may read
 * (readableSql, D-14: a draft or a confidential document they may not read is not counted, so the figure tells
 * nothing of documents they cannot see). Records managers count them all. Documents created before 18 October 2026
 * count only when the migration could tell their template for sure (drizzle/0004_modele_source.sql).
 */
async function templateUses(ctx: Ctx, ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const db = await getDb();
  const rows = await db.select({ id: s.documents.templateId, n: sql<number>`count(*)::int` }).from(s.documents)
    .where(and(inArray(s.documents.templateId, ids), readableSql(ctx)))
    .groupBy(s.documents.templateId);
  return new Map(rows.map((r) => [r.id!, r.n]));
}

// ── Controlled vocabularies (point 59 of docs/reste-a-faire.md) ─────────

/**
 * Terms the forms offer (source organisation, keywords), by name: those a document the user may read carries
 * (readableSql, D-14: a term met only on drafts or on documents they may not read is not shown to them), and those no
 * document carries (added in Administration). Records managers get every term. Empty for whoever may neither create nor
 * edit a document. A term the user is not offered is still recognised when typed (lib/actions.ts readVocab).
 */
export async function vocabSuggestions(ctx: Ctx): Promise<{ sourceOrgs: string[]; keywords: string[] }> {
  if (!ctx.can('upload') && !ctx.can('edit')) return { sourceOrgs: [], keywords: [] };
  const db = await getDb();
  const all = ctx.seesAll ? null : await bothDocumentValues(db, readableSql(ctx));
  const offered = async (kind: VocabKind) => {
    const terms = await loadTerms(db, kind);
    if (!all) return terms.map((x) => x.name);
    const values = all[kind];
    const used = new Set<string>(), seen = new Set<string>();
    for (const v of values) {
      const k = vocabKey(v.value);
      used.add(k);
      if (v.readable) seen.add(k);
    }
    return terms.filter((x) => { const keys = termKeys(x); return keys.some((k) => seen.has(k)) || !keys.some((k) => used.has(k)); }).map((x) => x.name);
  };
  const byName = (xs: string[]) => xs.sort((p, q) => p.localeCompare(q, ctx.lang, { sensitivity: 'base' }));
  const [sourceOrgs, keywords] = await Promise.all([offered('source_org'), offered('keyword')]);
  return { sourceOrgs: byName(sourceOrgs), keywords: byName(keywords) };
}

/** A term of a vocabulary as Administration › Vocabulaires lists it: how many documents carry it, in any spelling. */
export type VocabRow = { id: number; name: string; aliases: string[]; uses: number; createdAt: string };

/**
 * Every term of both vocabularies with the documents that carry it, drafts and confidential ones included
 * (administration only), the values documents carry that no term stands for, and the sub-types documents carry outside
 * their type's list (lib/vocab-rules.ts canonicalSubtype), by type, most frequent first.
 */
export async function vocabOverview(ctx: Ctx): Promise<Record<VocabKind, { terms: VocabRow[]; unlisted: { value: string; uses: number }[] }> & { subtypes: { typeCode: string; value: string; uses: number }[] }> {
  const db = await getDb();
  const one = async (kind: VocabKind) => {
    const [terms, values] = await Promise.all([loadTerms(db, kind), documentValues(db, kind)]);
    const byKey = new Map<string, number>();
    for (const v of values) byKey.set(vocabKey(v.value), (byKey.get(vocabKey(v.value)) ?? 0) + v.n);
    const covered = new Set(terms.flatMap(termKeys));
    const rows = terms.map((x): VocabRow => ({ id: x.id, name: x.name, aliases: x.aliases, uses: termKeys(x).reduce((n, k) => n + (byKey.get(k) ?? 0), 0), createdAt: x.createdAt }));
    const unlisted = new Map<string, { value: string; uses: number }>();
    for (const v of values) {
      const k = vocabKey(v.value);
      if (covered.has(k)) continue;
      const cur = unlisted.get(k);
      if (cur) cur.uses += v.n;
      else unlisted.set(k, { value: v.value, uses: v.n });
    }
    rows.sort((p, q) => p.name.localeCompare(q.name, ctx.lang, { sensitivity: 'base' }) || p.id - q.id);
    return { terms: rows, unlisted: [...unlisted.values()].sort((p, q) => q.uses - p.uses || p.value.localeCompare(q.value, ctx.lang)) };
  };
  const D = s.documents;
  const [source_org, keyword, used] = await Promise.all([
    one('source_org'), one('keyword'),
    db.select({ typeCode: D.typeCode, value: D.subtype, n: sql<number>`count(*)::int` }).from(D).where(isNotNull(D.subtype)).groupBy(D.typeCode, D.subtype),
  ]);
  const subtypes = used.flatMap((x) => {
    const type = ctx.typeByCode.get(x.typeCode);
    return x.value && type && !canonicalSubtype(type.subtypes, x.value).listed ? [{ typeCode: x.typeCode, value: x.value, uses: Number(x.n) }] : [];
  }).sort((p, q) => q.uses - p.uses || p.typeCode.localeCompare(q.typeCode) || p.value.localeCompare(q.value, ctx.lang));
  return { source_org, keyword, subtypes };
}

// ── Holdings of a person who leaves (point 19 of docs/reste-a-faire.md) ─────

/**
 * The simulation of Administration › Reprise: what `from` holds and, with a replacement chosen, what would go to them and
 * what would not, and why (lib/transfer.ts, the transfer itself rolled back). Null for an unknown person or a system
 * actor. Records managers only (access.ts mayTransferHoldings): it names every document the person holds, drafts
 * included (D-14).
 */
export async function transferView(ctx: Ctx, from: string, to: string | null): Promise<TransferPlan | null> {
  if (!mayTransferHoldings(ctx)) return null;
  const f = ctx.users.get(from);
  if (!f || f.isSystem) return null;
  const t = to ? ctx.users.get(to) : undefined;
  const replacement = t && !t.isSystem && t.id !== f.id ? t.id : null;
  return simulateTransfer(await getDb(), ctx.users, ctx.user.id, f.id, replacement);
}
