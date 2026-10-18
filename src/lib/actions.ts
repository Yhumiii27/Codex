'use server';

import { createHmac, randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { refresh } from 'next/cache';
import { getDb, schema as s } from '@/db';
import type { Attachment, AuditChange, AuditValue, Conf, Origin, SearchScope } from '@/db/schema';
import { buildAccessIndex, canRead, followsCircuit, getAccessIndex, inDraftingCircle, isUsableTemplate, mayBackUp, mayCheckIntegrity, mayCleanStorage, mayDeleteSearch, mayEditLinks, mayLinkTemplate, mayManageRetention, mayReassignStep, mayRecall, mayRecordReview, maySaveSearch, maySetRetentionEvent, mayWorkOnDraft, readerMaySeeRevision, readersApply, mayTransferHoldings, seesSavedSearch } from './access';
import { idMatches, nextDocId, nextWorkflowId, TEMPLATE_TYPE } from './codification';
import { changeAuthor, seenVersion, seenWorkingBase, staleText, workingIssue, workingStaleText, type WorkingBase } from './concurrency';
import { backUpNow } from './backup';
import { checkFilesNow } from './integrity';
import { COOKIE_LANG, COOKIE_ROLE, COOKIE_USER, getCtx, type Ctx } from './context';
import { addDays, fmtDate, fmtDateTime, fmtSize, loc, nowStamp, parisStamp, parseIsoDay, todayIso } from './format';
import { ATTACHMENTS, CONF_LEVELS, ENFORCED_PERMS, MATRIX_ROLE, MATRIX_ROLES, ORIGINS, PERMS, SEARCH_SCOPES, SIM_ROLES, SIMULATED_MATRIX_ROLES, type Perm, type TKey } from './i18n';
import { addLink, applyChangeDecision, applyPendingDecision, approverCheck, approveRevision, audit, circuitExclusions, catchUpEffectiveDates, journalConsultation, journalLink, linkBetween, lockOf, refreshHeadline, type ModifierSwap, type Tx } from './lifecycle';
import { changes, entryChanges, familyJournal, functionJournal, retentionValue, typeJournal } from './journal-values';
import { isLinkRel, linkIssue, otherEnd, replacementIssue, storedLink } from './links';
import { logger, traceAction } from './log';
import { limitWrite } from './ratelimit';
import { decisionWaitL, orgUsage, registryUsage, sameFiles } from './queries';
import { dateIssues, dateIssueText, effectIssue, issueFrom, latestEffect, type DateIssue } from './dates';
import { cleanFeatured } from './departments';
import { inUse, isOrgKind, lastActiveIssue, orgLabels, parseOrgForm, type OrgKind } from './org-rules';
import { fileIssueReason, fileIssueText, fileRules } from './filetypes';
import { MAX_PER_RUN, purgeOrphans } from './orphans';
import {
  builtInScopeIssue, builtInTypeIssue, departmentCodeIssue, keyIssue, outsideType, parseFamilyForm, parseFunctionForm, parseProgramForm, parseRetentionRule, parseTypeForm, programCodeIssue, PROJECT_MANAGER_FUNCTIONS,
  SUBTYPE_MAX, SUBTYPES_MAX, typeCodeIssue, type CodeSpace, type FormIssue, type ProgramValues, type TypeValues,
} from './registry-rules';
import { isEventTrigger, parseEventDate, sameRule } from './retention';
import { nextReviewDate } from './review';
import { beyondBounds, cleanCriteria, hasCriteria, type SearchInput } from './search';
import { discardFile, FileRejectedError, fileColumns, nameStoredFile, readStored, renameDocFiles, sha256Of, stageFile, stageUpload, type StagedFile } from './storage';
import { submitChange, vigieSimulated } from './vigie';
import { confirmTransfer } from './transfer';
import { addTerms, documentsWith, loadTerms, readTerms, termById, VOCAB_TABLE } from './vocab';
import { canonicalSubtype, cleanTerm, docLang, isVocabKind, termKeys, termNameIssue, VOCAB_MAX, vocabKey, type VocabKind } from './vocab-rules';

/**
 * `field`: the form field the error is about, when the dialog can show it there. `stale`: the view the request came
 * from is out of date (lib/concurrency.ts): the dialog offers to reload the record. `confirm`: what to send back to
 * confirm what the error announced, and only that (updateType). `warning`: done, with something the user should know (a
 * file identical to one already filed), shown longer than a message.
 */
export type ActionResult = { ok: true; href?: string; message?: string; warning?: string } | { ok: false; error: string; field?: string; stale?: true; confirm?: string };

type DocRow = typeof s.documents.$inferSelect;

const log = logger('action');

const YEAR = 60 * 60 * 24 * 365;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const opt = (fd: FormData, k: string) => str(fd, k) || null;
const dedupe = (xs: string[]) => [...new Set(xs)];
const docHref = (id: string, tab?: string) => `/documents/${encodeURIComponent(id)}${tab ? `?tab=${tab}` : ''}`;

function fail(ctx: Ctx, key: TKey = 'error', extra?: string): ActionResult {
  return { ok: false, error: extra ? `${ctx.t[key]} : ${extra}` : ctx.t[key] };
}

/** A date that breaks a rule of lib/dates.ts, with the field to correct. */
function dateFail(ctx: Ctx, issue: DateIssue): ActionResult {
  return { ok: false, error: dateIssueText(ctx.t, ctx.lang, issue), field: issue.field === 'effective' ? 'effectiveAt' : issue.field };
}

function denied(ctx: Ctx, perm: Perm): ActionResult {
  return { ok: false, error: `${ctx.t.not_allowed} : ${ctx.t[`perm_${perm}` as TKey]}` };
}

/**
 * Every action that writes counts against its user's budget (CODEX_RATE_WRITES, lib/ratelimit.ts) before its own
 * checks: beyond it, the refusal to show, and the action does nothing. Each write action runs through traceAction
 * (lib/log.ts), which logs its name, outcome and duration.
 */
function throttled(ctx: Ctx): ActionResult | null {
  const wait = limitWrite(ctx.user.id);
  if (!wait) return null;
  log.warn('write rate limited', { user: ctx.user.id, retryAfter: wait });
  return { ok: false, error: ctx.t.rate_limited.replace('{n}', String(wait)) };
}

/**
 * The non-blocking warning of an upload whose file is identical (same SHA-256) to one already filed: the documents the
 * user may have that file of (queries.ts sameFiles, D-14), else nothing. A failure of the lookup never fails the upload.
 */
async function duplicateWarning(ctx: Ctx, sha256: string): Promise<string | undefined> {
  try {
    const same = await sameFiles(ctx, sha256);
    if (!same.length) return undefined;
    const quote = (x: string) => (ctx.lang === 'fr' ? `« ${x} »` : `“${x}”`);
    return ctx.t.same_file.replace('{docs}', same.map((x) => `${x.docId} ${x.label} ${quote(x.title)}`).join(', '));
  } catch (err) {
    log.warn('duplicate check failed', { err });
    return undefined;
  }
}

/**
 * The refusal of a file stopped on its way in (lib/storage.ts stageFile: format, size, virus scan), in the user's
 * language; any other error (a store out of reach) is thrown again. `template`: the file is the copy of this template,
 * which the user did not choose: the refusal names it and says who can replace it.
 */
function refusedFile(ctx: Ctx, err: unknown, template?: string): ActionResult {
  if (!(err instanceof FileRejectedError)) throw err;
  const r = err.rejection;
  const { t, lang } = ctx;
  if (r.code === 'scan_failed') return { ok: false, error: t.file_scan_failed };
  if (r.code === 'scan_too_large') return { ok: false, error: t.file_scan_too_large };
  if (template) {
    const reason = r.code === 'infected' ? t.file_reason_infected.replace('{threat}', r.threat) : fileIssueReason(t, lang, r);
    return { ok: false, error: t.file_template_refused.replace('{id}', template).replace('{reason}', reason) };
  }
  return { ok: false, error: r.code === 'infected' ? t.file_infected.replace('{threat}', r.threat) : fileIssueText(t, lang, r, fileRules(process.env)) };
}

function uploadedFile(fd: FormData, key = 'file'): File | null {
  const f = fd.get(key);
  return f instanceof File && f.size > 0 ? f : null;
}

async function workingRevision(tx: Tx, docId: string) {
  const revs = await tx.select().from(s.revisions).where(eq(s.revisions.docId, docId)).orderBy(desc(s.revisions.id));
  return revs.find((r) => r.status === 'draft' || r.status === 'in_review' || r.status === 'approved') ?? null;
}

async function activeWorkflow(tx: Tx, docId: string) {
  const wfs = await tx.select().from(s.workflows).where(eq(s.workflows.docId, docId));
  return wfs.find((w) => !w.outcome) ?? null;
}

// ── Concurrent changes (lib/concurrency.ts) ──────────────────────────────

/**
 * Who made the last change of a document's record: the author of the journal entries written in the transaction that
 * last changed its row (the row's xmin; the database skips an update that changes nothing, src/db/index.ts), chosen by
 * lib/concurrency.ts changeAuthor. Null when that change wrote no entry. Only for the drafting circle, who reads every
 * entry (D-14): the actions that refuse an outdated view are reserved to it.
 */
async function lastChangedBy(tx: Tx, ctx: Ctx, docId: string): Promise<string | null> {
  const entries = await tx.select({ userId: s.auditLog.userId, docId: s.auditLog.docId }).from(s.auditLog)
    .innerJoin(s.documents, and(eq(s.documents.id, docId), sql`${s.auditLog}.xmin = ${s.documents}.xmin`))
    .orderBy(desc(s.auditLog.id));
  return changeAuthor(entries, docId, (u) => !!ctx.users.get(u)?.isSystem);
}

/** Refusal of a write from an outdated view: nothing written, the dialog offers to reload the record. */
function stale(ctx: Ctx, who: string | null): ActionResult {
  return { ok: false, error: staleText(ctx.t, who ? ctx.userName(who) : null), stale: true };
}

/**
 * A request about a document under an ID it no longer has: reclassified since the view it came from (former IDs are
 * kept as aliases and never handed out again). Outdated for whoever may still make it (`may`), not found for others.
 */
async function movedSince(tx: Tx, ctx: Ctx, id: string, may: (d: DocRow) => boolean): Promise<ActionResult> {
  const [d] = id ? await tx.select().from(s.documents).where(sql`${s.documents.aliases} @> ${JSON.stringify([id])}::jsonb`) : [];
  return d && may(d) ? stale(ctx, await lastChangedBy(tx, ctx, d.id)) : fail(ctx, 'not_found');
}

// ── Session (simulated) ──────────────────────────────────────────────────

export async function setLang(lang: string) {
  (await cookies()).set(COOKIE_LANG, lang === 'en' ? 'en' : 'fr', { path: '/', maxAge: YEAR, sameSite: 'lax' });
  refresh();
}

export async function simulateUser(userId: string, role: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const db = await getDb();
  const [u] = await db.select().from(s.users).where(and(eq(s.users.id, userId), eq(s.users.isSystem, false)));
  if (!u) return fail(ctx);
  const jar = await cookies();
  jar.set(COOKIE_USER, u.id, { path: '/', maxAge: YEAR, sameSite: 'lax' });
  jar.set(COOKIE_ROLE, (SIM_ROLES as readonly string[]).includes(role) ? role : u.role, { path: '/', maxAge: YEAR, sameSite: 'lax' });
  refresh();
  return { ok: true };
}

// ── Metadata ─────────────────────────────────────────────────────────────

type Fields = {
  title: string; typeCode: string; subtype: string | null; origin: Origin; attachment: Attachment; projectCode: string | null; programCode: string | null;
  department: string; site: string | null; ownerId: string; authorId: string | null; authorText: string | null; conf: Conf; keywords: string[]; lang: string | null;
  reviewDueAt: string | null; expiresAt: string | null; sourceOrg: string | null; externalRef: string | null; receivedAt: string | null;
  projectPhase: string | null; workPackage: string | null; discipline: string | null; researchTheme: string | null; studyId: string | null; ipStatus: string | null; processOwnerId: string | null;
};

function readFields(ctx: Ctx, fd: FormData, base?: DocRow): Fields {
  const pick = <T extends string>(k: string, allowed: readonly T[], fallback: T) => {
    const v = str(fd, k) as T;
    return allowed.includes(v) ? v : fallback;
  };
  const typeCode = str(fd, 'typeCode') || base?.typeCode || '';
  const type = ctx.typeByCode.get(typeCode);
  // fr or en, whatever the case; any other value is kept for validateFields to refuse (unless the document has it).
  const rawLang = opt(fd, 'lang');
  const lang = docLang(rawLang);
  const attachment = pick('attachment', ATTACHMENTS, base?.attachment ?? type?.attachments[0] ?? 'none');
  const origin = pick('origin', ORIGINS, base?.origin ?? type?.origins[0] ?? 'interne');
  return {
    title: str(fd, 'title') || base?.title || '',
    // A sub-type takes its type's spelling when it folds to one of its labels; another value is kept (MET-17).
    typeCode, subtype: canonicalSubtype(type?.subtypes ?? [], opt(fd, 'subtype')).value, origin, attachment,
    projectCode: attachment === 'project' ? opt(fd, 'projectCode') : null,
    programCode: attachment === 'research' ? opt(fd, 'programCode') : null,
    // Not sent: the user's department, refused by validateFields when inactive; without one, the first active department.
    department: str(fd, 'department') || base?.department || ctx.user.department || ctx.departments.find((d) => d.active)?.code || '',
    site: opt(fd, 'site'),
    ownerId: str(fd, 'ownerId') || base?.ownerId || ctx.user.id,
    ...readAuthor(ctx, fd, base),
    conf: pick('conf', CONF_LEVELS, base?.conf ?? type?.confDefault ?? 'interne'),
    keywords: dedupe(str(fd, 'keywords').split(',').map(cleanTerm).filter(Boolean)),
    lang: lang === undefined ? rawLang : lang,
    reviewDueAt: opt(fd, 'reviewDueAt'), expiresAt: opt(fd, 'expiresAt'),
    sourceOrg: origin === 'externe' ? cleanTerm(str(fd, 'sourceOrg')) || null : null,
    externalRef: origin === 'externe' ? opt(fd, 'externalRef') : null,
    receivedAt: origin === 'externe' ? opt(fd, 'receivedAt') : null,
    projectPhase: attachment === 'project' ? opt(fd, 'projectPhase') : null,
    workPackage: attachment === 'project' ? opt(fd, 'workPackage') : null,
    discipline: attachment === 'project' ? opt(fd, 'discipline') : null,
    researchTheme: attachment === 'research' ? opt(fd, 'researchTheme') : null,
    studyId: attachment === 'research' ? opt(fd, 'studyId') : null,
    ipStatus: attachment === 'research' ? opt(fd, 'ipStatus') : null,
    processOwnerId: origin === 'interne' ? opt(fd, 'processOwnerId') : null,
  };
}

/** Longest free-text author, as the import takes it (lib/importer.ts). */
const AUTHOR_TEXT_MAX = 200;
/** Longest sub-type and most keywords of a document, as the import takes them (lib/importer.ts). */
const DOC_SUBTYPE_MAX = 200;
const KEYWORDS_MAX = 50;

/**
 * The source organisation and keywords of a form read against their vocabularies (lib/vocab.ts): each value becomes the
 * name of the term it stands for (« SIEMENS » → « Siemens »). A value no term stands for is a new term, added only when
 * the form confirms it (`confirmTerm`, one per new value, as the form offers it) or when the document already carries it
 * (`base`); otherwise the form is refused on its field, with the values to confirm (`confirm`, a JSON list), and nothing
 * is written. `add`: the terms to add with the document, in its transaction (addTerms).
 */
async function readVocab(ctx: Ctx, fd: FormData, f: Fields, base?: DocRow): Promise<{ refused: ActionResult } | { sourceOrg: string | null; keywords: string[]; add: { kind: VocabKind; names: string[] }[] }> {
  const db = await getDb();
  const confirmed = new Set(fd.getAll('confirmTerm').map((x) => vocabKey(String(x))));
  for (const v of [base?.sourceOrg, ...(base?.keywords ?? [])]) if (v) confirmed.add(vocabKey(v));
  const [orgs, kws] = await Promise.all([loadTerms(db, 'source_org'), loadTerms(db, 'keyword')]);
  const org = readTerms(orgs, f.sourceOrg ? [f.sourceOrg] : [], confirmed);
  const keywords = readTerms(kws, f.keywords, confirmed);
  for (const [field, x] of [['sourceOrg', org], ['keywords', keywords]] as const) {
    if (x.unconfirmed.length) {
      const quoted = x.unconfirmed.map((v) => (ctx.lang === 'fr' ? `« ${v} »` : `“${v}”`)).join(', ');
      return { refused: { ok: false, error: ctx.t.vocab_confirm_new.replace('{terms}', quoted), field, confirm: JSON.stringify(x.unconfirmed) } };
    }
  }
  return { sourceOrg: org.values[0] ?? null, keywords: keywords.values, add: [{ kind: 'source_org', names: org.added }, { kind: 'keyword', names: keywords.added }] };
}

/**
 * The author of a document (MET-10): a person of the group or a free text (external author), never both. The dialogs
 * send `authorKind` ('person' with `authorId`, 'text' with `authorText`); the value left empty is refused by
 * authorMissing, an unknown person by validateFields. Without `authorKind` (partial calls): a text when one is sent,
 * else a person when one is sent, else the document's current author, or the creator for a new document.
 */
function readAuthor(ctx: Ctx, fd: FormData, base?: DocRow): Pick<Fields, 'authorId' | 'authorText'> {
  const kind = str(fd, 'authorKind');
  const text = opt(fd, 'authorText');
  const person = opt(fd, 'authorId');
  if (kind === 'text') return { authorId: null, authorText: text };
  if (kind === 'person') return { authorId: person, authorText: null };
  if (text) return { authorId: null, authorText: text };
  if (person) return { authorId: person, authorText: null };
  return base ? { authorId: base.authorId, authorText: base.authorText } : { authorId: ctx.user.id, authorText: null };
}

/** The author kind a dialog chose, its value left empty: refused on the field to fill. */
function authorMissing(ctx: Ctx, fd: FormData): ActionResult | null {
  const kind = str(fd, 'authorKind');
  if (kind === 'text' && !opt(fd, 'authorText')) return { ok: false, error: ctx.t.author_required, field: 'authorText' };
  if (kind === 'person' && !opt(fd, 'authorId')) return { ok: false, error: ctx.t.author_required, field: 'authorId' };
  return null;
}

/** Metadata fields an edit changes, with their values before and after (retention follows a change of type). */
function metaChanges(d: DocRow, f: Fields, retention: Partial<Pick<DocRow, 'retentionYears' | 'retentionTrigger' | 'retentionDisposition' | 'retentionOverride'>>): AuditChange[] {
  return changes([
    ...(Object.keys(f) as (keyof Fields)[]).map((k): [string, AuditValue, AuditValue] => [k, d[k], f[k]]),
    ['retention', retentionValue(d), retentionValue({ ...d, ...retention })],
    ['retentionOverride', d.retentionOverride, retention.retentionOverride ?? d.retentionOverride],
  ]);
}

/**
 * Business rules of the register: type admits origin, attachment and confidentiality; contextual fields are filled.
 * An inactive type, programme, department or site is refused, except for a document that already has it (`current`).
 */
function validateFields(ctx: Ctx, f: Fields, current?: Pick<DocRow, 'typeCode' | 'programCode' | 'department' | 'site' | 'lang'>): ActionResult | null {
  const type = ctx.typeByCode.get(f.typeCode);
  if (!f.title || !type || !(type.active || type.code === current?.typeCode)) return fail(ctx);
  if (!type.origins.includes(f.origin) || !type.attachments.includes(f.attachment)) return fail(ctx, 'type_mismatch');
  if (!type.confAllowed.includes(f.conf)) return fail(ctx, 'conf_not_allowed');
  if (f.attachment === 'project' && !ctx.projects.some((p) => p.code === f.projectCode)) return fail(ctx, 'project_required');
  // An inactive programme (closed) is no longer offered, except to a document that already has it.
  if (f.attachment === 'research' && !ctx.programs.some((p) => p.code === f.programCode && (p.active || p.code === current?.programCode))) return fail(ctx, 'program_required');
  if (f.origin === 'externe' && !f.sourceOrg) return fail(ctx, 'source_required');
  // Controlled values (point 59): the language is fr, en or none (a document that has another one keeps it); the lengths
  // the import admits for the sub-type, the keywords and the source organisation.
  if (f.lang && docLang(f.lang) === undefined && f.lang !== current?.lang) return { ok: false, error: ctx.t.lang_invalid, field: 'lang' };
  if (f.subtype && f.subtype.length > DOC_SUBTYPE_MAX) return { ok: false, error: ctx.t.value_too_long.replace('{n}', String(DOC_SUBTYPE_MAX)), field: 'subtype' };
  if (f.keywords.length > KEYWORDS_MAX || f.keywords.some((k) => k.length > VOCAB_MAX.keyword)) return { ok: false, error: ctx.t.keywords_too_many.replace('{n}', String(KEYWORDS_MAX)).replace('{len}', String(VOCAB_MAX.keyword)), field: 'keywords' };
  if (f.sourceOrg && f.sourceOrg.length > VOCAB_MAX.source_org) return { ok: false, error: ctx.t.value_too_long.replace('{n}', String(VOCAB_MAX.source_org)), field: 'sourceOrg' };
  // A department or a site made inactive (Administration › Organisation) is no longer offered, except where it is set.
  const dept = ctx.departments.find((d) => d.code === f.department);
  if (!dept) return fail(ctx);
  if (!dept.active && dept.code !== current?.department) return { ok: false, error: ctx.t.department_inactive, field: 'department' };
  const site = f.site ? ctx.sites.find((x) => x.key === f.site) : null;
  if (site === undefined) return fail(ctx);
  if (site && !site.active && site.key !== current?.site) return { ok: false, error: ctx.t.site_inactive, field: 'site' };
  if (!ctx.users.has(f.ownerId) || ctx.users.get(f.ownerId)!.isSystem) return fail(ctx);
  // The author: a person of the group (not a system actor) or a free text (readAuthor). A record migrated without one
  // shows its owner (docView), whom the edit dialog proposes.
  if (f.authorId && (!ctx.users.has(f.authorId) || ctx.users.get(f.authorId)!.isSystem)) return { ok: false, error: ctx.t.author_unknown, field: 'authorId' };
  if (f.authorText && f.authorText.length > AUTHOR_TEXT_MAX) return { ok: false, error: ctx.t.author_too_long.replace('{n}', String(AUTHOR_TEXT_MAX)), field: 'authorText' };
  if (f.processOwnerId && !ctx.users.has(f.processOwnerId)) return fail(ctx);
  // Dates: real calendar days, sent by the form as YYYY-MM-DD (a Server Action can be called with anything).
  for (const [k, label] of [['reviewDueAt', 'review_due_at'], ['expiresAt', 'expires_at'], ['receivedAt', 'received_at']] as const) {
    const v = f[k];
    if (v && parseIsoDay(v) !== v) return { ok: false, error: `${ctx.t[label]} : ${ctx.t.date_malformed}`, field: k };
  }
  // The rule that needs no revision (a reception in the future); createDocument and updateMeta check the others.
  const dated = dateIssues({ ...f, issuedAt: null, effective: null }, todayIso())[0];
  return dated ? dateFail(ctx, dated) : null;
}

// ── Documents ────────────────────────────────────────────────────────────

/** Runs a transaction that records a staged file; the file is removed when the transaction throws. */
async function withStaged<T>(staged: StagedFile | null, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    await discardFile(staged);
    throw err;
  }
}

/**
 * New document: ID TYPE-CONTEXTE-SEQ, revision A in draft, and working version A.1 from an uploaded file or a copy of
 * a template (FRM-QMS-…). Without either, the document exists with its ID and waits for its first working version.
 */
export async function createDocument(...args: Parameters<typeof createDocumentNow>): Promise<ActionResult> {
  return traceAction('createDocument', () => createDocumentNow(...args));
}
async function createDocumentNow(fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!ctx.can('upload')) return denied(ctx, 'upload');
  const f = readFields(ctx, fd);
  const invalid = authorMissing(ctx, fd) ?? validateFields(ctx, f);
  if (invalid) return invalid;
  // A new document is issued today at the earliest: its expiry and its review come after.
  const dated = dateIssues({ ...f, issuedAt: null, issueFrom: todayIso(), effective: null }, todayIso())[0];
  if (dated) return dateFail(ctx, dated);
  const vocab = await readVocab(ctx, fd, f);
  if ('refused' in vocab) return vocab.refused;
  f.sourceOrg = vocab.sourceOrg;
  f.keywords = vocab.keywords;
  const type = ctx.typeByCode.get(f.typeCode)!;
  const file = uploadedFile(fd);
  const templateId = opt(fd, 'templateId');
  const expectedId = Number(str(fd, 'expectedId')) || null;
  const db = await getDb();

  let template: { buf: Buffer; name: string; mime: string; title: string } | null = null;
  if (!file && templateId) {
    // Same rule as the templates the dialog offers (listTemplates): a template the user cannot see does not exist for them.
    const [tpl] = await db.select().from(s.documents).where(eq(s.documents.id, templateId));
    if (!tpl || !isUsableTemplate(ctx, tpl, await getAccessIndex())) return fail(ctx, 'not_found');
    const [rev] = await db.select().from(s.revisions).where(and(eq(s.revisions.docId, tpl.id), eq(s.revisions.status, 'in_force')));
    if (!rev) return fail(ctx, 'not_found');
    const [v] = await db.select().from(s.workingVersions).where(eq(s.workingVersions.revisionId, rev.id)).orderBy(desc(s.workingVersions.n)).limit(1);
    template = { buf: Buffer.alloc(0), name: v?.fileName ?? '', mime: v?.mime ?? '', title: tpl.title };
    if (v?.fileKey) {
      try {
        template.buf = await readStored(v.storage, v.fileKey);
      } catch {
        return fail(ctx, 'error', tpl.id);
      }
      // A template whose stored bytes no longer match the fingerprint recorded at its upload is not copied.
      if (v.sha256 && sha256Of(template.buf) !== v.sha256) {
        log.error('template file altered', { doc: tpl.id, version: v.id });
        return fail(ctx, 'file_altered_template', tpl.id);
      }
    }
  }
  if (expectedId) {
    // A piece Keystone expects is filled by a document of its type only.
    const [exp] = await db.select().from(s.projectExpected).where(eq(s.projectExpected.id, expectedId));
    if (exp?.typeCode && exp.typeCode !== f.typeCode) return fail(ctx, 'piece_type_mismatch', exp.typeCode);
  }

  const today = todayIso();
  // The file goes to the store before the transaction: an upload never holds the database.
  let staged: StagedFile | null;
  try {
    staged = file ? await stageUpload(file, { userId: ctx.user.id, entry: 'create' })
      : template?.buf.length ? await stageFile(template.buf, template.name, template.mime, { userId: ctx.user.id, entry: 'template', doc: templateId ?? undefined })
      : null;
  } catch (err) {
    // A template stored before formats were checked, or in a format refused since, is checked again here.
    return refusedFile(ctx, err, file ? undefined : templateId ?? undefined);
  }
  // A copy of a template is that template's file by design: only a file sent by the user is compared.
  const warning = file && staged ? await duplicateWarning(ctx, staged.sha256) : undefined;
  const id = await withStaged(staged, () => db.transaction(async (tx) => {
    for (const x of vocab.add) await addTerms(tx, x.kind, x.names, ctx.user.id);
    const id = await nextDocId(tx, f);
    await tx.insert(s.documents).values({
      id, ...f, family: type.family,
      status: 'draft', revWorking: 'A', createdAt: today, modifiedAt: today,
      retentionYears: type.retentionYears, retentionTrigger: type.retentionTrigger, retentionDisposition: type.retentionDisposition,
    });
    const [rev] = await tx.insert(s.revisions).values({ docId: id, letter: 'A', status: 'draft', createdAt: today }).returning();
    if (staged || template) {
      const comment = template ? { fr: `Créé depuis le modèle ${templateId} « ${template.title} »`, en: `Created from template ${templateId} “${template.title}”` } : { fr: 'Dépôt initial', en: 'Initial upload' };
      await tx.insert(s.workingVersions).values({ revisionId: rev.id, docId: id, n: 1, comment, authorId: ctx.user.id, date: today, ...(staged ? fileColumns(staged) : {}) });
    }
    await audit(tx, ctx.user.id, 'upload', id, `A.1${staged ? ` · ${fmtSize(staged.size, 'fr')}` : ''}${templateId ? ` · ${templateId}` : ''}`, rev.id, staged ? { sha256: staged.sha256 } : null);
    if (f.attachment === 'project' && f.projectCode && expectedId) {
      // A document filed for a piece Keystone expects fills that piece (only if it is still missing).
      const [exp] = await tx.select().from(s.projectExpected).where(and(eq(s.projectExpected.id, expectedId), eq(s.projectExpected.projectCode, f.projectCode)));
      if (exp && !exp.docId && (!exp.typeCode || exp.typeCode === f.typeCode)) {
        await tx.update(s.projectExpected).set({ docId: id }).where(eq(s.projectExpected.id, exp.id));
        const label = typeof exp.label === 'string' ? { fr: exp.label, en: exp.label } : exp.label;
        // No document ID in the project feed: every reader of the project sees it, the draft is visible to its circle only.
        await tx.insert(s.projectEvents).values({ projectCode: f.projectCode, at: nowStamp(), text: { fr: `Pièce « ${label.fr} » déposée`, en: `“${label.en}” filed` } });
      }
    }
    return id;
  }));
  if (staged) await nameStoredFile(staged, id, 'A.1');
  refresh();
  return { ok: true, href: docHref(id, f.attachment === 'project' ? 'project' : 'meta'), message: `${ctx.t.id_preview} : ${id}`, ...(warning ? { warning } : {}) };
}

/**
 * An upload or an approval request (`from`) from a dialog that did not show the last working version of the revision
 * drafted (`rev`), as its `base` says (lib/concurrency.ts workingIssue): refused, naming the version uploaded since and
 * its author, or as an outdated record (another revision, no base). Null when the base is the last version.
 */
async function uploadBehind(tx: Tx, ctx: Ctx, docId: string, rev: { id: number; letter: string }, base: WorkingBase | null, from: 'upload' | 'validate' = 'upload'): Promise<ActionResult | null> {
  const [latest] = await tx.select().from(s.workingVersions).where(eq(s.workingVersions.revisionId, rev.id)).orderBy(desc(s.workingVersions.n)).limit(1);
  const issue = workingIssue(base, rev, latest);
  if (issue === 'newer') return { ok: false, error: workingStaleText(ctx.t, `${rev.letter}.${latest.n}`, ctx.userName(latest.authorId), from), stale: true };
  return issue ? stale(ctx, base ? await lastChangedBy(tx, ctx, docId) : null) : null;
}

/**
 * Next working version (A.2, A.3…) of the revision being drafted. The dialog sends the last working version it showed
 * (`baseRevision`, `baseVersion`): when another was uploaded since, the upload is refused with its label and author,
 * rather than added on top of a version its author has not seen (D-12 keeps both).
 */
export async function addWorkingVersion(...args: Parameters<typeof addWorkingVersionNow>): Promise<ActionResult> {
  return traceAction('addWorkingVersion', () => addWorkingVersionNow(...args));
}
async function addWorkingVersionNow(fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!ctx.can('upload')) return denied(ctx, 'upload');
  const docId = str(fd, 'docId');
  const file = uploadedFile(fd);
  if (!file) return fail(ctx, 'choose_file');
  const base = seenWorkingBase(fd.get('baseRevision'), fd.get('baseVersion'));
  const db = await getDb();
  const ix = await getAccessIndex();
  const [d] = await db.select().from(s.documents).where(eq(s.documents.id, docId));
  if (!d) return movedSince(db, ctx, docId, (x) => canRead(ctx, x, ix) && mayWorkOnDraft(ctx, x, ix));
  // Access first: a document the user cannot see gives nothing away, not even its lock.
  if (!canRead(ctx, d, ix)) return fail(ctx, 'not_found');
  if (!mayWorkOnDraft(ctx, d, ix)) return fail(ctx, 'not_allowed');
  const lock = lockOf(d);
  if (lock) return fail(ctx, lock);
  const open = await workingRevision(db, docId);
  if (!open) return fail(ctx, 'need_in_force');
  if (open.status !== 'draft') return fail(ctx, 'not_draft');
  // Before the file goes to the store, and again in the transaction.
  const behind = await uploadBehind(db, ctx, docId, open, base);
  if (behind) return behind;
  let staged: StagedFile;
  try {
    staged = await stageUpload(file, { userId: ctx.user.id, entry: 'working', doc: docId });
  } catch (err) {
    return refusedFile(ctx, err);
  }
  const warning = await duplicateWarning(ctx, staged.sha256);
  const comment = str(fd, 'comment');
  const res = await withStaged(staged, () => db.transaction(async (tx): Promise<{ err: TKey } | { behind: ActionResult } | { label: string }> => {
    // Checked again inside the transaction: a validation request or another upload may have come in during the upload.
    const [cur] = await tx.select().from(s.documents).where(eq(s.documents.id, docId));
    if (!cur) return { err: 'not_found' };
    const locked = lockOf(cur);
    if (locked) return { err: locked };
    const rev = await workingRevision(tx, docId);
    if (!rev || rev.id !== open.id || rev.status !== 'draft') return { err: 'not_draft' };
    const late = await uploadBehind(tx, ctx, docId, rev, base);
    if (late) return { behind: late };
    const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${s.workingVersions.n}), 0)::int` }).from(s.workingVersions).where(eq(s.workingVersions.revisionId, rev.id));
    const n = max + 1;
    await tx.insert(s.workingVersions).values({ revisionId: rev.id, docId, n, comment: comment || { fr: 'Nouvelle version de travail', en: 'New working version' }, authorId: ctx.user.id, date: todayIso(), ...fileColumns(staged) });
    await tx.update(s.documents).set({ modifiedAt: todayIso() }).where(eq(s.documents.id, docId));
    await audit(tx, ctx.user.id, 'working', docId, `${rev.letter}.${n} · ${fmtSize(staged.size, 'fr')}`, rev.id, { sha256: staged.sha256 });
    return { label: `${rev.letter}.${n}` };
  }));
  if (!('label' in res)) {
    await discardFile(staged);
    return 'err' in res ? fail(ctx, res.err) : res.behind;
  }
  await nameStoredFile(staged, docId, res.label);
  refresh();
  return { ok: true, href: docHref(docId, 'versions'), ...(warning ? { warning } : {}) };
}

/**
 * A piece Keystone expects stays filled only by a document of its project and type: after a reclassification, the
 * pieces the document no longer matches are expected again (the project feed says so, without the document's ID).
 */
async function releasePieces(tx: Tx, docId: string, f: Fields) {
  const filled = await tx.select().from(s.projectExpected).where(eq(s.projectExpected.docId, docId));
  for (const p of filled) {
    if (f.attachment === 'project' && p.projectCode === f.projectCode && (!p.typeCode || p.typeCode === f.typeCode)) continue;
    await tx.update(s.projectExpected).set({ docId: null }).where(eq(s.projectExpected.id, p.id));
    const label = typeof p.label === 'string' ? { fr: p.label, en: p.label } : p.label;
    await tx.insert(s.projectEvents).values({ projectCode: p.projectCode, at: nowStamp(), text: { fr: `Pièce « ${label.fr} » de nouveau attendue : le document déposé a été reclassé`, en: `“${label.en}” expected again: the filed document was reclassified` } });
  }
}

/**
 * Edit metadata. Until a revision has been approved, a change of type or context re-codifies the document.
 * Type and context resolve the approval circuit: they cannot change while a workflow runs.
 * The form sends back the version of the record it was filled from (`version`): every field it sends overwrites the
 * stored one, so a record changed since is refused as outdated, with nothing written (lib/concurrency.ts).
 */
export async function updateMeta(...args: Parameters<typeof updateMetaNow>): Promise<ActionResult> {
  return traceAction('updateMeta', () => updateMetaNow(...args));
}
async function updateMetaNow(fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!ctx.can('edit')) return denied(ctx, 'edit');
  const docId = str(fd, 'docId');
  const seen = seenVersion(fd.get('version'));
  const db = await getDb();
  const ix = await getAccessIndex();
  const mayEdit = (x: DocRow) => ctx.seesAll || x.ownerId === ctx.user.id;
  const [d] = await db.select().from(s.documents).where(eq(s.documents.id, docId));
  if (!d) return movedSince(db, ctx, docId, (x) => canRead(ctx, x, ix) && mayEdit(x));
  if (!canRead(ctx, d, ix)) return fail(ctx, 'not_found');
  if (!mayEdit(d)) return fail(ctx, 'not_allowed');
  const lock = lockOf(d);
  if (lock) return fail(ctx, lock);
  if (d.version !== seen) return stale(ctx, seen === null ? null : await lastChangedBy(db, ctx, docId));
  const f = readFields(ctx, fd, d);
  const invalid = authorMissing(ctx, fd) ?? validateFields(ctx, f, d);
  if (invalid) return invalid;
  const vocab = await readVocab(ctx, fd, f, d);
  if ('refused' in vocab) return vocab.refused;
  f.sourceOrg = vocab.sourceOrg;
  f.keywords = vocab.keywords;
  const type = ctx.typeByCode.get(f.typeCode)!;
  const reclassified = f.typeCode !== d.typeCode || f.attachment !== d.attachment || f.projectCode !== d.projectCode || f.programCode !== d.programCode || f.department !== d.department;
  const res = await db.transaction(async (tx): Promise<{ err: TKey } | { date: DateIssue } | { id: string } | { stale: string | null }> => {
    // Again where it is written: what changed since the check above would be overwritten by the form's fields.
    const [cur] = await tx.select({ version: s.documents.version }).from(s.documents).where(eq(s.documents.id, docId)).for('update');
    if (cur?.version !== seen) return { stale: cur ? await lastChangedBy(tx, ctx, docId) : null };
    if (reclassified && (await activeWorkflow(tx, docId))) return { err: 'circuit_running' };
    const revs = await tx.select().from(s.revisions).where(eq(s.revisions.docId, docId));
    // Dates the dialog edits, against the issue date and the revisions' effective dates on record (which it does not
    // edit): every date, changed or not. Then the dates this edit enters, against what can only happen from today on:
    // the approval of a revision in review, the first issue of a document not issued yet. A date left as it is is not
    // held to these, which time alone may break (an expired document under renewal keeps its expiry until then).
    const today = todayIso();
    const ahead = latestEffect(revs, today);
    const entered = { reviewDueAt: f.reviewDueAt !== d.reviewDueAt ? f.reviewDueAt : null, expiresAt: f.expiresAt !== d.expiresAt ? f.expiresAt : null, receivedAt: null };
    const dated = [
      ...dateIssues({ ...f, issuedAt: d.issuedAt, effective: latestEffect(revs) }, today),
      ...dateIssues({ ...entered, issuedAt: d.issuedAt, issueFrom: issueFrom(d.issuedAt, ahead, today), effective: ahead }, today),
    ].find((i) => i.field !== 'effective');
    if (dated) return { date: dated };
    for (const x of vocab.add) await addTerms(tx, x.kind, x.names, ctx.user.id);
    const everApproved = revs.some((r) => r.approvedAt);
    let id = docId;
    if (!everApproved && !idMatches(docId, f)) {
      id = await nextDocId(tx, f);
      // documents.id cascades to every table that references it. The journal is append-only: its entries keep the
      // former ID, kept as an alias, and this entry links it to the new one (listAudit reads both).
      await tx.update(s.documents).set({ id, aliases: [...d.aliases, docId] }).where(eq(s.documents.id, docId));
      // Before any approval, the reclassification belongs to the revision being drafted.
      await audit(tx, ctx.user.id, 'reclass', id, `${docId} → ${id}`, revs.find((r) => r.status === 'draft' || r.status === 'in_review')?.id ?? null);
    }
    // A new type brings its own rule: a derogation granted under the former type does not carry over (D-20).
    const retention = f.typeCode !== d.typeCode ? { retentionYears: type.retentionYears, retentionTrigger: type.retentionTrigger, retentionDisposition: type.retentionDisposition, retentionOverride: false } : {};
    await tx.update(s.documents).set({ ...f, family: type.family, ...retention, modifiedAt: todayIso() }).where(eq(s.documents.id, id));
    // A document that is no longer a template is offered for no type any more.
    const unlinked = d.typeCode === TEMPLATE_TYPE && f.typeCode !== TEMPLATE_TYPE
      ? (await tx.delete(s.templateTypes).where(eq(s.templateTypes.docId, id)).returning()).map((x) => x.typeCode).sort()
      : [];
    // The values changed, with what decides who reads them: the strictest level across the change, and whether a
    // revision was in force (work on a draft stays in its drafting circle, D-14).
    const changed = [...metaChanges(d, f, retention), ...changes([['templateTypes', unlinked, null]])];
    const strictest = CONF_LEVELS[Math.max(CONF_LEVELS.indexOf(d.conf), CONF_LEVELS.indexOf(f.conf))] ?? f.conf;
    await audit(tx, ctx.user.id, 'edit', id, d.revInForce ?? d.revWorking ?? '', null, changed.length ? { changes: changed, doc: { conf: strictest, inForce: !!d.revInForce } } : null);
    // Named readers only count for confidential levels (lib/access.ts): below, they are dropped rather than left unseen.
    if (!readersApply(f.conf)) {
      const dropped = await tx.delete(s.documentReaders).where(eq(s.documentReaders.docId, id)).returning();
      if (dropped.length) await audit(tx, ctx.user.id, 'edit', id, `${ctx.t.readers} (0)`);
    }
    if (f.attachment !== d.attachment || f.projectCode !== d.projectCode || f.typeCode !== d.typeCode) await releasePieces(tx, id, f);
    return { id };
  });
  if ('err' in res) return fail(ctx, res.err);
  if ('date' in res) return dateFail(ctx, res.date);
  if ('stale' in res) return stale(ctx, res.stale);
  const newId = res.id;
  // Stored files follow the new ID (outside the transaction, as every store call).
  if (newId !== docId) await renameDocFiles(newId);
  refresh();
  return { ok: true, message: newId !== docId ? `${ctx.t.act_reclass} : ${newId}` : ctx.t.saved_ok, href: newId !== docId ? docHref(newId, 'meta') : undefined };
}

/**
 * Named readers of a confidential or "très confidentiel" document (owner or records manager, with the edit permission).
 * `version`: the version of the record the dialog showed; the list replaces the stored one, so a record changed since
 * is refused as outdated, as by updateMeta (lib/concurrency.ts).
 */
export async function setReaders(...args: Parameters<typeof setReadersNow>): Promise<ActionResult> {
  return traceAction('setReaders', () => setReadersNow(...args));
}
async function setReadersNow(docId: string, userIds: string[], version: number): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!ctx.can('edit')) return denied(ctx, 'edit');
  const seen = seenVersion(version);
  const db = await getDb();
  const ix = await getAccessIndex();
  const mayEdit = (x: DocRow) => ctx.seesAll || x.ownerId === ctx.user.id;
  const [d] = await db.select().from(s.documents).where(eq(s.documents.id, docId));
  if (!d) return movedSince(db, ctx, docId, (x) => canRead(ctx, x, ix) && mayEdit(x));
  if (!canRead(ctx, d, ix)) return fail(ctx, 'not_found');
  if (!mayEdit(d)) return fail(ctx, 'not_allowed');
  const lock = lockOf(d);
  if (lock) return fail(ctx, lock);
  if (d.version !== seen) return stale(ctx, seen === null ? null : await lastChangedBy(db, ctx, docId));
  const ids = dedupe(userIds).filter((u) => ctx.users.has(u) && !ctx.users.get(u)!.isSystem);
  // Below "confidentiel" readers have no effect: leftovers can only be removed.
  if (ids.length && !readersApply(d.conf)) return fail(ctx, 'conf_not_allowed');
  const res = await db.transaction(async (tx): Promise<{ stale: string | null } | null> => {
    const [cur] = await tx.select({ version: s.documents.version }).from(s.documents).where(eq(s.documents.id, docId)).for('update');
    if (cur?.version !== seen) return { stale: cur ? await lastChangedBy(tx, ctx, docId) : null };
    await tx.delete(s.documentReaders).where(eq(s.documentReaders.docId, docId));
    if (ids.length) await tx.insert(s.documentReaders).values(ids.map((userId) => ({ docId, userId })));
    // The readers are kept apart from the row: its version is raised here, for the dialogs open on the record.
    await tx.update(s.documents).set({ version: sql`${s.documents.version} + 1` }).where(eq(s.documents.id, docId));
    await audit(tx, ctx.user.id, 'edit', docId, `${ctx.t.readers} (${ids.length})`);
    return null;
  });
  if (res) return stale(ctx, res.stale);
  refresh();
  return { ok: true, message: ctx.t.saved_ok };
}

/**
 * Types a template is meant for (« Nouveau depuis un modèle » offers it first to a document of these types): on a
 * template (type FRM), by its owner or a records manager with the edit permission (access.ts mayLinkTemplate), not
 * locked. Each code is a type of the register, active unless the template is already linked to it. `version`: of the
 * record the dialog showed (lib/concurrency.ts), raised here as for the named readers. Journaled as a metadata edit,
 * before → after, its values within the drafting circle until a revision is in force (D-14).
 */
export async function setTemplateTypes(...args: Parameters<typeof setTemplateTypesNow>): Promise<ActionResult> {
  return traceAction('setTemplateTypes', () => setTemplateTypesNow(...args));
}
async function setTemplateTypesNow(docId: string, typeCodes: string[], version: number): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!ctx.can('edit')) return denied(ctx, 'edit');
  const seen = seenVersion(version);
  const db = await getDb();
  const ix = await getAccessIndex();
  const [d] = await db.select().from(s.documents).where(eq(s.documents.id, String(docId)));
  if (!d) return movedSince(db, ctx, String(docId), (x) => canRead(ctx, x, ix) && mayLinkTemplate(ctx, x));
  if (!canRead(ctx, d, ix)) return fail(ctx, 'not_found');
  if (d.typeCode !== TEMPLATE_TYPE) return fail(ctx, 'template_only');
  if (!mayLinkTemplate(ctx, d)) return fail(ctx, 'not_allowed');
  const lock = lockOf(d);
  if (lock) return fail(ctx, lock);
  if (d.version !== seen) return stale(ctx, seen === null ? null : await lastChangedBy(db, ctx, d.id));
  const codes = dedupe((Array.isArray(typeCodes) ? typeCodes : []).map(String)).sort();
  const res = await db.transaction(async (tx): Promise<ActionResult | { outdated: string | null } | null> => {
    const [cur] = await tx.select({ version: s.documents.version }).from(s.documents).where(eq(s.documents.id, d.id)).for('update');
    if (cur?.version !== seen) return { outdated: cur ? await lastChangedBy(tx, ctx, d.id) : null };
    const before = (await tx.select().from(s.templateTypes).where(eq(s.templateTypes.docId, d.id))).map((x) => x.typeCode).sort();
    // A type withdrawn from the register (inactive) is kept where it is set, never added.
    const bad = codes.find((c) => { const type = ctx.typeByCode.get(c); return !type || (!type.active && !before.includes(c)); });
    if (bad) return { ok: false, error: `${ctx.t.template_type_unknown} : ${bad}` };
    const changed = changes([['templateTypes', before, codes]]);
    if (!changed.length) return null;
    await tx.delete(s.templateTypes).where(eq(s.templateTypes.docId, d.id));
    if (codes.length) await tx.insert(s.templateTypes).values(codes.map((typeCode) => ({ docId: d.id, typeCode })));
    // The links are kept apart from the row: the record is dated as by a metadata edit, its version raised for the
    // dialogs open on it.
    await tx.update(s.documents).set({ modifiedAt: todayIso(), version: sql`${s.documents.version} + 1` }).where(eq(s.documents.id, d.id));
    await audit(tx, ctx.user.id, 'edit', d.id, d.revInForce ?? d.revWorking ?? '', null, { changes: changed, doc: { conf: d.conf, inForce: !!d.revInForce } });
    return null;
  });
  if (res && 'outdated' in res) return stale(ctx, res.outdated);
  if (res) return res;
  refresh();
  return { ok: true, message: ctx.t.saved_ok };
}

// ── Periodic review ──────────────────────────────────────────────────────

/** Longest comment of a recorded review, kept in the journal. */
const REVIEW_COMMENT_MAX = 2000;

/**
 * Records the periodic review of a document (G36, point 13 of docs/reste-a-faire.md): its revision in force stays
 * applicable, and no revision is created. For its owner, its process owner and records managers, with the edit
 * permission (access.ts, mayRecordReview), on a document they can read, not locked, with a revision in force. Sets the
 * next review date: the day entered, after today, else the type's periodicity counted from today (lib/review.ts,
 * nextReviewDate). Journaled on the document as a whole, with the optional comment and the review date before → after.
 */
export async function recordReview(...args: Parameters<typeof recordReviewNow>): Promise<ActionResult> {
  return traceAction('recordReview', () => recordReviewNow(...args));
}
async function recordReviewNow(docId: string, next: string | null, comment = ''): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!ctx.can('edit')) return denied(ctx, 'edit');
  const note = typeof comment === 'string' ? comment.trim() : '';
  if (note.length > REVIEW_COMMENT_MAX) return { ok: false, error: ctx.t.review_comment_too_long, field: 'comment' };
  const entered = typeof next === 'string' && next.trim() ? next.trim() : null;
  const ix = await getAccessIndex();
  const db = await getDb();
  const res = await db.transaction(async (tx): Promise<{ err: TKey; field?: string } | { date: string }> => {
    const [d] = await tx.select().from(s.documents).where(eq(s.documents.id, docId));
    // Access first: a document the user cannot see gives nothing away, not even its lock.
    if (!d || !canRead(ctx, d, ix)) return { err: 'not_found' };
    if (!mayRecordReview(ctx, d)) return { err: 'review_reserved' };
    const lock = lockOf(d);
    if (lock) return { err: lock };
    if (!d.revInForce) return { err: 'review_need_in_force' };
    const today = todayIso();
    const set = nextReviewDate(entered, today, ctx.typeByCode.get(d.typeCode)?.reviewMonths);
    if ('err' in set) return { err: set.err, field: 'next' };
    await tx.update(s.documents).set({ reviewDueAt: set.date, modifiedAt: today }).where(eq(s.documents.id, docId));
    // About the document as a whole and its revision in force: its readers see it, values included (D-14).
    const changed = changes([['reviewDueAt', d.reviewDueAt, set.date]]);
    await audit(tx, ctx.user.id, 'reviewed', docId, note, null, changed.length ? { changes: changed, doc: { conf: d.conf, inForce: true } } : null);
    return { date: set.date };
  });
  if ('err' in res) {
    const error = res.err === 'date_malformed' ? `${ctx.t.review_next} : ${ctx.t.date_malformed}` : ctx.t[res.err];
    return { ok: false, error, ...(res.field ? { field: res.field } : {}) };
  }
  refresh();
  return { ok: true, message: `${ctx.t.review_recorded} ${fmtDate(res.date, ctx.lang)}` };
}

// ── Approval workflows ───────────────────────────────────────────────────

/**
 * Resolves a function to a person for this document: holder for the document's department, project or programme,
 * then the project or programme manager where relevant, then the group-level holder. Never someone excluded (author,
 * requester), never someone whose role cannot approve; someone not yet holding a step of the circuit when possible.
 */
async function resolveFunction(tx: Tx, ctx: Ctx, key: string, d: DocRow, excluded: Set<string>, taken: Set<string>, mayApprove: (id: string) => boolean): Promise<string | null> {
  const fn = ctx.functions.find((x) => x.key === key);
  if (!fn) return null;
  const holders = await tx.select().from(s.functionHolders).where(eq(s.functionHolders.functionKey, key));
  const scoped = fn.scope === 'department' ? d.department : fn.scope === 'project' ? d.projectCode : fn.scope === 'research' ? d.programCode : null;
  const candidates = [
    ...holders.filter((h) => scoped && h.scopeValue === scoped).map((h) => h.userId),
    ...(fn.scope === 'project' && d.projectCode && PROJECT_MANAGER_FUNCTIONS.includes(key) ? [ctx.projects.find((p) => p.code === d.projectCode)?.managerId] : []),
    ...(fn.scope === 'research' && d.programCode ? [ctx.programs.find((p) => p.code === d.programCode)?.managerId] : []),
    ...holders.filter((h) => !h.scopeValue).map((h) => h.userId),
  ].filter((u): u is string => !!u && !excluded.has(u) && mayApprove(u));
  return candidates.find((u) => !taken.has(u)) ?? candidates[0] ?? null;
}

/**
 * Starts the circuit of the document's type on the revision being drafted. Every check runs inside the transaction.
 * `base`: the last working version the dialog showed (as for an upload, lib/concurrency.ts): the circuit does not start
 * on a version uploaded since, which its requester has not seen.
 */
export async function requestValidation(...args: Parameters<typeof requestValidationNow>): Promise<ActionResult> {
  return traceAction('requestValidation', () => requestValidationNow(...args));
}
async function requestValidationNow(docId: string, effectiveAt: string | null, base: WorkingBase | null): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!ctx.can('edit')) return denied(ctx, 'edit');
  const seen = seenWorkingBase(base?.revisionId, base?.n);
  // Effective date: a real day, today or later (approveRevision moves it to the approval day if the circuit outlasts it).
  const effective = effectiveAt ? parseIsoDay(effectiveAt) : null;
  if (effectiveAt && (!effective || effective < todayIso())) return fail(ctx, 'invalid_date');
  const ix = await getAccessIndex();
  const db = await getDb();

  type Res = { id: string } | { href: string } | { err: TKey; extra?: string } | { date: DateIssue } | { behind: ActionResult };
  const res = await db.transaction(async (tx): Promise<Res> => {
    const [d] = await tx.select().from(s.documents).where(eq(s.documents.id, docId));
    if (!d || !canRead(ctx, d, ix)) return { err: 'not_found' };
    if (!mayWorkOnDraft(ctx, d, ix)) return { err: 'not_allowed' };
    const lock = lockOf(d);
    if (lock) return { err: lock };
    const active = await activeWorkflow(tx, docId);
    if (active) return { href: `/validations?f=active&r=${encodeURIComponent(active.id)}` };
    // A withdrawal waiting for Vigie: no circuit on a document that may be withdrawn.
    const [withdrawal] = await tx.select().from(s.changeRequests).where(and(eq(s.changeRequests.docId, docId), eq(s.changeRequests.kind, 'obsolescence'), inArray(s.changeRequests.status, ['submitted', 'accepted'])));
    if (withdrawal) return { err: 'change_pending', extra: withdrawal.id };
    const rev = await workingRevision(tx, docId);
    if (!rev || rev.status !== 'draft') return { err: 'not_draft' };
    const behind = await uploadBehind(tx, ctx, docId, rev, seen, 'validate');
    if (behind) return { behind };
    const versions = await tx.select().from(s.workingVersions).where(eq(s.workingVersions.revisionId, rev.id)).orderBy(desc(s.workingVersions.n));
    if (!versions.length) return { err: 'need_file' };
    // Issue ≤ effect ≤ expiry: an effective date before the expiry; the first issue before the expiry and the review.
    const late = effectIssue(d, effective, todayIso());
    if (late) return { date: late };
    const type = ctx.typeByCode.get(d.typeCode);
    if (!type) return { err: 'error' };
    // A circuit without approval puts the revision in force at once: that is publishing.
    if (!type.circuit.length && !ctx.can('publish')) return { err: 'perm_publish' };

    // The author's step goes to the person who wrote the revision, whoever launches the circuit.
    const author = rev.modifierId ?? versions[0].authorId ?? d.ownerId;
    const excluded = await circuitExclusions(tx, d, rev, ctx.user.id);
    const mayApprove = await approverCheck(tx, ctx.users);
    const taken = new Set<string>();
    const steps: { functionKey: string | null; name: { fr: string; en: string }; assigneeId: string }[] = [
      { functionKey: null, name: { fr: 'Rédaction', en: 'Drafting' }, assigneeId: author },
    ];
    for (const key of type.circuit) {
      const fn = ctx.functions.find((x) => x.key === key);
      const who = await resolveFunction(tx, ctx, key, d, excluded, taken, mayApprove);
      if (!fn || !who) return { err: 'no_holder', extra: fn ? (ctx.lang === 'fr' ? fn.labelFr : fn.labelEn) : key };
      taken.add(who);
      steps.push({ functionKey: key, name: { fr: fn.labelFr, en: fn.labelEn }, assigneeId: who });
    }
    const id = await nextWorkflowId(tx);
    const today = todayIso();
    await tx.insert(s.workflows).values({ id, docId, revisionId: rev.id, requesterId: ctx.user.id, due: addDays(today, 7), step: 1, createdAt: today });
    await tx.insert(s.workflowSteps).values(steps.map((st, idx) => ({ workflowId: id, idx, ...st, sign: false, date: idx === 0 ? today : null })));
    await tx.update(s.revisions).set({ status: 'in_review', effectiveAt: effective }).where(eq(s.revisions.id, rev.id));
    await audit(tx, ctx.user.id, 'request', docId, `${id} · ${rev.letter}`, rev.id);
    if (steps.length === 1) {
      // Circuit without approval (correspondence, photos…): approved as soon as it is requested.
      await tx.update(s.workflows).set({ outcome: 'approved', closedBy: ctx.user.id, closedAt: today }).where(eq(s.workflows.id, id));
      await approveRevision(tx, rev.id);
    } else {
      await refreshHeadline(tx, docId);
    }
    return { id };
  });
  if ('href' in res) return { ok: true, href: res.href };
  if ('behind' in res) return res.behind;
  if ('date' in res) return dateFail(ctx, res.date);
  if ('err' in res) return res.err === 'perm_publish' ? denied(ctx, 'publish') : fail(ctx, res.err, res.extra);
  refresh();
  return { ok: true, href: `/validations?f=requested&r=${encodeURIComponent(res.id)}` };
}

async function loadWorkflow(tx: Tx, id: string) {
  const [w] = await tx.select().from(s.workflows).where(eq(s.workflows.id, id));
  if (!w) return null;
  const steps = await tx.select().from(s.workflowSteps).where(eq(s.workflowSteps.workflowId, id)).orderBy(asc(s.workflowSteps.idx));
  return { w, steps };
}

/** Longest reason for rejecting or recalling a circuit. */
const REASON_MAX = 2000;

/** A rejection's or a recall's reason, trimmed: an error key when it is missing (`required`) or too long. */
function closingReason(raw: string, required: boolean): { why: string } | { err: TKey } {
  const why = raw.trim();
  if (required && !why) return { err: 'reason_required' };
  return why.length > REASON_MAX ? { err: 'reason_too_long' } : { why };
}

/**
 * Approve or reject the current step. `expectedStep` is the step the user saw: a stale click never acts on a later step.
 * A rejection needs its `reason`, kept on the circuit, in its comments and in the journal.
 */
export async function decideStep(...args: Parameters<typeof decideStepNow>): Promise<ActionResult> {
  return traceAction('decideStep', () => decideStepNow(...args));
}
async function decideStepNow(workflowId: string, approve: boolean, expectedStep: number, reason = ''): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!ctx.screens.workflow) return fail(ctx, 'forbidden');
  const motive = closingReason(reason, !approve);
  if ('err' in motive) return fail(ctx, motive.err);
  const { why } = motive;
  const db = await getDb();
  const err = await db.transaction(async (tx): Promise<TKey | null> => {
    const wf = await loadWorkflow(tx, workflowId);
    if (!wf) return 'not_found';
    const { w, steps } = wf;
    if (w.outcome || w.step !== expectedStep) return 'wrong_step';
    const cur = steps[w.step];
    if (!cur || cur.assigneeId !== ctx.user.id) return 'not_allowed';
    if (!ctx.can('approve')) return 'perm_approve';
    const [doc] = await tx.select().from(s.documents).where(eq(s.documents.id, w.docId));
    if (!doc) return 'not_found';
    const lock = lockOf(doc);
    if (lock) return lock;
    const [rev] = await tx.select().from(s.revisions).where(eq(s.revisions.id, w.revisionId));
    const today = todayIso();
    if (!rev || rev.status !== 'in_review') {
      // Stale workflow (its revision moved on): it is closed and the revision is left as it is.
      await tx.update(s.workflows).set({ outcome: 'rejected', closedBy: ctx.user.id, closedAt: today }).where(eq(s.workflows.id, w.id));
      return 'wrong_step';
    }
    // Holders and delegations may have changed since the launch: the author or requester never decides on the revision.
    if ((await circuitExclusions(tx, doc, rev, w.requesterId)).has(ctx.user.id)) return 'no_self_approval';
    if (!approve) {
      await tx.update(s.workflows).set({ outcome: 'rejected', closedBy: ctx.user.id, closedAt: today, reason: why }).where(eq(s.workflows.id, w.id));
      await tx.update(s.revisions).set({ status: 'draft' }).where(and(eq(s.revisions.id, w.revisionId), eq(s.revisions.status, 'in_review')));
      await tx.insert(s.workflowComments).values({ workflowId: w.id, authorId: ctx.user.id, at: today, text: { fr: `Rejeté — révision renvoyée en rédaction. Motif : ${why}`, en: `Rejected — revision sent back to drafting. Reason: ${why}` } });
      // The entry follows the revision (D-14): outside the drafting circle, its reason shows once that revision is in force.
      await audit(tx, ctx.user.id, 'reject', w.docId, `${w.id} · ${why}`, w.revisionId);
      await refreshHeadline(tx, w.docId);
      return null;
    }
    const step = w.step + 1;
    const last = step >= steps.length;
    // The last approval puts the revision in force (or schedules it): the matrix's "publish" permission.
    if (last && !ctx.can('publish')) return 'perm_publish';
    await tx.update(s.workflowSteps).set({ date: today }).where(and(eq(s.workflowSteps.workflowId, w.id), eq(s.workflowSteps.idx, cur.idx)));
    await audit(tx, ctx.user.id, cur.sign ? 'sign' : 'approve', w.docId, w.id, w.revisionId);
    await tx.update(s.workflows).set(last ? { step, outcome: 'approved', closedBy: ctx.user.id, closedAt: today } : { step }).where(eq(s.workflows.id, w.id));
    if (last) await approveRevision(tx, w.revisionId);
    return null;
  });
  if (err) return err === 'perm_approve' ? denied(ctx, 'approve') : err === 'perm_publish' ? denied(ctx, 'publish') : fail(ctx, err);
  refresh();
  return { ok: true };
}

/**
 * Recalls a running circuit before its last approval (docs/modele-cible.md §6): its requester or a records manager
 * (access.ts, mayRecall), on a document not locked. The circuit ends « Rappelé » and the revision goes back to drafting;
 * its approvers leave the drafting circle (D-14). `expectedStep` is the step the user saw: a circuit that moved on, or
 * ended, since is left alone. `reason` is optional.
 */
export async function recallValidation(...args: Parameters<typeof recallValidationNow>): Promise<ActionResult> {
  return traceAction('recallValidation', () => recallValidationNow(...args));
}
async function recallValidationNow(workflowId: string, expectedStep: number, reason = ''): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const motive = closingReason(reason, false);
  if ('err' in motive) return fail(ctx, motive.err);
  const { why } = motive;
  if (!ctx.can('edit')) return denied(ctx, 'edit');
  const ix = await getAccessIndex();
  const db = await getDb();
  const err = await db.transaction(async (tx): Promise<TKey | null> => {
    const wf = await loadWorkflow(tx, workflowId);
    if (!wf) return 'not_found';
    const { w } = wf;
    const [[d], [rev]] = await Promise.all([
      tx.select().from(s.documents).where(eq(s.documents.id, w.docId)),
      tx.select().from(s.revisions).where(eq(s.revisions.id, w.revisionId)),
    ]);
    // Same rule as listWorkflows: a document the user cannot read, or a revision outside their view, gives nothing away.
    if (!d || !rev || !canRead(ctx, d, ix) || !readerMaySeeRevision(inDraftingCircle(ctx, d, ix), rev.status)) return 'not_found';
    if (w.outcome || w.step !== expectedStep) return 'wrong_step';
    if (!mayRecall(ctx, w, d, ix)) return 'not_allowed';
    const lock = lockOf(d);
    if (lock) return lock;
    const today = todayIso();
    await tx.update(s.workflows).set({ outcome: 'recalled', closedBy: ctx.user.id, closedAt: today, reason: why || null }).where(eq(s.workflows.id, w.id));
    await tx.update(s.revisions).set({ status: 'draft' }).where(and(eq(s.revisions.id, w.revisionId), eq(s.revisions.status, 'in_review')));
    const text = why
      ? { fr: `Demande rappelée — révision renvoyée en rédaction. Motif : ${why}`, en: `Request recalled — revision sent back to drafting. Reason: ${why}` }
      : { fr: 'Demande rappelée — révision renvoyée en rédaction.', en: 'Request recalled — revision sent back to drafting.' };
    await tx.insert(s.workflowComments).values({ workflowId: w.id, authorId: ctx.user.id, at: today, text });
    await audit(tx, ctx.user.id, 'recall', w.docId, why ? `${w.id} · ${why}` : w.id, w.revisionId);
    await refreshHeadline(tx, w.docId);
    return null;
  });
  if (err) return fail(ctx, err);
  refresh();
  return { ok: true };
}

/** Hands the current step to someone else. `expectedStep` is the step the user saw, as for decideStep. */
export async function delegateStep(...args: Parameters<typeof delegateStepNow>): Promise<ActionResult> {
  return traceAction('delegateStep', () => delegateStepNow(...args));
}
async function delegateStepNow(workflowId: string, toUserId: string, expectedStep: number): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!ctx.screens.workflow) return fail(ctx, 'forbidden');
  const db = await getDb();
  const err = await db.transaction(async (tx): Promise<TKey | null> => {
    const wf = await loadWorkflow(tx, workflowId);
    if (!wf) return 'not_found';
    if (wf.w.outcome || wf.w.step !== expectedStep) return 'wrong_step';
    const cur = wf.steps[wf.w.step];
    if (!cur || cur.assigneeId !== ctx.user.id) return 'not_allowed';
    const [doc] = await tx.select().from(s.documents).where(eq(s.documents.id, wf.w.docId));
    const [rev] = await tx.select().from(s.revisions).where(eq(s.revisions.id, wf.w.revisionId));
    if (!doc || !rev) return 'not_found';
    // A frozen document freezes its circuit too.
    const lock = lockOf(doc);
    if (lock) return lock;
    const to = ctx.users.get(toUserId);
    if (!to || to.isSystem || to.id === ctx.user.id) return 'error';
    if ((await circuitExclusions(tx, doc, rev, wf.w.requesterId)).has(to.id)) return 'no_self_approval';
    if (!(await approverCheck(tx, ctx.users))(to.id)) return 'delegate_no_approve';
    await tx.update(s.workflowSteps).set({ assigneeId: to.id }).where(and(eq(s.workflowSteps.workflowId, workflowId), eq(s.workflowSteps.idx, cur.idx)));
    await audit(tx, ctx.user.id, 'delegate', wf.w.docId, `${workflowId} · ${loc(cur.name, 'fr')} → ${to.name}`, rev.id);
    return null;
  });
  if (err) return fail(ctx, err);
  refresh();
  return { ok: true };
}

/**
 * Hands the current step of a running circuit to someone else, for a records manager who does not hold it (a step left
 * with an absent person, point 19 of docs/reste-a-faire.md): delegateStep's checks (not locked, a person who may approve
 * with their default role, never the requester, the author or the authors of the working versions), and someone else
 * than its holder. `expectedStep` is the step the manager saw: a circuit that moved on since is left alone. Journaled on
 * the revision ('reassign', D-14), as a delegation.
 */
export async function reassignStep(...args: Parameters<typeof reassignStepNow>): Promise<ActionResult> {
  return traceAction('reassignStep', () => reassignStepNow(...args));
}
async function reassignStepNow(workflowId: string, toUserId: string, expectedStep: number): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!mayReassignStep(ctx)) return fail(ctx, 'forbidden');
  if (typeof workflowId !== 'string' || typeof toUserId !== 'string') return fail(ctx);
  const db = await getDb();
  const err = await db.transaction(async (tx): Promise<TKey | null> => {
    const wf = await loadWorkflow(tx, workflowId);
    if (!wf) return 'not_found';
    if (wf.w.outcome || wf.w.step !== expectedStep) return 'wrong_step';
    const cur = wf.steps[wf.w.step];
    if (!cur) return 'wrong_step';
    const [doc] = await tx.select().from(s.documents).where(eq(s.documents.id, wf.w.docId));
    const [rev] = await tx.select().from(s.revisions).where(eq(s.revisions.id, wf.w.revisionId));
    if (!doc || !rev) return 'not_found';
    const lock = lockOf(doc);
    if (lock) return lock;
    const to = ctx.users.get(toUserId);
    if (!to || to.isSystem || to.id === cur.assigneeId) return 'error';
    if ((await circuitExclusions(tx, doc, rev, wf.w.requesterId)).has(to.id)) return 'no_self_approval';
    if (!(await approverCheck(tx, ctx.users))(to.id)) return 'delegate_no_approve';
    await tx.update(s.workflowSteps).set({ assigneeId: to.id }).where(and(eq(s.workflowSteps.workflowId, workflowId), eq(s.workflowSteps.idx, cur.idx)));
    await audit(tx, ctx.user.id, 'reassign', wf.w.docId, `${workflowId} · ${loc(cur.name, 'fr')} : ${ctx.userName(cur.assigneeId)} → ${to.name}`, rev.id);
    return null;
  });
  if (err) return fail(ctx, err);
  refresh();
  return { ok: true, message: ctx.t.reassign_done };
}

export async function addComment(...args: Parameters<typeof addCommentNow>): Promise<ActionResult> {
  return traceAction('addComment', () => addCommentNow(...args));
}
async function addCommentNow(workflowId: string, text: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const body = text.trim();
  if (!body) return fail(ctx);
  if (!ctx.screens.workflow) return fail(ctx, 'forbidden');
  const db = await getDb();
  const wf = await loadWorkflow(db, workflowId);
  if (!wf) return fail(ctx, 'not_found');
  // Same rule as listWorkflows: a document the user cannot read, or a revision outside their view (D-14), gives nothing away.
  const [[d], [rev], ix] = await Promise.all([
    db.select().from(s.documents).where(eq(s.documents.id, wf.w.docId)),
    db.select({ status: s.revisions.status }).from(s.revisions).where(eq(s.revisions.id, wf.w.revisionId)),
    getAccessIndex(),
  ]);
  if (!d || !canRead(ctx, d, ix) || !readerMaySeeRevision(inDraftingCircle(ctx, d, ix), rev?.status)) return fail(ctx, 'not_found');
  if (!followsCircuit(ctx, wf.w, wf.steps)) return fail(ctx, 'not_allowed');
  await db.transaction(async (tx) => {
    await tx.insert(s.workflowComments).values({ workflowId, authorId: ctx.user.id, at: todayIso(), text: body.slice(0, 2000) });
    // The entry names the circuit, not the text: the comment stays readable where it was written. The circuit's
    // revision decides who reads the entry (D-14).
    await audit(tx, ctx.user.id, 'comment', wf.w.docId, workflowId, wf.w.revisionId);
  });
  refresh();
  return { ok: true };
}

// ── Change requests (Vigie) ──────────────────────────────────────────────

/**
 * Asks Vigie for a change (ECR) or the withdrawal of a document in force. Needs the edit permission and a document the
 * user can see: a hidden document answers "not found" before anything about its state. A change may be asked while a
 * revision is open (D-26): once accepted, it waits for that revision or is grafted onto it. A withdrawal may propose
 * the document that replaces this one (`replacementId`, optional): an active document the requester may read, which
 * becomes « remplacé par » once the withdrawal applies (lib/lifecycle.ts implementChange); one they may not read is
 * answered as one that does not exist.
 */
export async function requestChange(...args: Parameters<typeof requestChangeNow>): Promise<ActionResult> {
  return traceAction('requestChange', () => requestChangeNow(...args));
}
async function requestChangeNow(docId: string, kind: 'modification' | 'obsolescence', reason: string, description: string, replacementId: string | null = null): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const why = reason.trim();
  const replacement = typeof replacementId === 'string' && replacementId.trim() ? replacementId.trim() : null;
  if (!why || (kind !== 'modification' && kind !== 'obsolescence') || (replacement && kind !== 'obsolescence')) return fail(ctx);
  if (!ctx.can('edit')) return denied(ctx, 'edit');
  const ix = await getAccessIndex();
  const db = await getDb();
  const res = await db.transaction(async (tx): Promise<{ err: TKey; extra?: string; field?: string } | { id: string }> => {
    const [d] = await tx.select().from(s.documents).where(eq(s.documents.id, docId));
    if (!d || !canRead(ctx, d, ix)) return { err: 'not_found' };
    const lock = lockOf(d);
    if (lock) return { err: lock };
    if (!d.revInForce) return { err: 'need_in_force' };
    const [pending] = await tx.select().from(s.changeRequests).where(and(eq(s.changeRequests.docId, docId), inArray(s.changeRequests.status, ['submitted', 'accepted'])));
    if (pending) return { err: 'change_pending', extra: pending.id };
    if (replacement) {
      const [r] = await tx.select().from(s.documents).where(eq(s.documents.id, replacement));
      const issue = replacementIssue(docId, r && canRead(ctx, r, ix) ? r : null);
      if (issue) return { err: issue, field: 'replacement' };
    }
    const id = await submitChange(tx, { kind, docId, requesterId: ctx.user.id, reason: why.slice(0, 300), description: description.trim().slice(0, 4000), replacementId: replacement });
    await audit(tx, ctx.user.id, kind === 'modification' ? 'ecr' : 'obsolete', docId, id);
    return { id };
  });
  if ('err' in res) return res.field ? { ok: false, error: ctx.t[res.err], field: res.field } : fail(ctx, res.err, res.extra);
  refresh();
  return { ok: true, message: `${ctx.t.ecr_sent} : ${res.id}` };
}

/**
 * Simulates Vigie's decision while no Vigie endpoint is configured (records managers only); same rules as the webhook:
 * an acceptance on a locked document, or of a change while a revision is open, is recorded and applies later, and the
 * designated author must be able to draft the document.
 */
export async function simulateVigieDecision(...args: Parameters<typeof simulateVigieDecisionNow>): Promise<ActionResult> {
  return traceAction('simulateVigieDecision', () => simulateVigieDecisionNow(...args));
}
async function simulateVigieDecisionNow(id: string, accepted: boolean, modifierId: string | null): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!vigieSimulated() || !ctx.seesAll) return fail(ctx, 'vigie_only');
  const modifier = modifierId ? ctx.users.get(modifierId) : null;
  if (modifierId && (!modifier || modifier.isSystem)) return fail(ctx);
  const db = await getDb();
  const res = await db.transaction((tx) => applyChangeDecision(tx, id, { accepted, ecoRef: accepted ? id.replace(/^ECR/, 'ECO') : null, modifierId }, 'vigie'));
  if ('error' in res) return fail(ctx, res.error, res.error === 'modifier_not_allowed' ? modifier?.name : undefined);
  refresh();
  // Records managers belong to every drafting circle: the open revision may be named (D-14).
  return res.status === 'accepted' ? { ok: true, message: `${ctx.t.ecr_accepted_waiting} : ${decisionWaitL(ctx.t, res)}.` } : { ok: true };
}

/**
 * Grafts a change Vigie accepted while a revision was open onto that revision (D-26), instead of waiting for it to enter
 * into force: the revision keeps its author and also carries the change order; the request becomes 'implemented',
 * linked to it. Only while that revision is drafted and the document is not locked (in review or approved, grafting
 * would mean running the circuit again: the change waits). For a records manager or the author of the open revision
 * (its designated modifier, else the owner), with the edit permission, on a document they can read.
 */
export async function graftChange(...args: Parameters<typeof graftChangeNow>): Promise<ActionResult> {
  return traceAction('graftChange', () => graftChangeNow(...args));
}
async function graftChangeNow(requestId: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!ctx.can('edit')) return denied(ctx, 'edit');
  const ix = await getAccessIndex();
  const db = await getDb();
  const res = await db.transaction(async (tx): Promise<{ err: TKey } | { ref: string; letter: string }> => {
    const [req] = await tx.select().from(s.changeRequests).where(eq(s.changeRequests.id, requestId));
    const [d] = req ? await tx.select().from(s.documents).where(eq(s.documents.id, req.docId)) : [];
    if (!req || !d || !canRead(ctx, d, ix)) return { err: 'not_found' };
    // Locked against a concurrent validation request: a revision is grafted onto while drafted, never once in review.
    const [rev] = await tx.select().from(s.revisions).where(and(eq(s.revisions.docId, d.id), inArray(s.revisions.status, ['draft', 'in_review', 'approved']))).for('update');
    const author = rev ? rev.modifierId ?? d.ownerId : null;
    // Outside the drafting circle nothing tells whether a revision is open (D-14): the same refusal either way.
    if (!(ctx.seesAll || (author && author === ctx.user.id))) return { err: 'not_allowed' };
    if (req.kind !== 'modification' || req.status !== 'accepted' || !rev) return { err: 'graft_not_pending' };
    const lock = lockOf(d);
    if (lock) return { err: lock };
    if (rev.status !== 'draft') return { err: 'graft_not_draft' };
    const ref = req.ecoRef ?? req.id;
    // The request shows who actually writes the change, as for one Vigie's author could no longer draft (lib/lifecycle.ts).
    const [done] = await tx.update(s.changeRequests).set({ status: 'implemented', revisionId: rev.id, modifierId: author }).where(and(eq(s.changeRequests.id, req.id), eq(s.changeRequests.status, 'accepted'))).returning();
    if (!done) return { err: 'graft_not_pending' };
    // Vigie's designated author, when someone else writes the revision, is named in the journal: never set aside silently.
    const named = req.modifierId && req.modifierId !== author ? ` · ${ctx.userName(req.modifierId)} → ${ctx.userName(author)}` : '';
    // Tied to the revision: outside the drafting circle, the entry shows once the revision is in force (D-14).
    await audit(tx, ctx.user.id, 'graft', d.id, `${ref} → ${rev.letter}${named}`, rev.id);
    return { ref, letter: rev.letter };
  });
  if ('err' in res) return fail(ctx, res.err);
  refresh();
  return { ok: true, message: `${ctx.t.graft_done} : ${res.ref} → ${res.letter}` };
}

// ── Links between documents ──────────────────────────────────────────────

/**
 * Links `docId` to `otherId` from its record (point 16 of docs/reste-a-faire.md): `rel` says what `docId` is to the
 * other, « remplace », « remplacé par » or « voir aussi ». A link shows on both records, and « remplacé par » in the band
 * of a withdrawn document: the user must have the rights on both ends (access.ts mayEditLinks: their owner, or a
 * records manager, with the edit permission), on two documents they may read (one they may not is answered as one that
 * does not exist). Only a document Vigie withdrew is replaced, by an active one (lib/links.ts linkIssue, D-17); a legal
 * hold on either freezes their links. One link per pair, journaled on both documents.
 */
export async function addDocLink(...args: Parameters<typeof addDocLinkNow>): Promise<ActionResult> {
  return traceAction('addDocLink', () => addDocLinkNow(...args));
}
async function addDocLinkNow(docId: string, rel: string, otherId: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!isLinkRel(rel)) return fail(ctx);
  if (!ctx.can('edit')) return denied(ctx, 'edit');
  const other = typeof otherId === 'string' ? otherId.trim() : '';
  const ix = await getAccessIndex();
  const db = await getDb();
  const res = await db.transaction(async (tx): Promise<{ err: TKey; field?: string } | { ok: true }> => {
    const [d] = await tx.select().from(s.documents).where(eq(s.documents.id, docId));
    if (!d || !canRead(ctx, d, ix)) return { err: 'not_found' };
    if (!mayEditLinks(ctx, d)) return { err: 'link_reserved' };
    const [o] = other ? await tx.select().from(s.documents).where(eq(s.documents.id, other)) : [];
    if (!o || !canRead(ctx, o, ix)) return { err: 'link_not_found', field: 'other' };
    if (!mayEditLinks(ctx, o)) return { err: 'link_reserved', field: 'other' };
    if (d.legalHold || o.legalHold) return { err: 'link_hold' };
    const issue = linkIssue(rel, d, o, !!(await linkBetween(tx, d.id, o.id)));
    // What the record's document is to the other is the kind chosen; the other end is the document chosen.
    const onRel = issue === 'link_not_withdrawn' || (issue === 'link_replacer_inactive' && rel === 'replaces');
    if (issue) return { err: issue, field: onRel ? 'rel' : 'other' };
    if (!(await addLink(tx, storedLink(d.id, rel, o.id), ctx.user.id))) return { err: 'link_exists', field: 'other' };
    return { ok: true };
  });
  if ('err' in res) return { ok: false, error: ctx.t[res.err], ...(res.field ? { field: res.field } : {}) };
  refresh();
  return { ok: true, message: ctx.t.link_added };
}

/**
 * Removes a link from the record of `docId`, one of its ends: same rights as addDocLink, on both documents (the owner
 * of a replacement does not take « remplacé par » off a document withdrawn by Vigie that is not theirs), and a legal
 * hold on either freezes it. A link to a document the user may not read is not shown to them, and is answered as one
 * that does not exist. Journaled on both.
 */
export async function removeDocLink(...args: Parameters<typeof removeDocLinkNow>): Promise<ActionResult> {
  return traceAction('removeDocLink', () => removeDocLinkNow(...args));
}
async function removeDocLinkNow(docId: string, linkId: number): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!ctx.can('edit')) return denied(ctx, 'edit');
  const ix = await getAccessIndex();
  const db = await getDb();
  const res = await db.transaction(async (tx): Promise<{ err: TKey } | { ok: true }> => {
    const [d] = await tx.select().from(s.documents).where(eq(s.documents.id, docId));
    if (!d || !canRead(ctx, d, ix)) return { err: 'not_found' };
    const [l] = Number.isInteger(linkId) ? await tx.select().from(s.documentLinks).where(eq(s.documentLinks.id, linkId)) : [];
    const [o] = l && (l.sourceId === d.id || l.targetId === d.id) ? await tx.select().from(s.documents).where(eq(s.documents.id, otherEnd(l, d.id))) : [];
    if (!l || !o || !canRead(ctx, o, ix)) return { err: 'link_not_found' };
    if (!mayEditLinks(ctx, d) || !mayEditLinks(ctx, o)) return { err: 'link_reserved' };
    if (d.legalHold || o.legalHold) return { err: 'link_hold' };
    const [gone] = await tx.delete(s.documentLinks).where(eq(s.documentLinks.id, l.id)).returning();
    if (!gone) return { err: 'link_not_found' };
    await journalLink(tx, 'unlink', gone, ctx.user.id);
    return { ok: true };
  });
  if ('err' in res) return fail(ctx, res.err);
  refresh();
  return { ok: true, message: ctx.t.link_removed };
}

// ── Retention ────────────────────────────────────────────────────────────

/** Documents among `ids` the user can see; the others are treated as if they did not exist. */
async function visibleDocs(tx: Tx, ctx: Ctx, ids: string[]) {
  const ix = await getAccessIndex();
  const docs = ids.length ? await tx.select().from(s.documents).where(inArray(s.documents.id, ids)) : [];
  return docs.filter((d) => canRead(ctx, d, ix));
}

export async function archiveDocuments(...args: Parameters<typeof archiveDocumentsNow>): Promise<ActionResult> {
  return traceAction('archiveDocuments', () => archiveDocumentsNow(...args));
}
async function archiveDocumentsNow(ids: string[]): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!ctx.can('archive') || !ctx.screens.retention) return denied(ctx, 'archive');
  const db = await getDb();
  const docs = await visibleDocs(db, ctx, ids);
  const skipped = await db.transaction(async (tx) => {
    const today = todayIso();
    let skipped = 0;
    for (const d of docs.filter((x) => x.state !== 'archived')) {
      const [cur] = await tx.select().from(s.documents).where(eq(s.documents.id, d.id));
      // Frozen documents, documents under approval and approved revisions waiting for their effective date stay where they are.
      if (!cur || cur.legalHold || (await activeWorkflow(tx, d.id)) || (await workingRevision(tx, d.id))?.status === 'approved') { skipped++; continue; }
      await tx.update(s.documents).set({ state: 'archived', archivedAt: today, modifiedAt: today }).where(eq(s.documents.id, d.id));
      await refreshHeadline(tx, d.id);
      await audit(tx, ctx.user.id, 'archive', d.id, d.revInForce ?? '');
    }
    return skipped;
  });
  refresh();
  return { ok: true, message: skipped ? `${skipped} ${ctx.t.archive_skipped}` : undefined };
}

export async function holdDocuments(...args: Parameters<typeof holdDocumentsNow>): Promise<ActionResult> {
  return traceAction('holdDocuments', () => holdDocumentsNow(...args));
}
async function holdDocumentsNow(ids: string[]): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!ctx.can('archive') || !ctx.screens.retention) return denied(ctx, 'archive');
  const db = await getDb();
  const docs = await visibleDocs(db, ctx, ids);
  await db.transaction(async (tx) => {
    const today = todayIso();
    for (const d of docs.filter((x) => !x.legalHold)) {
      await tx.update(s.documents).set({ legalHold: true, legalHoldAt: today }).where(eq(s.documents.id, d.id));
      await audit(tx, ctx.user.id, 'hold', d.id, d.typeCode);
    }
  });
  refresh();
  return { ok: true };
}

/**
 * Tells the person who lifted a lock that the author Vigie named could no longer draft and the default one took over,
 * and whether the latter can draft the document (applyPendingDecision). Designated authors stay within the drafting
 * circle (D-14): nobody outside it is told.
 */
async function pendingApplied(ctx: Ctx, d: DocRow, swap: ModifierSwap | null): Promise<ActionResult> {
  if (!swap || !inDraftingCircle(ctx, d, await buildAccessIndex(await getDb()))) return { ok: true };
  const who = swap.setAside === swap.modifierId ? ctx.userName(swap.modifierId) : `${ctx.userName(swap.setAside)} → ${ctx.userName(swap.modifierId)}`;
  return { ok: true, message: `${swap.mayDraft ? ctx.t.modifier_set_aside : ctx.t.modifier_none_allowed} : ${who}` };
}

/**
 * Lifts a legal hold: the document, its running circuit and an approved revision waiting for its date resume, and an
 * acceptance Vigie sent during the hold applies.
 */
export async function releaseHold(...args: Parameters<typeof releaseHoldNow>): Promise<ActionResult> {
  return traceAction('releaseHold', () => releaseHoldNow(...args));
}
async function releaseHoldNow(docId: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!ctx.can('archive') || !ctx.screens.retention) return denied(ctx, 'archive');
  const db = await getDb();
  const [d] = await visibleDocs(db, ctx, [docId]);
  if (!d) return fail(ctx, 'not_found');
  const swap = await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(s.documents).where(eq(s.documents.id, docId));
    if (!cur?.legalHold) return null;
    await tx.update(s.documents).set({ legalHold: false, legalHoldAt: null }).where(eq(s.documents.id, docId));
    // A revision approved during the hold enters into force today at the earliest, never on a date in the past.
    await catchUpEffectiveDates(tx, docId);
    await audit(tx, ctx.user.id, 'release', docId, cur.typeCode);
    return applyPendingDecision(tx, docId);
  });
  refresh();
  return pendingApplied(ctx, d, swap);
}

/**
 * Restores an archived document to the state it had before: obsolete if Vigie withdrew it, otherwise active. An
 * acceptance Vigie sent while it was archived then applies.
 */
export async function restoreArchived(...args: Parameters<typeof restoreArchivedNow>): Promise<ActionResult> {
  return traceAction('restoreArchived', () => restoreArchivedNow(...args));
}
async function restoreArchivedNow(docId: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!ctx.can('archive') || !ctx.screens.retention) return denied(ctx, 'archive');
  const db = await getDb();
  const [d] = await visibleDocs(db, ctx, [docId]);
  if (!d) return fail(ctx, 'not_found');
  const swap = await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(s.documents).where(eq(s.documents.id, docId));
    if (!cur || cur.state !== 'archived' || cur.legalHold) return null;
    // obsoleteAt is only written by an accepted withdrawal (lib/lifecycle.ts) and never cleared.
    const back = cur.obsoleteAt ? 'obsolete' : 'active';
    await tx.update(s.documents).set({ state: back, archivedAt: null, modifiedAt: todayIso() }).where(eq(s.documents.id, docId));
    await catchUpEffectiveDates(tx, docId);
    await refreshHeadline(tx, docId);
    await audit(tx, ctx.user.id, 'restore', docId, `${cur.revInForce ?? ''} → ${back}`.trim());
    return applyPendingDecision(tx, docId);
  });
  refresh();
  return pendingApplied(ctx, d, swap);
}

// ── Retention of a document (D-20) ───────────────────────────────────────

/** Journal data of a change to a document's retention: what decides who reads its values, as for a metadata edit (D-14). */
const retentionDoc = (d: DocRow) => ({ conf: d.conf, inForce: !!d.revInForce });

/**
 * Date of the event a document's retention counts from, for the triggers Codex cannot know (end of life of the asset,
 * departure of the employee: lib/retention.ts EVENT_TRIGGERS); null clears it. By the owner of an editable record or
 * whoever manages retention (access.ts maySetRetentionEvent), never on a frozen one. A real day, no later than today.
 * Nothing is archived or destroyed when it makes the retention end: the end only shows in Archivage (O-07). Journaled
 * (action 'retention_event'), before → after. `version`: of the record shown (lib/concurrency.ts).
 */
export async function setRetentionEvent(...args: Parameters<typeof setRetentionEventNow>): Promise<ActionResult> {
  return traceAction('setRetentionEvent', () => setRetentionEventNow(...args));
}
async function setRetentionEventNow(docId: string, date: string | null, version: number): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const seen = seenVersion(version);
  const db = await getDb();
  const ix = await getAccessIndex();
  const [d] = await db.select().from(s.documents).where(eq(s.documents.id, String(docId)));
  if (!d) return movedSince(db, ctx, String(docId), (x) => canRead(ctx, x, ix) && maySetRetentionEvent(ctx, x));
  if (!canRead(ctx, d, ix)) return fail(ctx, 'not_found');
  if (d.legalHold) return fail(ctx, 'locked_hold');
  if (!maySetRetentionEvent(ctx, d)) {
    const lock = d.ownerId === ctx.user.id ? lockOf(d) : null;
    return lock ? fail(ctx, lock) : ctx.can('edit') || ctx.can('archive') ? fail(ctx, 'not_allowed') : denied(ctx, 'edit');
  }
  if (d.version !== seen) return stale(ctx, seen === null ? null : await lastChangedBy(db, ctx, d.id));
  const parsed = parseEventDate(typeof date === 'string' ? date : null, todayIso());
  if (!parsed.ok) return { ok: false, error: ctx.t[parsed.key], field: 'eventAt' };
  const res = await db.transaction(async (tx): Promise<{ stale: string | null } | { err: TKey } | null> => {
    const [cur] = await tx.select().from(s.documents).where(eq(s.documents.id, d.id)).for('update');
    if (cur?.version !== seen) return { stale: cur ? await lastChangedBy(tx, ctx, d.id) : null };
    // A date only means something for a trigger that waits for one; one left from another trigger may still be cleared.
    if (parsed.value && !isEventTrigger(cur.retentionTrigger)) return { err: 'retention_event_not_needed' };
    const changed = changes([['retentionEventAt', cur.retentionEventAt, parsed.value]]);
    if (!changed.length) return null;
    await tx.update(s.documents).set({ retentionEventAt: parsed.value, modifiedAt: todayIso() }).where(eq(s.documents.id, d.id));
    await audit(tx, ctx.user.id, 'retention_event', d.id, cur.revInForce ?? cur.revWorking ?? '', null, { changes: changed, doc: retentionDoc(cur) });
    return null;
  });
  if (res && 'stale' in res) return stale(ctx, res.stale);
  if (res) return fail(ctx, res.err);
  refresh();
  return { ok: true, message: ctx.t.saved_ok };
}

/**
 * Retention class of one document (D-20, docs/modele-cible.md §8), by whoever manages retention (access.ts
 * mayManageRetention), on any document they read but a frozen one. `mode` 'type' puts back its type's rule; otherwise
 * the duration, trigger and final disposition sent (lib/registry-rules.ts parseRetentionRule) become a derogation, which
 * a later change of the type's rule leaves as it is (updateType), unless they are the type's rule itself. Journaled
 * (action 'retention'): the class and the derogation, before → after, with the type's rule as detail. Counted per
 * document: its revisions follow it (O-09). Nothing is archived or destroyed here. `version`: of the record shown.
 */
export async function setRetentionClass(...args: Parameters<typeof setRetentionClassNow>): Promise<ActionResult> {
  return traceAction('setRetentionClass', () => setRetentionClassNow(...args));
}
async function setRetentionClassNow(fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!mayManageRetention(ctx)) return denied(ctx, 'archive');
  const docId = str(fd, 'docId');
  const seen = seenVersion(fd.get('version'));
  const db = await getDb();
  const ix = await getAccessIndex();
  const [d] = await db.select().from(s.documents).where(eq(s.documents.id, docId));
  if (!d) return movedSince(db, ctx, docId, (x) => canRead(ctx, x, ix));
  if (!canRead(ctx, d, ix)) return fail(ctx, 'not_found');
  if (d.legalHold) return fail(ctx, 'locked_hold');
  if (d.version !== seen) return stale(ctx, seen === null ? null : await lastChangedBy(db, ctx, d.id));
  const toType = str(fd, 'mode') === 'type';
  let rule: Pick<DocRow, 'retentionYears' | 'retentionTrigger' | 'retentionDisposition'> | null = null;
  if (!toType) {
    const p = parseRetentionRule(fd);
    if (!p.ok) return formIssue(ctx, p);
    rule = p.value;
  }
  const res = await db.transaction(async (tx): Promise<{ stale: string | null } | { err: TKey } | null> => {
    const [cur] = await tx.select().from(s.documents).where(eq(s.documents.id, d.id)).for('update');
    if (cur?.version !== seen) return { stale: cur ? await lastChangedBy(tx, ctx, d.id) : null };
    const [type] = await tx.select().from(s.docTypes).where(eq(s.docTypes.code, cur.typeCode));
    if (!type) return { err: 'reg_not_found' };
    const next = rule ?? { retentionYears: type.retentionYears, retentionTrigger: type.retentionTrigger, retentionDisposition: type.retentionDisposition };
    // The type's own rule is no derogation.
    const override = !sameRule(next, type);
    const changed = changes([['retention', retentionValue(cur), retentionValue(next)], ['retentionOverride', cur.retentionOverride, override]]);
    if (!changed.length) return null;
    await tx.update(s.documents).set({ ...next, retentionOverride: override, modifiedAt: todayIso() }).where(eq(s.documents.id, d.id));
    await audit(tx, ctx.user.id, 'retention', d.id, cur.typeCode, null, { changes: [...changed, { field: 'typeRetention', after: retentionValue(type) }], doc: retentionDoc(cur) });
    return null;
  });
  if (res && 'stale' in res) return stale(ctx, res.stale);
  if (res) return fail(ctx, res.err);
  refresh();
  return { ok: true, message: ctx.t.saved_ok };
}

// ── Consultations ────────────────────────────────────────────────────────

/**
 * Journals that the user opened a document's record (action 'consult'), called by the record once shown in the browser,
 * never while it is prefetched. Tied to the revision the record shows (the one in force, else the latest), which decides
 * who reads the entry (lib/access.ts readerMaySeeEntry, D-14), and written once per user and document every
 * CONSULT_WINDOW_MINUTES (lib/lifecycle.ts journalConsultation). A document the user may not read writes nothing.
 * Refreshes nothing: the record stays as shown.
 */
export async function recordConsultation(...args: Parameters<typeof recordConsultationNow>): Promise<ActionResult> {
  return traceAction('recordConsultation', () => recordConsultationNow(...args));
}
async function recordConsultationNow(docId: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (typeof docId !== 'string' || !docId) return fail(ctx, 'not_found');
  const db = await getDb();
  const [[d], ix] = await Promise.all([db.select().from(s.documents).where(eq(s.documents.id, docId)), getAccessIndex()]);
  if (!d || !canRead(ctx, d, ix)) return fail(ctx, 'not_found');
  const revs = await db.select({ id: s.revisions.id, letter: s.revisions.letter, status: s.revisions.status }).from(s.revisions).where(eq(s.revisions.docId, docId)).orderBy(asc(s.revisions.id));
  const rev = revs.findLast((r) => r.status === 'in_force') ?? revs.findLast((r) => r.status === 'superseded') ?? revs.at(-1);
  await journalConsultation(db, ctx.user.id, 'consult', docId, rev?.letter ?? '', rev?.id ?? null);
  return { ok: true };
}

// ── Saved searches ───────────────────────────────────────────────────────

const LABEL_MAX = 80;

/**
 * Saves the criteria of /recherche (query, facets, period) and the order of its results under a label: a personal
 * search for whoever may read, a search shared with a department (its members) or the whole group for records managers
 * and administrators (lib/access.ts maySaveSearch). Only criteria are kept: each person who opens it sees the documents
 * they may read.
 */
export async function saveSearch(...args: Parameters<typeof saveSearchNow>): Promise<ActionResult> {
  return traceAction('saveSearch', () => saveSearchNow(...args));
}
async function saveSearchNow(label: string, search: SearchInput, scope: string, department: string | null): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!(SEARCH_SCOPES as readonly string[]).includes(scope)) return fail(ctx);
  if (!maySaveSearch(ctx, scope)) return ctx.can('read') ? fail(ctx, 'not_allowed') : denied(ctx, 'read');
  const name = typeof label === 'string' ? label.trim() : '';
  if (!name || name.length > LABEL_MAX) return fail(ctx, 'search_label_invalid');
  // Refused rather than cut down: the search saved is the one shown, or none.
  if (beyondBounds(search)) return fail(ctx, 'search_too_long');
  const criteria = cleanCriteria(search);
  if (!hasCriteria(criteria)) return fail(ctx, 'search_no_criteria');
  const dept = scope === 'department' ? department ?? '' : null;
  // Shared with an existing department, still active: an inactive one takes no new search (lib/org-rules.ts).
  const shared = dept === null ? null : ctx.departments.find((d) => d.code === dept);
  if (shared === undefined) return fail(ctx);
  if (shared && !shared.active) return fail(ctx, 'department_inactive');
  const db = await getDb();
  const [{ last }] = await db.select({ last: sql<number>`coalesce(max(${s.savedSearches.sort}), -1)` }).from(s.savedSearches);
  await db.insert(s.savedSearches).values({
    label: name, q: criteria.q, facets: criteria.facets, period: criteria.period, orderBy: criteria.sort,
    ownerId: ctx.user.id, scope: scope as SearchScope, department: dept, sort: Number(last) + 1,
  });
  refresh();
  return { ok: true, message: ctx.t.search_saved_ok };
}

/** Deletes a saved search: its owner for a personal one, records managers and administrators for a shared one. */
export async function deleteSavedSearch(...args: Parameters<typeof deleteSavedSearchNow>): Promise<ActionResult> {
  return traceAction('deleteSavedSearch', () => deleteSavedSearchNow(...args));
}
async function deleteSavedSearchNow(id: number): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!Number.isInteger(id)) return fail(ctx, 'search_not_found');
  const db = await getDb();
  const [row] = await db.select().from(s.savedSearches).where(eq(s.savedSearches.id, id));
  // Someone else's personal search does not exist for the user.
  if (!row || !seesSavedSearch(ctx, row)) return fail(ctx, 'search_not_found');
  if (!mayDeleteSearch(ctx, row)) return fail(ctx, 'not_allowed');
  await db.delete(s.savedSearches).where(eq(s.savedSearches.id, id));
  refresh();
  return { ok: true, message: ctx.t.search_deleted_ok };
}

// ── Administration ───────────────────────────────────────────────────────

function adminOnly(ctx: Ctx): ActionResult | null {
  return ctx.screens.admin ? null : fail(ctx, 'forbidden');
}

/**
 * Removes the orphan files of the local store that Administration listed (lib/orphans.ts): `keys`, those the dry run
 * showed, of which only the files still orphans go: named by no working version, older than the grace period, each
 * checked again just before; journaled in one entry. A records manager with access to Administration only
 * (lib/access.ts mayCleanStorage). SharePoint files are never removed (O-01).
 */
export async function purgeOrphanFiles(...args: Parameters<typeof purgeOrphanFilesNow>): Promise<ActionResult> {
  return traceAction('purgeOrphanFiles', () => purgeOrphanFilesNow(...args));
}
async function purgeOrphanFilesNow(keys: string[]): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!mayCleanStorage(ctx)) return fail(ctx, 'forbidden');
  // Sent back by the page: a list of names, no longer than the one shown.
  if (!Array.isArray(keys) || !keys.length || keys.length > MAX_PER_RUN || !keys.every((k) => typeof k === 'string' && k.length > 0 && k.length <= 512)) return fail(ctx);
  const res = await purgeOrphans(ctx.user.id, { keys });
  if (res === 'busy') return fail(ctx, 'orphans_busy');
  const { t, lang } = ctx;
  refresh();
  return {
    ok: true,
    message: [
      t.orphans_removed.replace('{n}', String(res.removed.length)).replace('{size}', fmtSize(res.bytes, lang)),
      res.kept ? t.orphans_kept.replace('{n}', String(res.kept)) : '',
      res.failed ? t.orphans_failures.replace('{n}', String(res.failed)) : '',
      res.left - res.failed > 0 ? t.orphans_left.replace('{n}', String(res.left)) : '',
    ].filter(Boolean).join(' '),
  };
}

/**
 * Backs up the database and the files it points to now (lib/backup.ts): an archive in the backup directory, checked once
 * written, journaled, the oldest beyond the rotation removed; refused within 15 minutes of the latest archive
 * (lib/backup.ts ONLINE_MIN_INTERVAL_MS). A records manager with access to Administration only (lib/access.ts
 * mayBackUp). Restoring is not an action: it needs the server stopped (npm run restore).
 */
export async function backUpData(...args: Parameters<typeof backUpDataNow>): Promise<ActionResult> {
  return traceAction('backUpData', () => backUpDataNow(...args));
}
async function backUpDataNow(): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!mayBackUp(ctx)) return fail(ctx, 'forbidden');
  let res: Awaited<ReturnType<typeof backUpNow>>;
  try {
    res = await backUpNow(ctx.user.id);
  } catch (err) {
    log.error('backup failed', { err });
    return fail(ctx, 'backup_failed');
  }
  if (res === 'busy') return fail(ctx, 'backup_busy');
  if (res === 'server') return fail(ctx, 'backup_server');
  const { t, lang } = ctx;
  if ('recent' in res) {
    const at = (iso: string) => fmtDateTime(parisStamp(iso), lang);
    return { ok: false, error: t.backup_recent.replace('{date}', at(res.recent)).replace('{next}', at(res.next)) };
  }
  const f = res.manifest.files;
  refresh();
  return {
    ok: true,
    message: [
      t.backup_done.replace('{name}', res.name).replace('{size}', fmtSize(res.size, lang)),
      f.missing.length ? t.backup_missing.replace('{n}', String(f.missing.length)) : '',
      f.sharepoint ? t.backup_sharepoint.replace('{n}', String(f.sharepoint)) : '',
      res.removed.length ? t.backup_rotated.replace('{n}', String(res.removed.length)) : '',
    ].filter(Boolean).join(' '),
  };
}

/**
 * Reads every stored file again and compares it with the SHA-256 recorded when it entered Codex (lib/integrity.ts):
 * altered and missing files are reported and journaled ('integrity_checked'), fingerprints of files stored before they
 * were computed are recorded. Nothing is repaired. A records manager with access to Administration only
 * (lib/access.ts mayCheckIntegrity). Server stopped: npm run integrity.
 */
export async function checkFileIntegrity(...args: Parameters<typeof checkFileIntegrityNow>): Promise<ActionResult> {
  return traceAction('checkFileIntegrity', () => checkFileIntegrityNow(...args));
}
async function checkFileIntegrityNow(): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!mayCheckIntegrity(ctx)) return fail(ctx, 'forbidden');
  let res: Awaited<ReturnType<typeof checkFilesNow>>;
  try {
    res = await checkFilesNow(ctx.user.id);
  } catch (err) {
    log.error('integrity check failed', { err });
    refresh();
    return fail(ctx, 'integrity_failed');
  }
  if (res === 'busy') return fail(ctx, 'integrity_busy');
  const { t, lang } = ctx;
  refresh();
  const parts = [
    t.integrity_done.replace('{n}', String(res.checked)).replace('{size}', fmtSize(res.bytes, lang)),
    res.alteredCount ? t.integrity_altered_n.replace('{n}', String(res.alteredCount)) : '',
    res.missingCount ? t.integrity_missing_n.replace('{n}', String(res.missingCount)) : '',
    res.filled ? t.integrity_filled_n.replace('{n}', String(res.filled)) : '',
    res.skipped ? t.integrity_skipped_n.replace('{n}', String(res.skipped)) : '',
  ].filter(Boolean).join(' · ');
  // A discrepancy is a warning, shown longer than a message; the list is on the page and in the journal.
  return res.alteredCount || res.missingCount ? { ok: true, warning: `${parts}. ${t.integrity_see_list}` } : { ok: true, message: `${parts}. ${t.integrity_ok}` };
}

export async function togglePermission(...args: Parameters<typeof togglePermissionNow>): Promise<ActionResult> {
  return traceAction('togglePermission', () => togglePermissionNow(...args));
}
async function togglePermissionNow(role: string, perm: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const no = adminOnly(ctx);
  if (no) return no;
  if (!(MATRIX_ROLES as readonly string[]).includes(role) || !(PERMS as readonly string[]).includes(perm)) return fail(ctx);
  // Only cells that change something can be toggled: a row read by a simulated role, a permission Codex checks.
  if (!SIMULATED_MATRIX_ROLES.includes(role) || !ENFORCED_PERMS.includes(perm as Perm)) return fail(ctx, 'not_enforced');
  // Administration follows the matrix: the row of one's own role keeps its way back in.
  if (perm === 'admin' && role === MATRIX_ROLE[ctx.role]) return fail(ctx, 'admin_lockout');
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(s.rolePermissions).where(and(eq(s.rolePermissions.role, role), eq(s.rolePermissions.perm, perm)));
    const before = row?.granted ?? false;
    if (row) await tx.update(s.rolePermissions).set({ granted: !before }).where(and(eq(s.rolePermissions.role, role), eq(s.rolePermissions.perm, perm)));
    else await tx.insert(s.rolePermissions).values({ role, perm, granted: true });
    await audit(tx, ctx.user.id, 'perm', { kind: 'permission', id: `${role}:${perm}` }, '', null, { changes: [{ field: 'granted', before, after: !before }] });
  });
  refresh();
  return { ok: true };
}

// ── Organisation: departments and sites (provisional until the organisation chart, D-19, O-04) ──────────

type OrgRow = { labelFr: string; labelEn: string; active: boolean };

/** A department or a site as the journal stores it: its code or key, labels and state. */
const orgJournal = (kind: OrgKind, id: string, x: OrgRow): [string, AuditValue][] =>
  [[kind === 'department' ? 'code' : 'key', id], ['labelFr', x.labelFr], ['labelEn', x.labelEn], ['active', x.active]];

async function orgRow(tx: Tx, kind: OrgKind, id: string): Promise<OrgRow | undefined> {
  const [row] = kind === 'department'
    ? await tx.select().from(s.departments).where(eq(s.departments.code, id)).for('update')
    : await tx.select().from(s.sites).where(eq(s.sites.key, id)).for('update');
  return row;
}

/** Why this department may not become inactive or be deleted (`next`: its state after, null when deleted), or null. */
async function departmentsIssue(tx: Tx, code: string, next: boolean | null): Promise<TKey | null> {
  return lastActiveIssue(await tx.select({ code: s.departments.code, active: s.departments.active }).from(s.departments), code, next);
}

/** Department (3-letter code used in IDs) or site. Provisional values until the org chart is provided. */
export async function addOrgValue(...args: Parameters<typeof addOrgValueNow>): Promise<ActionResult> {
  return traceAction('addOrgValue', () => addOrgValueNow(...args));
}
async function addOrgValueNow(kind: 'department' | 'site', code: string, labelFr: string, labelEn: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const no = adminOnly(ctx);
  if (no) return no;
  if (!isOrgKind(kind)) return fail(ctx);
  const names = orgLabels(labelFr, labelEn);
  if (!names.ok) return formIssue(ctx, names);
  const { labelFr: fr, labelEn: en } = names.value;
  const db = await getDb();
  if (kind === 'department') {
    const key = String(code ?? '').trim().toUpperCase();
    // The context of IDs without attachment: no other code of an ID may read the same (lib/registry-rules.ts).
    const bad = departmentCodeIssue(key, codeSpace(ctx));
    if (bad) return { ok: false, error: ctx.t[bad], field: 'code' };
    await db.transaction(async (tx) => {
      await tx.insert(s.departments).values({ code: key, labelFr: fr, labelEn: en, sort: await nextSort(tx, s.departments.sort) });
      await audit(tx, ctx.user.id, 'org_add', { kind: 'department', id: key }, '', null, { changes: entryChanges(null, orgJournal(kind, key, { labelFr: fr, labelEn: en, active: true })) });
    });
  } else {
    const key = fr.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32) || 'site';
    if (ctx.sites.some((x) => x.key === key)) return fail(ctx, 'error', key);
    await db.transaction(async (tx) => {
      await tx.insert(s.sites).values({ key, labelFr: fr, labelEn: en, sort: await nextSort(tx, s.sites.sort) });
      await audit(tx, ctx.user.id, 'org_add', { kind: 'site', id: key }, '', null, { changes: entryChanges(null, orgJournal(kind, key, { labelFr: fr, labelEn: en, active: true })) });
    });
  }
  refresh();
  return { ok: true };
}

/**
 * Renames a department or a site (French and English labels), makes it inactive or active again. A department's code
 * never changes: it stands in the IDs of documents without attachment (D-10). An inactive value is no longer offered
 * to a new document or a shared search, and stays wherever it is set (validateFields); an inactive department still
 * takes function holders, for the circuits of its documents (scopeValueOk). One department at least stays active.
 * Journaled before → after.
 */
export async function updateOrgValue(...args: Parameters<typeof updateOrgValueNow>): Promise<ActionResult> {
  return traceAction('updateOrgValue', () => updateOrgValueNow(...args));
}
async function updateOrgValueNow(kind: OrgKind, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const no = adminOnly(ctx);
  if (no) return no;
  if (!isOrgKind(kind) || !(fd instanceof FormData)) return fail(ctx);
  const id = str(fd, 'original');
  const p = parseOrgForm(fd);
  if (!p.ok) return formIssue(ctx, p);
  const next = p.value;
  const db = await getDb();
  const res = await db.transaction(async (tx): Promise<ActionResult> => {
    const cur = await orgRow(tx, kind, id);
    if (!cur) return fail(ctx, 'org_not_found');
    const last = kind === 'department' && cur.active && !next.active ? await departmentsIssue(tx, id, false) : null;
    if (last) return fail(ctx, last);
    if (kind === 'department') await tx.update(s.departments).set(next).where(eq(s.departments.code, id));
    else await tx.update(s.sites).set(next).where(eq(s.sites.key, id));
    const changed = entryChanges(orgJournal(kind, id, cur), orgJournal(kind, id, next));
    // Saving without a change leaves no entry.
    if (changed.length) await audit(tx, ctx.user.id, 'org_edit', { kind, id }, '', null, { changes: changed });
    return { ok: true, message: ctx.t.saved_ok };
  });
  if (res.ok) refresh();
  return res;
}

/**
 * Deletes a department or a site nothing refers to (lib/queries.ts orgUsage), created by mistake for instance; one in
 * use is made inactive instead. Journaled with the values it had.
 */
export async function deleteOrgValue(...args: Parameters<typeof deleteOrgValueNow>): Promise<ActionResult> {
  return traceAction('deleteOrgValue', () => deleteOrgValueNow(...args));
}
async function deleteOrgValueNow(kind: OrgKind, id: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const no = adminOnly(ctx);
  if (no) return no;
  if (!isOrgKind(kind) || typeof id !== 'string') return fail(ctx);
  const db = await getDb();
  const res = await db.transaction(async (tx): Promise<ActionResult> => {
    const cur = await orgRow(tx, kind, id);
    if (!cur) return fail(ctx, 'org_not_found');
    const usage = await orgUsage(tx);
    if (inUse((kind === 'department' ? usage.departments : usage.sites).get(id))) return fail(ctx, kind === 'department' ? 'org_department_in_use' : 'org_site_in_use');
    const last = kind === 'department' ? await departmentsIssue(tx, id, null) : null;
    if (last) return fail(ctx, last);
    if (kind === 'department') await tx.delete(s.departments).where(eq(s.departments.code, id));
    else await tx.delete(s.sites).where(eq(s.sites.key, id));
    await audit(tx, ctx.user.id, 'org_remove', { kind, id }, '', null, { changes: entryChanges(orgJournal(kind, id, cur), null) });
    return { ok: true, message: ctx.t.reg_deleted };
  });
  if (res.ok) refresh();
  return res;
}

/**
 * Facets a department's page puts forward (/departements/[code]), in order: a list of facets of /recherche (at most
 * MAX_FEATURED, none to put none forward), or null to follow the default ones again (lib/departments.ts). Which facets
 * suit each department awaits the survey of their needs: the default stands until then.
 */
export async function setDepartmentFeatured(...args: Parameters<typeof setDepartmentFeaturedNow>): Promise<ActionResult> {
  return traceAction('setDepartmentFeatured', () => setDepartmentFeaturedNow(...args));
}
async function setDepartmentFeaturedNow(code: string, featured: string[] | null): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const no = adminOnly(ctx);
  if (no) return no;
  if (!ctx.departments.some((d) => d.code === code)) return fail(ctx);
  const next = cleanFeatured(featured);
  if (next === undefined) return fail(ctx, 'featured_invalid');
  // Journal values: the facets, or 'default' for the default ones (an empty list is stored as none, lib/queries.ts).
  const journal = (v: string[] | null): AuditValue => v ?? 'default';
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(s.departments).where(eq(s.departments.code, code));
    if (!cur) return;
    await tx.update(s.departments).set({ featured: next }).where(eq(s.departments.code, code));
    const changed = changes([['featured', journal(cur.featured), journal(next)]]);
    // Saving without a change leaves no entry.
    if (changed.length) await audit(tx, ctx.user.id, 'dept_featured', { kind: 'department', id: code }, '', null, { changes: changed });
  });
  refresh();
  return { ok: true, message: ctx.t.saved_ok };
}

/**
 * Whether a holder may be named for this value of a function's scope: a known project; a known department, even
 * inactive (its documents still go through circuits, resolveFunction looks up their department's holders); a programme
 * known and still active (a closed one keeps its holders but takes no new one; its manager answers for it).
 */
async function scopeValueOk(tx: Tx, scope: string, value: string): Promise<boolean> {
  const rows = scope === 'department' ? await tx.select({ code: s.departments.code }).from(s.departments).where(eq(s.departments.code, value))
    : scope === 'project' ? await tx.select({ code: s.projects.code }).from(s.projects).where(eq(s.projects.code, value))
    : scope === 'research' ? await tx.select({ code: s.researchPrograms.code }).from(s.researchPrograms).where(and(eq(s.researchPrograms.code, value), eq(s.researchPrograms.active, true)))
    : [];
  return rows.length > 0;
}

/** Names a holder of a function, for a value of its scope or, with none, for the whole group. */
export async function addFunctionHolder(...args: Parameters<typeof addFunctionHolderNow>): Promise<ActionResult> {
  return traceAction('addFunctionHolder', () => addFunctionHolderNow(...args));
}
async function addFunctionHolderNow(functionKey: string, scopeValue: string | null, userId: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const no = adminOnly(ctx);
  if (no) return no;
  const fn = ctx.functions.find((f) => f.key === functionKey);
  const u = ctx.users.get(userId);
  if (!fn || !u || u.isSystem) return fail(ctx);
  if (scopeValue != null && typeof scopeValue !== 'string') return fail(ctx);
  const scope = fn.scope === 'global' ? null : scopeValue || null;
  const db = await getDb();
  // A holder decides approval steps: their default role must be able to approve.
  if (!(await approverCheck(db, ctx.users))(u.id)) return fail(ctx, 'delegate_no_approve');
  const res = await db.transaction(async (tx): Promise<ActionResult> => {
    if (scope !== null && !(await scopeValueOk(tx, fn.scope, scope))) return fail(ctx, 'holder_scope_invalid');
    await tx.insert(s.functionHolders).values({ functionKey, scopeValue: scope, userId });
    await audit(tx, ctx.user.id, 'holder_add', { kind: 'function', id: functionKey }, '', null, { changes: [{ field: 'holder', scope, before: null, after: u.id }] });
    return { ok: true };
  });
  if (res.ok) refresh();
  return res;
}

export async function removeFunctionHolder(...args: Parameters<typeof removeFunctionHolderNow>): Promise<ActionResult> {
  return traceAction('removeFunctionHolder', () => removeFunctionHolderNow(...args));
}
async function removeFunctionHolderNow(id: number): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const no = adminOnly(ctx);
  if (no) return no;
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [h] = await tx.delete(s.functionHolders).where(eq(s.functionHolders.id, id)).returning();
    if (h) await audit(tx, ctx.user.id, 'holder_remove', { kind: 'function', id: h.functionKey }, '', null, { changes: [{ field: 'holder', scope: h.scopeValue, before: h.userId, after: null }] });
  });
  refresh();
  return { ok: true };
}

// ── Holdings of a person who leaves (point 19 of docs/reste-a-faire.md) ─────────

/**
 * Hands every holding of `from` to the replacement `to` in one operation (lib/transfer.ts): documents and processes
 * owned, open revisions to write, pending approval steps, function holderships, named readers. For a records manager
 * with access to Administration (access.ts mayTransferHoldings). `digest`: that of the simulation the manager confirmed
 * (Administration › Reprise): when the plan reads otherwise now, nothing is written and the page shows it again. The
 * replacement is chosen, never proposed (A15); no account is disabled (O-02).
 */
export async function transferHoldings(...args: Parameters<typeof transferHoldingsNow>): Promise<ActionResult> {
  return traceAction('transferHoldings', () => transferHoldingsNow(...args));
}
async function transferHoldingsNow(fromId: string, toId: string, digest: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!mayTransferHoldings(ctx)) return fail(ctx, 'forbidden');
  if (typeof fromId !== 'string' || typeof toId !== 'string' || typeof digest !== 'string') return fail(ctx);
  const from = ctx.users.get(fromId), to = ctx.users.get(toId);
  if (!from || from.isSystem) return fail(ctx, 'transfer_from_unknown');
  if (!to || to.isSystem || to.id === from.id) return fail(ctx, 'transfer_to_invalid');
  const res = await confirmTransfer(await getDb(), ctx.users, ctx.user.id, from.id, to.id, digest);
  if ('changed' in res) return { ok: false, error: ctx.t.transfer_changed, stale: true };
  if ('empty' in res) return fail(ctx, 'transfer_nothing');
  const done = res.done.items.filter((i) => i.ok).length;
  const skipped = res.done.items.filter((i) => i.ok === false).length;
  refresh();
  return {
    ok: true,
    message: [ctx.t.transfer_done.replace('{n}', String(done)).replace('{to}', to.name), skipped ? ctx.t.transfer_skipped_n.replace('{n}', String(skipped)) : ''].filter(Boolean).join(' · '),
  };
}

// ── Controlled vocabularies (point 59 of docs/reste-a-faire.md) ─────────────

/** A term of a vocabulary as the journal stores it: its name and the spellings it also stands for. */
const termJournal = (x: { name: string; aliases: string[] }): [string, AuditValue][] => [['term', x.name], ['aliases', [...x.aliases].sort()]];

/**
 * Gives the documents carrying one of `keys` the value `name` (a term renamed, or merged into another), each journaled
 * as a metadata change ('vocab_apply', before → after, its values as for a metadata edit, D-14). Documents under legal
 * hold keep theirs: the former spelling stays an alias of the term, which still resolves it. Their modification date is
 * left as it is: the document was not edited, the journal says what changed. Returns the documents changed and kept.
 */
async function applyTerm(tx: Tx, ctx: Ctx, kind: VocabKind, keys: ReadonlySet<string>, name: string): Promise<{ changed: number; held: number }> {
  let changed = 0, held = 0;
  for (const d of await documentsWith(tx, kind, keys)) {
    const field = kind === 'source_org' ? 'sourceOrg' : 'keywords';
    const before: string | string[] | null = kind === 'source_org' ? d.sourceOrg : d.keywords;
    const after = kind === 'source_org' ? name : dedupe(d.keywords.map((k) => (keys.has(vocabKey(k)) ? name : k)));
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    if (d.legalHold) { held++; continue; }
    await tx.update(s.documents).set(kind === 'source_org' ? { sourceOrg: name } : { keywords: after as string[] }).where(eq(s.documents.id, d.id));
    await audit(tx, ctx.user.id, 'vocab_apply', d.id, '', null, { changes: changes([[field, before, after]]), doc: { conf: d.conf, inForce: !!d.revInForce } });
    changed++;
  }
  return { changed, held };
}

function appliedText(ctx: Ctx, x: { changed: number; held: number }): string {
  return [ctx.t.vocab_docs_changed.replace('{n}', String(x.changed)), x.held ? ctx.t.retention_held_kept.replace('{n}', String(x.held)) : ''].filter(Boolean).join(' · ');
}

/**
 * Adds a term to a vocabulary from Administration › Vocabulaires: a name no term already stands for (lib/vocab-rules.ts
 * termNameIssue). Who may govern the terms (A05) is not decided: the « Administrer » permission, as for the register.
 */
export async function addVocabTerm(...args: Parameters<typeof addVocabTermNow>): Promise<ActionResult> {
  return traceAction('addVocabTerm', () => addVocabTermNow(...args));
}
async function addVocabTermNow(kind: string, name: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const no = adminOnly(ctx);
  if (no) return no;
  if (!isVocabKind(kind) || typeof name !== 'string') return fail(ctx);
  const db = await getDb();
  const res = await db.transaction(async (tx): Promise<ActionResult> => {
    // Locked, so that two additions of one spelling cannot both find it free.
    await tx.execute(sql`lock table ${VOCAB_TABLE[kind]} in share row exclusive mode`);
    const issue = termNameIssue(kind, await loadTerms(tx, kind), name);
    if (issue) return { ok: false, error: ctx.t[issue], field: 'name' };
    await addTerms(tx, kind, [cleanTerm(name)], ctx.user.id);
    return { ok: true, message: ctx.t.vocab_added };
  });
  if (res.ok) refresh();
  return res;
}

/**
 * Renames a term: its documents take the new name (applyTerm), and the former one stays an alias of the term (an
 * import, a document under legal hold still resolve it). The new name must not be another term's.
 */
export async function renameVocabTerm(...args: Parameters<typeof renameVocabTermNow>): Promise<ActionResult> {
  return traceAction('renameVocabTerm', () => renameVocabTermNow(...args));
}
async function renameVocabTermNow(kind: string, id: number, name: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const no = adminOnly(ctx);
  if (no) return no;
  if (!isVocabKind(kind) || !Number.isInteger(id) || typeof name !== 'string') return fail(ctx);
  const db = await getDb();
  const res = await db.transaction(async (tx): Promise<ActionResult> => {
    await tx.execute(sql`lock table ${VOCAB_TABLE[kind]} in share row exclusive mode`);
    const cur = await termById(tx, kind, id);
    if (!cur) return fail(ctx, 'vocab_not_found');
    const issue = termNameIssue(kind, await loadTerms(tx, kind), name, id);
    if (issue) return { ok: false, error: ctx.t[issue], field: 'name' };
    const next = cleanTerm(name);
    if (next === cur.name) return { ok: true, message: ctx.t.saved_ok };
    const nextKey = vocabKey(next);
    const aliases = dedupe([...cur.aliases, cur.name]).filter((x) => vocabKey(x) !== nextKey);
    const t = VOCAB_TABLE[kind];
    await tx.update(t).set({ name: next, key: nextKey, aliases }).where(eq(t.id, id));
    await audit(tx, ctx.user.id, 'vocab_rename', { kind, id: next }, '', null, { changes: entryChanges(termJournal(cur), termJournal({ name: next, aliases })) });
    const applied = await applyTerm(tx, ctx, kind, new Set(termKeys(cur)), next);
    return { ok: true, message: `${ctx.t.saved_ok} · ${appliedText(ctx, applied)}` };
  });
  if (res.ok) refresh();
  return res;
}

/**
 * Merges a duplicate into the term it duplicates (« SIEMENS SAS » into « Siemens »): the documents of the duplicate
 * take the term's name (applyTerm), the duplicate's spellings become aliases of the term, and the duplicate is removed.
 * Journaled on the term kept, with the spellings it gained.
 */
export async function mergeVocabTerms(...args: Parameters<typeof mergeVocabTermsNow>): Promise<ActionResult> {
  return traceAction('mergeVocabTerms', () => mergeVocabTermsNow(...args));
}
async function mergeVocabTermsNow(kind: string, fromId: number, intoId: number): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const no = adminOnly(ctx);
  if (no) return no;
  if (!isVocabKind(kind) || !Number.isInteger(fromId) || !Number.isInteger(intoId)) return fail(ctx);
  if (fromId === intoId) return fail(ctx, 'vocab_merge_self');
  const db = await getDb();
  const res = await db.transaction(async (tx): Promise<ActionResult> => {
    const dup = await termById(tx, kind, fromId);
    const into = await termById(tx, kind, intoId);
    if (!dup || !into) return fail(ctx, 'vocab_not_found');
    const t = VOCAB_TABLE[kind];
    const aliases = dedupe([...into.aliases, dup.name, ...dup.aliases]).filter((x) => vocabKey(x) !== into.key);
    await tx.delete(t).where(eq(t.id, dup.id));
    await tx.update(t).set({ aliases }).where(eq(t.id, into.id));
    await audit(tx, ctx.user.id, 'vocab_merge', { kind, id: into.name }, dup.name, null, { changes: entryChanges(termJournal(into), termJournal({ name: into.name, aliases })) });
    const applied = await applyTerm(tx, ctx, kind, new Set(termKeys(dup)), into.name);
    return { ok: true, message: `${ctx.t.vocab_merged.replace('{from}', dup.name).replace('{into}', into.name)} · ${appliedText(ctx, applied)}` };
  });
  if (res.ok) refresh();
  return res;
}

/**
 * Adds to a type's sub-types a value its documents carry outside the list (Administration › Vocabulaires): the list of a
 * type stays open (MET-17, O-05 point 9), and a value entered on a document joins it only when an administrator of the
 * register adopts it. Same label in French and English until the type dialog gives it another; journaled as a change
 * of the type.
 */
export async function adoptSubtype(...args: Parameters<typeof adoptSubtypeNow>): Promise<ActionResult> {
  return traceAction('adoptSubtype', () => adoptSubtypeNow(...args));
}
async function adoptSubtypeNow(typeCode: string, value: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const no = adminOnly(ctx);
  if (no) return no;
  if (typeof typeCode !== 'string' || typeof value !== 'string') return fail(ctx);
  const label = cleanTerm(value);
  if (!label || label.length > DOC_SUBTYPE_MAX) return fail(ctx);
  // The register's own bounds (lib/registry-rules.ts), so that the type dialog still reads the list.
  if (label.length > SUBTYPE_MAX) return fail(ctx, 'subtype_adopt_long', String(SUBTYPE_MAX));
  const db = await getDb();
  const res = await db.transaction(async (tx): Promise<ActionResult> => {
    const [cur] = await tx.select().from(s.docTypes).where(eq(s.docTypes.code, typeCode)).for('update');
    if (!cur) return fail(ctx, 'reg_not_found');
    if (canonicalSubtype(cur.subtypes, label).listed) return fail(ctx, 'subtype_listed');
    if (cur.subtypes.length >= SUBTYPES_MAX) return fail(ctx, 'subtype_adopt_full', String(SUBTYPES_MAX));
    const next = { ...cur, subtypes: [...cur.subtypes, { fr: label, en: label }] };
    await tx.update(s.docTypes).set({ subtypes: next.subtypes }).where(eq(s.docTypes.code, typeCode));
    await audit(tx, ctx.user.id, 'type', { kind: 'type', id: typeCode }, '', null, { changes: entryChanges(typeJournal(cur), typeJournal(next)) });
    return { ok: true, message: ctx.t.subtype_adopted.replace('{value}', label).replace('{type}', typeCode) };
  });
  if (res.ok) refresh();
  return res;
}

// ── Register of types, families, functions; research programmes ──────────

/**
 * Codes an ID may carry (TYPE-CONTEXTE-SEQ), for the collision checks of lib/registry-rules.ts: types, and the
 * departments, projects and programmes that stand as its context.
 */
function codeSpace(ctx: Ctx): CodeSpace {
  return { types: ctx.types.map((x) => x.code), departments: ctx.departments.map((d) => d.code), projects: ctx.projects.map((p) => p.code), programs: ctx.programs.map((p) => p.code) };
}

function formIssue(ctx: Ctx, p: FormIssue): ActionResult {
  return { ok: false, error: ctx.t[p.key], ...(p.field ? { field: p.field } : {}) };
}

const typeRefs = (ctx: Ctx) => ({ families: ctx.families.map((f) => f.key), functions: ctx.functions.map((f) => f.key) });

/**
 * Next display order of a register or organisation table: after the last one, so never one a value already holds, even
 * after a deletion (the count of values would be).
 */
async function nextSort(tx: Tx, column: typeof s.docTypes.sort | typeof s.families.sort | typeof s.functions.sort | typeof s.departments.sort | typeof s.sites.sort) {
  const [{ last }] = await tx.select({ last: sql<number>`coalesce(max(${column}), -1)::int` }).from(column.table);
  return Number(last) + 1;
}

/**
 * The refusal of a type setting that its documents would no longer meet (origin, attachment or confidentiality left
 * out): how many, and which ones to records managers only, since the list names drafts (D-14).
 */
function outsideTypeText(ctx: Ctx, ids: string[]): string {
  const shown = ctx.seesAll ? ` ${ids.slice(0, 10).join(', ')}${ids.length > 10 ? ` (+${ids.length - 10})` : ''}` : '';
  return `${ctx.t.reg_out_of_type.replace('{n}', String(ids.length))}${shown}`;
}

/** Key of the tokens below, drawn at start: a token tells nothing of the documents it stands for (D-14). */
const OUTSIDE_KEY = randomBytes(32);

/**
 * What confirms leaving documents out of their type: the type, the setting asked about and the documents it left out,
 * sealed. Any other setting, or another document left out since, makes another token, and the question is asked again.
 */
function outsideToken(code: string, next: Pick<TypeValues, 'origins' | 'attachments' | 'confAllowed'>, ids: string[]): string {
  return createHmac('sha256', OUTSIDE_KEY).update(JSON.stringify([code, next.origins, next.attachments, next.confAllowed, [...ids].sort()])).digest('base64url');
}

/**
 * Adds a type to the register (Administration › Registre des types): every setting of lib/registry-rules.ts
 * parseTypeForm, a code no other type, department, project, programme or QMS has. Journaled with its values.
 */
export async function createType(...args: Parameters<typeof createTypeNow>): Promise<ActionResult> {
  return traceAction('createType', () => createTypeNow(...args));
}
async function createTypeNow(fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const no = adminOnly(ctx);
  if (no) return no;
  const p = parseTypeForm(fd, typeRefs(ctx));
  if (!p.ok) return formIssue(ctx, p);
  const next = p.value;
  const bad = typeCodeIssue(next.code, codeSpace(ctx));
  if (bad) return { ok: false, error: ctx.t[bad], field: 'code' };
  const fixed = builtInTypeIssue(next.code, next);
  if (fixed) return fail(ctx, fixed);
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.insert(s.docTypes).values({ ...next, source: 'codex', sort: await nextSort(tx, s.docTypes.sort) });
    await audit(tx, ctx.user.id, 'type_add', { kind: 'type', id: next.code }, '', null, { changes: entryChanges(null, typeJournal(next)) });
  });
  refresh();
  return { ok: true, message: ctx.t.reg_created };
}

/**
 * Every setting of a type. A type in use (documents, pieces a project expects: lib/queries.ts registryUsage) keeps its
 * code; its documents follow a change of family. A setting that leaves out an origin, attachment or confidentiality some
 * of its documents have is refused with their number until confirmed: `confirmOut` must carry the token of that refusal
 * (outsideToken), so a confirmation covers the documents it was shown and no other. They keep their values, and their
 * next metadata edit asks to reclassify them (validateFields).
 */
export async function updateType(...args: Parameters<typeof updateTypeNow>): Promise<ActionResult> {
  return traceAction('updateType', () => updateTypeNow(...args));
}
async function updateTypeNow(fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const no = adminOnly(ctx);
  if (no) return no;
  const original = str(fd, 'original');
  if (!ctx.typeByCode.has(original)) return fail(ctx, 'reg_not_found');
  const p = parseTypeForm(fd, typeRefs(ctx));
  if (!p.ok) return formIssue(ctx, p);
  const next = p.value;
  const bad = typeCodeIssue(next.code, codeSpace(ctx), original);
  if (bad) return { ok: false, error: ctx.t[bad], field: 'code' };
  // The type of templates stays without attachment, under its code as under the one it would take.
  const fixed = builtInTypeIssue(original, next) ?? builtInTypeIssue(next.code, next);
  if (fixed) return fail(ctx, fixed);
  const db = await getDb();
  const res = await db.transaction(async (tx): Promise<ActionResult> => {
    const [cur] = await tx.select().from(s.docTypes).where(eq(s.docTypes.code, original));
    if (!cur) return fail(ctx, 'reg_not_found');
    if (next.code !== original && (await registryUsage(tx)).types.has(original)) return { ok: false, error: ctx.t.reg_type_in_use, field: 'code' };
    const narrower = cur.origins.some((o) => !next.origins.includes(o)) || cur.attachments.some((a) => !next.attachments.includes(a)) || cur.confAllowed.some((c) => !next.confAllowed.includes(c));
    if (narrower) {
      const docs = await tx.select({ id: s.documents.id, origin: s.documents.origin, attachment: s.documents.attachment, conf: s.documents.conf })
        .from(s.documents).where(eq(s.documents.typeCode, original)).orderBy(asc(s.documents.id));
      const out = docs.filter((d) => outsideType(d, next) && !outsideType(d, cur)).map((d) => d.id);
      const token = out.length ? outsideToken(original, next, out) : null;
      if (token && fd.get('confirmOut') !== token) return { ok: false, error: outsideTypeText(ctx, out), field: 'confirmOut', confirm: token };
    }
    await tx.update(s.docTypes).set(next).where(eq(s.docTypes.code, original));
    // A document's family is its type's (lists, facets, classification plan).
    if (next.family !== cur.family) await tx.update(s.documents).set({ family: next.family }).where(eq(s.documents.typeCode, next.code));
    const changed = entryChanges(typeJournal(cur), typeJournal(next));
    // Saving without a change leaves no entry.
    if (changed.length) await audit(tx, ctx.user.id, 'type', { kind: 'type', id: next.code }, '', null, { changes: changed });
    if (fd.get('applyRetention') !== 'on') return { ok: true, message: ctx.t.saved_ok };
    const applied = await applyTypeRetention(tx, ctx, next);
    return { ok: true, message: `${ctx.t.saved_ok} · ${retentionAppliedText(ctx, applied)}` };
  });
  if (res.ok) refresh();
  return res;
}

/**
 * Applies the retention rule of a type to its documents that follow it (retention_override false) and differ from it,
 * each journaled (action 'retention_type', before → after, as a metadata edit, D-14), then the whole in one entry on the
 * type. Derogations are left as they are, and so are frozen documents (they keep their class until a records manager
 * puts the type's rule back on them, setRetentionClass). Nothing is archived or destroyed (O-07).
 */
async function applyTypeRetention(tx: Tx, ctx: Ctx, type: Pick<TypeValues, 'code' | 'retentionYears' | 'retentionTrigger' | 'retentionDisposition'>) {
  const docs = await tx.select().from(s.documents).where(eq(s.documents.typeCode, type.code)).orderBy(asc(s.documents.id));
  const rule = { retentionYears: type.retentionYears, retentionTrigger: type.retentionTrigger, retentionDisposition: type.retentionDisposition };
  const following = docs.filter((d) => !d.retentionOverride && !sameRule(d, rule));
  const held = following.filter((d) => d.legalHold).length;
  const today = todayIso();
  let applied = 0;
  for (const d of following.filter((x) => !x.legalHold)) {
    await tx.update(s.documents).set({ ...rule, modifiedAt: today }).where(eq(s.documents.id, d.id));
    await audit(tx, ctx.user.id, 'retention_type', d.id, type.code, null, { changes: changes([['retention', retentionValue(d), retentionValue(rule)]]), doc: retentionDoc(d) });
    applied++;
  }
  const overrides = docs.filter((d) => d.retentionOverride).length;
  if (applied) await audit(tx, ctx.user.id, 'retention_applied', { kind: 'type', id: type.code }, '', null, { changes: [{ field: 'retention', after: retentionValue(rule) }, { field: 'retentionDocs', after: String(applied) }] });
  return { applied, overrides, held };
}

function retentionAppliedText(ctx: Ctx, x: { applied: number; overrides: number; held: number }): string {
  return [
    ctx.t.retention_applied.replace('{n}', String(x.applied)),
    x.overrides ? ctx.t.retention_overrides_kept.replace('{n}', String(x.overrides)) : '',
    x.held ? ctx.t.retention_held_kept.replace('{n}', String(x.held)) : '',
  ].filter(Boolean).join(' · ');
}

/** Deletes a type nothing uses (lib/queries.ts registryUsage); one in use can only be made inactive. Journaled with its values. */
export async function deleteType(...args: Parameters<typeof deleteTypeNow>): Promise<ActionResult> {
  return traceAction('deleteType', () => deleteTypeNow(...args));
}
async function deleteTypeNow(code: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const no = adminOnly(ctx);
  if (no) return no;
  const db = await getDb();
  const res = await db.transaction(async (tx): Promise<ActionResult> => {
    const [cur] = await tx.select().from(s.docTypes).where(eq(s.docTypes.code, String(code)));
    if (!cur) return fail(ctx, 'reg_not_found');
    if ((await registryUsage(tx)).types.has(cur.code)) return fail(ctx, 'reg_type_in_use');
    await tx.delete(s.docTypes).where(eq(s.docTypes.code, cur.code));
    await audit(tx, ctx.user.id, 'type_remove', { kind: 'type', id: cur.code }, '', null, { changes: entryChanges(typeJournal(cur), null) });
    return { ok: true, message: ctx.t.reg_deleted };
  });
  if (res.ok) refresh();
  return res;
}

/** Adds a family of types: key, labels, deck group (D-08). */
export async function createFamily(...args: Parameters<typeof createFamilyNow>): Promise<ActionResult> {
  return traceAction('createFamily', () => createFamilyNow(...args));
}
async function createFamilyNow(fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const no = adminOnly(ctx);
  if (no) return no;
  const p = parseFamilyForm(fd);
  if (!p.ok) return formIssue(ctx, p);
  const bad = keyIssue(p.value.key, ctx.families.map((f) => f.key));
  if (bad) return { ok: false, error: ctx.t[bad], field: 'key' };
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.insert(s.families).values({ ...p.value, sort: await nextSort(tx, s.families.sort) });
    await audit(tx, ctx.user.id, 'family_add', { kind: 'family', id: p.value.key }, '', null, { changes: entryChanges(null, familyJournal(p.value)) });
  });
  refresh();
  return { ok: true, message: ctx.t.reg_created };
}

/** Labels and deck group of a family; its key only while no type or document has it. */
export async function updateFamily(...args: Parameters<typeof updateFamilyNow>): Promise<ActionResult> {
  return traceAction('updateFamily', () => updateFamilyNow(...args));
}
async function updateFamilyNow(fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const no = adminOnly(ctx);
  if (no) return no;
  const original = str(fd, 'original');
  const p = parseFamilyForm(fd);
  if (!p.ok) return formIssue(ctx, p);
  const next = p.value;
  const bad = keyIssue(next.key, ctx.families.map((f) => f.key), original);
  if (bad) return { ok: false, error: ctx.t[bad], field: 'key' };
  const db = await getDb();
  const res = await db.transaction(async (tx): Promise<ActionResult> => {
    const [cur] = await tx.select().from(s.families).where(eq(s.families.key, original));
    if (!cur) return fail(ctx, 'reg_not_found');
    if (next.key !== original && (await registryUsage(tx)).families.has(original)) return { ok: false, error: ctx.t.reg_family_in_use, field: 'key' };
    await tx.update(s.families).set(next).where(eq(s.families.key, original));
    const changed = entryChanges(familyJournal(cur), familyJournal(next));
    if (changed.length) await audit(tx, ctx.user.id, 'family', { kind: 'family', id: next.key }, '', null, { changes: changed });
    return { ok: true, message: ctx.t.saved_ok };
  });
  if (res.ok) refresh();
  return res;
}

/** Deletes a family without types or documents. */
export async function deleteFamily(...args: Parameters<typeof deleteFamilyNow>): Promise<ActionResult> {
  return traceAction('deleteFamily', () => deleteFamilyNow(...args));
}
async function deleteFamilyNow(key: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const no = adminOnly(ctx);
  if (no) return no;
  const db = await getDb();
  const res = await db.transaction(async (tx): Promise<ActionResult> => {
    const [cur] = await tx.select().from(s.families).where(eq(s.families.key, String(key)));
    if (!cur) return fail(ctx, 'reg_not_found');
    if ((await registryUsage(tx)).families.has(cur.key)) return fail(ctx, 'reg_family_in_use');
    await tx.delete(s.families).where(eq(s.families.key, cur.key));
    await audit(tx, ctx.user.id, 'family_remove', { kind: 'family', id: cur.key }, '', null, { changes: entryChanges(familyJournal(cur), null) });
    return { ok: true, message: ctx.t.reg_deleted };
  });
  if (res.ok) refresh();
  return res;
}

/** Adds a function that circuits may be made of: key, labels, scope its holders are looked up in. */
export async function createFunction(...args: Parameters<typeof createFunctionNow>): Promise<ActionResult> {
  return traceAction('createFunction', () => createFunctionNow(...args));
}
async function createFunctionNow(fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const no = adminOnly(ctx);
  if (no) return no;
  const p = parseFunctionForm(fd);
  if (!p.ok) return formIssue(ctx, p);
  const bad = keyIssue(p.value.key, ctx.functions.map((f) => f.key));
  if (bad) return { ok: false, error: ctx.t[bad], field: 'key' };
  const fixed = builtInScopeIssue(p.value.key, p.value.scope);
  if (fixed) return { ok: false, error: ctx.t[fixed], field: 'scope' };
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.insert(s.functions).values({ ...p.value, sort: await nextSort(tx, s.functions.sort) });
    await audit(tx, ctx.user.id, 'function_add', { kind: 'function', id: p.value.key }, '', null, { changes: entryChanges(null, functionJournal(p.value)) });
  });
  refresh();
  return { ok: true, message: ctx.t.reg_created };
}

/**
 * Labels of a function; its key only while no circuit, holder or started circuit refers to it; its scope only while it
 * has no holder (each is named for a value of the scope), and never for a function the rules of Codex name
 * (lib/registry-rules.ts BUILT_IN_SCOPES). Circuits already started keep the labels they were started with.
 */
export async function updateFunction(...args: Parameters<typeof updateFunctionNow>): Promise<ActionResult> {
  return traceAction('updateFunction', () => updateFunctionNow(...args));
}
async function updateFunctionNow(fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const no = adminOnly(ctx);
  if (no) return no;
  const original = str(fd, 'original');
  const p = parseFunctionForm(fd);
  if (!p.ok) return formIssue(ctx, p);
  const next = p.value;
  const bad = keyIssue(next.key, ctx.functions.map((f) => f.key), original);
  if (bad) return { ok: false, error: ctx.t[bad], field: 'key' };
  // A function the rules of Codex name keeps its scope, under its key as under the one it would take.
  const fixed = builtInScopeIssue(original, next.scope) ?? builtInScopeIssue(next.key, next.scope);
  if (fixed) return { ok: false, error: ctx.t[fixed], field: 'scope' };
  const db = await getDb();
  const res = await db.transaction(async (tx): Promise<ActionResult> => {
    const [cur] = await tx.select().from(s.functions).where(eq(s.functions.key, original));
    if (!cur) return fail(ctx, 'reg_not_found');
    if (next.key !== original && (await registryUsage(tx)).functions.has(original)) return { ok: false, error: ctx.t.reg_function_in_use, field: 'key' };
    if (next.scope !== cur.scope) {
      const [held] = await tx.select({ id: s.functionHolders.id }).from(s.functionHolders).where(eq(s.functionHolders.functionKey, original)).limit(1);
      if (held) return { ok: false, error: ctx.t.reg_function_scope_locked, field: 'scope' };
    }
    await tx.update(s.functions).set(next).where(eq(s.functions.key, original));
    const changed = entryChanges(functionJournal(cur), functionJournal(next));
    if (changed.length) await audit(tx, ctx.user.id, 'function', { kind: 'function', id: next.key }, '', null, { changes: changed });
    return { ok: true, message: ctx.t.saved_ok };
  });
  if (res.ok) refresh();
  return res;
}

/** Deletes a function no circuit, holder or started circuit refers to. */
export async function deleteFunction(...args: Parameters<typeof deleteFunctionNow>): Promise<ActionResult> {
  return traceAction('deleteFunction', () => deleteFunctionNow(...args));
}
async function deleteFunctionNow(key: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const no = adminOnly(ctx);
  if (no) return no;
  const db = await getDb();
  const res = await db.transaction(async (tx): Promise<ActionResult> => {
    const [cur] = await tx.select().from(s.functions).where(eq(s.functions.key, String(key)));
    if (!cur) return fail(ctx, 'reg_not_found');
    if ((await registryUsage(tx)).functions.has(cur.key)) return fail(ctx, 'reg_function_in_use');
    await tx.delete(s.functions).where(eq(s.functions.key, cur.key));
    await audit(tx, ctx.user.id, 'function_remove', { kind: 'function', id: cur.key }, '', null, { changes: entryChanges(functionJournal(cur), null) });
    return { ok: true, message: ctx.t.reg_deleted };
  });
  if (res.ok) refresh();
  return res;
}

const programJournal = (x: ProgramValues | typeof s.researchPrograms.$inferSelect): [string, AuditValue][] => [['code', x.code], ['name', x.name], ['managerId', x.managerId], ['active', x.active]];

/** The manager of a programme: a person of the group, never a system actor. */
const programManagerOk = (ctx: Ctx, id: string) => !!ctx.users.get(id) && !ctx.users.get(id)!.isSystem;

/**
 * Adds a research programme (D-08, D-10): its code is the context of its documents' IDs, so no type, department,
 * project, other programme or QMS may have it.
 */
export async function createProgram(...args: Parameters<typeof createProgramNow>): Promise<ActionResult> {
  return traceAction('createProgram', () => createProgramNow(...args));
}
async function createProgramNow(fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const no = adminOnly(ctx);
  if (no) return no;
  const p = parseProgramForm(fd);
  if (!p.ok) return formIssue(ctx, p);
  const next = p.value;
  const bad = programCodeIssue(next.code, codeSpace(ctx));
  if (bad) return { ok: false, error: ctx.t[bad], field: 'code' };
  if (!programManagerOk(ctx, next.managerId)) return { ok: false, error: ctx.t.reg_manager_invalid, field: 'managerId' };
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.insert(s.researchPrograms).values(next);
    await audit(tx, ctx.user.id, 'program_add', { kind: 'program', id: next.code }, '', null, { changes: entryChanges(null, programJournal(next)) });
  });
  refresh();
  return { ok: true, message: ctx.t.reg_created };
}

/**
 * Name, manager and state of a programme; its code only while no document or holder has it. An inactive programme is no
 * longer offered to a new document; those that have it keep it.
 */
export async function updateProgram(...args: Parameters<typeof updateProgramNow>): Promise<ActionResult> {
  return traceAction('updateProgram', () => updateProgramNow(...args));
}
async function updateProgramNow(fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const no = adminOnly(ctx);
  if (no) return no;
  const original = str(fd, 'original');
  const p = parseProgramForm(fd);
  if (!p.ok) return formIssue(ctx, p);
  const next = p.value;
  const bad = programCodeIssue(next.code, codeSpace(ctx), original);
  if (bad) return { ok: false, error: ctx.t[bad], field: 'code' };
  if (!programManagerOk(ctx, next.managerId)) return { ok: false, error: ctx.t.reg_manager_invalid, field: 'managerId' };
  const db = await getDb();
  const res = await db.transaction(async (tx): Promise<ActionResult> => {
    const [cur] = await tx.select().from(s.researchPrograms).where(eq(s.researchPrograms.code, original));
    if (!cur) return fail(ctx, 'reg_not_found');
    if (next.code !== original && (await registryUsage(tx)).programs.has(original)) return { ok: false, error: ctx.t.reg_program_in_use, field: 'code' };
    await tx.update(s.researchPrograms).set(next).where(eq(s.researchPrograms.code, original));
    const changed = entryChanges(programJournal(cur), programJournal(next));
    if (changed.length) await audit(tx, ctx.user.id, 'program', { kind: 'program', id: next.code }, '', null, { changes: changed });
    return { ok: true, message: ctx.t.saved_ok };
  });
  if (res.ok) refresh();
  return res;
}

/** Deletes a programme no document or holder has; a closed one in use is made inactive instead. */
export async function deleteProgram(...args: Parameters<typeof deleteProgramNow>): Promise<ActionResult> {
  return traceAction('deleteProgram', () => deleteProgramNow(...args));
}
async function deleteProgramNow(code: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const no = adminOnly(ctx);
  if (no) return no;
  const db = await getDb();
  const res = await db.transaction(async (tx): Promise<ActionResult> => {
    const [cur] = await tx.select().from(s.researchPrograms).where(eq(s.researchPrograms.code, String(code)));
    if (!cur) return fail(ctx, 'reg_not_found');
    if ((await registryUsage(tx)).programs.has(cur.code)) return fail(ctx, 'reg_program_in_use');
    await tx.delete(s.researchPrograms).where(eq(s.researchPrograms.code, cur.code));
    await audit(tx, ctx.user.id, 'program_remove', { kind: 'program', id: cur.code }, '', null, { changes: entryChanges(programJournal(cur), null) });
    return { ok: true, message: ctx.t.reg_deleted };
  });
  if (res.ok) refresh();
  return res;
}
