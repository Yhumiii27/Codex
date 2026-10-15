'use server';

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { refresh } from 'next/cache';
import { getDb, schema as s } from '@/db';
import type { Attachment, AuditChange, AuditValue, Conf, Disposition, Origin, RetentionTrigger, SearchScope } from '@/db/schema';
import { buildAccessIndex, canRead, followsCircuit, getAccessIndex, inDraftingCircle, isUsableTemplate, mayBackUp, mayCleanStorage, mayDeleteSearch, mayEditLinks, mayRecall, mayRecordReview, maySaveSearch, mayWorkOnDraft, readerMaySeeRevision, readersApply, seesSavedSearch } from './access';
import { idMatches, nextDocId, nextWorkflowId } from './codification';
import { changeAuthor, seenVersion, seenWorkingBase, staleText, workingIssue, workingStaleText, type WorkingBase } from './concurrency';
import { backUpNow } from './backup';
import { COOKIE_LANG, COOKIE_ROLE, COOKIE_USER, getCtx, type Ctx } from './context';
import { addDays, fmtDate, fmtDateTime, fmtSize, loc, nowStamp, parisStamp, parseIsoDay, todayIso } from './format';
import { ATTACHMENTS, CONF_LEVELS, ENFORCED_PERMS, MATRIX_ROLE, MATRIX_ROLES, ORIGINS, PERMS, SEARCH_SCOPES, SIM_ROLES, SIMULATED_MATRIX_ROLES, type Perm, type SimRole, type TKey } from './i18n';
import { addLink, applyChangeDecision, applyPendingDecision, approveRevision, audit, catchUpEffectiveDates, journalLink, linkBetween, lockOf, refreshHeadline, type ModifierSwap, type Tx } from './lifecycle';
import { isLinkRel, linkIssue, otherEnd, replacementIssue, storedLink } from './links';
import { limitWrite } from './ratelimit';
import { decisionWaitL } from './queries';
import { dateIssues, dateIssueText, effectIssue, issueFrom, latestEffect, type DateIssue } from './dates';
import { cleanFeatured } from './departments';
import { fileIssueReason, fileIssueText, fileRules } from './filetypes';
import { MAX_PER_RUN, purgeOrphans } from './orphans';
import { nextReviewDate, parseReviewMonths } from './review';
import { beyondBounds, cleanCriteria, hasCriteria, type SearchInput } from './search';
import { discardFile, FileRejectedError, fileColumns, nameStoredFile, readStored, renameDocFiles, stageFile, stageUpload, type StagedFile } from './storage';
import { submitChange, vigieSimulated } from './vigie';

/**
 * `field`: the form field the error is about, when the dialog can show it there. `stale`: the view the request came
 * from is out of date (lib/concurrency.ts): the dialog offers to reload the record.
 */
export type ActionResult = { ok: true; href?: string; message?: string } | { ok: false; error: string; field?: string; stale?: true };

type DocRow = typeof s.documents.$inferSelect;

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
 * checks: beyond it, the refusal to show, and the action does nothing.
 */
function throttled(ctx: Ctx): ActionResult | null {
  const wait = limitWrite(ctx.user.id);
  return wait ? { ok: false, error: ctx.t.rate_limited.replace('{n}', String(wait)) } : null;
}

/** A journal value with nothing in it (null, empty text or list) stored as null, so that "" and null are no change. */
function auditValue(v: AuditValue | undefined): AuditValue {
  return v == null || v === '' || (Array.isArray(v) && !v.length) ? null : v;
}

/** Journal changes, before → after, of the values that differ; stored as keys and codes (lib/queries.ts renders them). */
function changes(parts: [field: string, before: AuditValue, after: AuditValue][]): AuditChange[] {
  return parts
    .map(([field, b, a]) => ({ field, before: auditValue(b), after: auditValue(a) }))
    .filter((c) => JSON.stringify(c.before) !== JSON.stringify(c.after));
}

/** Retention class of a type or a document, as the journal stores it. */
function retentionValue(x: { retentionYears: number | null; retentionTrigger: string; retentionDisposition: string }): AuditValue {
  return { years: x.retentionYears, trigger: x.retentionTrigger, disposition: x.retentionDisposition };
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
  department: string; site: string | null; ownerId: string; authorText: string | null; conf: Conf; keywords: string[]; lang: string | null;
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
  const attachment = pick('attachment', ATTACHMENTS, base?.attachment ?? type?.attachments[0] ?? 'none');
  const origin = pick('origin', ORIGINS, base?.origin ?? type?.origins[0] ?? 'interne');
  return {
    title: str(fd, 'title') || base?.title || '',
    typeCode, subtype: opt(fd, 'subtype'), origin, attachment,
    projectCode: attachment === 'project' ? opt(fd, 'projectCode') : null,
    programCode: attachment === 'research' ? opt(fd, 'programCode') : null,
    department: str(fd, 'department') || base?.department || ctx.user.department || ctx.departments[0]?.code || '',
    site: opt(fd, 'site'),
    ownerId: str(fd, 'ownerId') || base?.ownerId || ctx.user.id,
    authorText: opt(fd, 'authorText'),
    conf: pick('conf', CONF_LEVELS, base?.conf ?? type?.confDefault ?? 'interne'),
    keywords: dedupe(str(fd, 'keywords').split(',').map((k) => k.trim()).filter(Boolean)),
    lang: opt(fd, 'lang'),
    reviewDueAt: opt(fd, 'reviewDueAt'), expiresAt: opt(fd, 'expiresAt'),
    sourceOrg: origin === 'externe' ? opt(fd, 'sourceOrg') : null,
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

/** Metadata fields an edit changes, with their values before and after (retention follows a change of type). */
function metaChanges(d: DocRow, f: Fields, retention: Partial<Pick<DocRow, 'retentionYears' | 'retentionTrigger' | 'retentionDisposition'>>): AuditChange[] {
  return changes([
    ...(Object.keys(f) as (keyof Fields)[]).map((k): [string, AuditValue, AuditValue] => [k, d[k], f[k]]),
    ['retention', retentionValue(d), retentionValue({ ...d, ...retention })],
  ]);
}

/**
 * Business rules of the register: type admits origin, attachment and confidentiality; contextual fields are filled.
 * An inactive type is refused, except for a document that already has it (`currentType`).
 */
function validateFields(ctx: Ctx, f: Fields, currentType?: string): ActionResult | null {
  const type = ctx.typeByCode.get(f.typeCode);
  if (!f.title || !type || !(type.active || type.code === currentType)) return fail(ctx);
  if (!type.origins.includes(f.origin) || !type.attachments.includes(f.attachment)) return fail(ctx, 'type_mismatch');
  if (!type.confAllowed.includes(f.conf)) return fail(ctx, 'conf_not_allowed');
  if (f.attachment === 'project' && !ctx.projects.some((p) => p.code === f.projectCode)) return fail(ctx, 'project_required');
  if (f.attachment === 'research' && !ctx.programs.some((p) => p.code === f.programCode)) return fail(ctx, 'program_required');
  if (f.origin === 'externe' && !f.sourceOrg) return fail(ctx, 'source_required');
  if (!ctx.departments.some((d) => d.code === f.department)) return fail(ctx);
  if (f.site && !ctx.sites.some((x) => x.key === f.site)) return fail(ctx);
  if (!ctx.users.has(f.ownerId) || ctx.users.get(f.ownerId)!.isSystem) return fail(ctx);
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
export async function createDocument(fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!ctx.can('upload')) return denied(ctx, 'upload');
  const f = readFields(ctx, fd);
  const invalid = validateFields(ctx, f);
  if (invalid) return invalid;
  // A new document is issued today at the earliest: its expiry and its review come after.
  const dated = dateIssues({ ...f, issuedAt: null, issueFrom: todayIso(), effective: null }, todayIso())[0];
  if (dated) return dateFail(ctx, dated);
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
  const id = await withStaged(staged, () => db.transaction(async (tx) => {
    const id = await nextDocId(tx, f);
    await tx.insert(s.documents).values({
      id, ...f, family: type.family, authorId: f.authorText ? null : ctx.user.id,
      status: 'draft', revWorking: 'A', createdAt: today, modifiedAt: today,
      retentionYears: type.retentionYears, retentionTrigger: type.retentionTrigger, retentionDisposition: type.retentionDisposition,
    });
    const [rev] = await tx.insert(s.revisions).values({ docId: id, letter: 'A', status: 'draft', createdAt: today }).returning();
    if (staged || template) {
      const comment = template ? { fr: `Créé depuis le modèle ${templateId} « ${template.title} »`, en: `Created from template ${templateId} “${template.title}”` } : { fr: 'Dépôt initial', en: 'Initial upload' };
      await tx.insert(s.workingVersions).values({ revisionId: rev.id, docId: id, n: 1, comment, authorId: ctx.user.id, date: today, ...(staged ? fileColumns(staged) : {}) });
    }
    await audit(tx, ctx.user.id, 'upload', id, `A.1${staged ? ` · ${fmtSize(staged.size, 'fr')}` : ''}${templateId ? ` · ${templateId}` : ''}`, rev.id);
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
  return { ok: true, href: docHref(id, f.attachment === 'project' ? 'project' : 'meta'), message: `${ctx.t.id_preview} : ${id}` };
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
export async function addWorkingVersion(fd: FormData): Promise<ActionResult> {
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
    await audit(tx, ctx.user.id, 'working', docId, `${rev.letter}.${n} · ${fmtSize(staged.size, 'fr')}`, rev.id);
    return { label: `${rev.letter}.${n}` };
  }));
  if (!('label' in res)) {
    await discardFile(staged);
    return 'err' in res ? fail(ctx, res.err) : res.behind;
  }
  await nameStoredFile(staged, docId, res.label);
  refresh();
  return { ok: true, href: docHref(docId, 'versions') };
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
export async function updateMeta(fd: FormData): Promise<ActionResult> {
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
  const invalid = validateFields(ctx, f, d.typeCode);
  if (invalid) return invalid;
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
    const retention = f.typeCode !== d.typeCode ? { retentionYears: type.retentionYears, retentionTrigger: type.retentionTrigger, retentionDisposition: type.retentionDisposition } : {};
    await tx.update(s.documents).set({ ...f, family: type.family, ...retention, modifiedAt: todayIso() }).where(eq(s.documents.id, id));
    // The values changed, with what decides who reads them: the strictest level across the change, and whether a
    // revision was in force (work on a draft stays in its drafting circle, D-14).
    const changed = metaChanges(d, f, retention);
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
export async function setReaders(docId: string, userIds: string[], version: number): Promise<ActionResult> {
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
export async function recordReview(docId: string, next: string | null, comment = ''): Promise<ActionResult> {
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

type RevRow = typeof s.revisions.$inferSelect;

/**
 * People who never approve a revision (docs/modele-cible.md §6): whoever requested the validation, its designated
 * author, the authors of its working versions, and the owner when nobody was designated to write it.
 */
async function circuitExclusions(tx: Tx, d: DocRow, rev: Pick<RevRow, 'id' | 'modifierId'>, requesterId: string): Promise<Set<string>> {
  const versions = await tx.select({ authorId: s.workingVersions.authorId }).from(s.workingVersions).where(eq(s.workingVersions.revisionId, rev.id));
  return new Set([requesterId, rev.modifierId ?? d.ownerId, ...versions.map((v) => v.authorId)]);
}

/** Who may approve with their default role (its row of the matrix), whatever role they simulate right now. */
async function approverCheck(tx: Tx, ctx: Ctx): Promise<(userId: string) => boolean> {
  const rows = await tx.select().from(s.rolePermissions).where(and(eq(s.rolePermissions.perm, 'approve'), eq(s.rolePermissions.granted, true)));
  const roles = new Set(rows.map((r) => r.role));
  return (id) => {
    const u = ctx.users.get(id);
    return !!u && !u.isSystem && roles.has(MATRIX_ROLE[u.role as SimRole]);
  };
}

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
    ...(fn.scope === 'project' && d.projectCode && (key === 'chef_projet' || key === 'validation_client') ? [ctx.projects.find((p) => p.code === d.projectCode)?.managerId] : []),
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
export async function requestValidation(docId: string, effectiveAt: string | null, base: WorkingBase | null): Promise<ActionResult> {
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
    const mayApprove = await approverCheck(tx, ctx);
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
export async function decideStep(workflowId: string, approve: boolean, expectedStep: number, reason = ''): Promise<ActionResult> {
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
export async function recallValidation(workflowId: string, expectedStep: number, reason = ''): Promise<ActionResult> {
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
export async function delegateStep(workflowId: string, toUserId: string, expectedStep: number): Promise<ActionResult> {
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
    if (!(await approverCheck(tx, ctx))(to.id)) return 'delegate_no_approve';
    await tx.update(s.workflowSteps).set({ assigneeId: to.id }).where(and(eq(s.workflowSteps.workflowId, workflowId), eq(s.workflowSteps.idx, cur.idx)));
    await audit(tx, ctx.user.id, 'delegate', wf.w.docId, `${workflowId} · ${loc(cur.name, 'fr')} → ${to.name}`, rev.id);
    return null;
  });
  if (err) return fail(ctx, err);
  refresh();
  return { ok: true };
}

export async function addComment(workflowId: string, text: string): Promise<ActionResult> {
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
export async function requestChange(docId: string, kind: 'modification' | 'obsolescence', reason: string, description: string, replacementId: string | null = null): Promise<ActionResult> {
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
export async function simulateVigieDecision(id: string, accepted: boolean, modifierId: string | null): Promise<ActionResult> {
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
export async function graftChange(requestId: string): Promise<ActionResult> {
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
export async function addDocLink(docId: string, rel: string, otherId: string): Promise<ActionResult> {
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
export async function removeDocLink(docId: string, linkId: number): Promise<ActionResult> {
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

export async function archiveDocuments(ids: string[]): Promise<ActionResult> {
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

export async function holdDocuments(ids: string[]): Promise<ActionResult> {
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
export async function releaseHold(docId: string): Promise<ActionResult> {
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
export async function restoreArchived(docId: string): Promise<ActionResult> {
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

// ── Saved searches ───────────────────────────────────────────────────────

const LABEL_MAX = 80;

/**
 * Saves the criteria of /recherche (query, facets, period) and the order of its results under a label: a personal
 * search for whoever may read, a search shared with a department (its members) or the whole group for records managers
 * and administrators (lib/access.ts maySaveSearch). Only criteria are kept: each person who opens it sees the documents
 * they may read.
 */
export async function saveSearch(label: string, search: SearchInput, scope: string, department: string | null): Promise<ActionResult> {
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
  if (dept !== null && !ctx.departments.some((d) => d.code === dept)) return fail(ctx);
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
export async function deleteSavedSearch(id: number): Promise<ActionResult> {
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
export async function purgeOrphanFiles(keys: string[]): Promise<ActionResult> {
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
export async function backUpData(): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  if (!mayBackUp(ctx)) return fail(ctx, 'forbidden');
  let res: Awaited<ReturnType<typeof backUpNow>>;
  try {
    res = await backUpNow(ctx.user.id);
  } catch (err) {
    console.error('[backup] failed', err);
    return fail(ctx, 'backup_failed');
  }
  if (res === 'busy') return fail(ctx, 'backup_busy');
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

export async function togglePermission(role: string, perm: string): Promise<ActionResult> {
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

/** Department (3-letter code used in IDs) or site. Provisional values until the org chart is provided. */
export async function addOrgValue(kind: 'department' | 'site', code: string, labelFr: string, labelEn: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const no = adminOnly(ctx);
  if (no) return no;
  const fr = labelFr.trim();
  if (!fr) return fail(ctx);
  const db = await getDb();
  if (kind === 'department') {
    const key = code.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(key) || ctx.departments.some((d) => d.code === key) || key === 'QMS') return fail(ctx, 'error', key);
    const en = labelEn.trim() || fr;
    await db.transaction(async (tx) => {
      await tx.insert(s.departments).values({ code: key, labelFr: fr, labelEn: en, sort: ctx.departments.length });
      await audit(tx, ctx.user.id, 'org_add', { kind: 'department', id: key }, `— → ${key} · ${fr} / ${en}`);
    });
  } else {
    const key = fr.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32) || 'site';
    if (ctx.sites.some((x) => x.key === key)) return fail(ctx, 'error', key);
    await db.transaction(async (tx) => {
      await tx.insert(s.sites).values({ key, label: fr, sort: ctx.sites.length });
      await audit(tx, ctx.user.id, 'org_add', { kind: 'site', id: key }, `— → ${fr}`);
    });
  }
  refresh();
  return { ok: true };
}

/**
 * Facets a department's page puts forward (/departements/[code]), in order: a list of facets of /recherche (at most
 * MAX_FEATURED, none to put none forward), or null to follow the default ones again (lib/departments.ts). Which facets
 * suit each department awaits the survey of their needs: the default stands until then.
 */
export async function setDepartmentFeatured(code: string, featured: string[] | null): Promise<ActionResult> {
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

export async function addFunctionHolder(functionKey: string, scopeValue: string | null, userId: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const no = adminOnly(ctx);
  if (no) return no;
  const fn = ctx.functions.find((f) => f.key === functionKey);
  const u = ctx.users.get(userId);
  if (!fn || !u || u.isSystem) return fail(ctx);
  const scope = fn.scope === 'global' ? null : scopeValue || null;
  const db = await getDb();
  // A holder decides approval steps: their default role must be able to approve.
  if (!(await approverCheck(db, ctx))(u.id)) return fail(ctx, 'delegate_no_approve');
  await db.transaction(async (tx) => {
    await tx.insert(s.functionHolders).values({ functionKey, scopeValue: scope, userId });
    await audit(tx, ctx.user.id, 'holder_add', { kind: 'function', id: functionKey }, '', null, { changes: [{ field: 'holder', scope, before: null, after: u.id }] });
  });
  refresh();
  return { ok: true };
}

export async function removeFunctionHolder(id: number): Promise<ActionResult> {
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

/** Circuit, confidentiality, retention and periodic review of a type in the register. */
export async function updateType(fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const busy = throttled(ctx);
  if (busy) return busy;
  const no = adminOnly(ctx);
  if (no) return no;
  const code = str(fd, 'code');
  const type = ctx.typeByCode.get(code);
  if (!type) return fail(ctx, 'not_found');
  const circuit = fd.getAll('circuit').map(String).filter((k) => ctx.functions.some((f) => f.key === k));
  const confAllowed = CONF_LEVELS.filter((c) => fd.getAll('confAllowed').map(String).includes(c));
  const confDefault = str(fd, 'confDefault') as Conf;
  if (!confAllowed.length || !confAllowed.includes(confDefault)) return fail(ctx, 'conf_not_allowed');
  // Empty: no periodicity. Otherwise a whole number of months, refused rather than corrected.
  const reviewMonths = parseReviewMonths(str(fd, 'reviewMonths'));
  if (reviewMonths === undefined) return { ok: false, error: ctx.t.review_months_invalid, field: 'reviewMonths' };
  const yearsRaw = str(fd, 'retentionYears');
  const years = yearsRaw === '' ? null : Math.max(0, Math.min(200, Number(yearsRaw) || 0));
  const triggers: RetentionTrigger[] = ['creation', 'in_force', 'superseded', 'project_end', 'contract_end', 'fiscal_year_end', 'expiry', 'asset_life', 'employee_departure', 'permanent'];
  const dispositions: Disposition[] = ['destroy', 'review', 'archive', 'permanent'];
  const trigger = triggers.find((x) => x === str(fd, 'retentionTrigger')) ?? type.retentionTrigger;
  const disposition = dispositions.find((x) => x === str(fd, 'retentionDisposition')) ?? type.retentionDisposition;
  const next = { circuit, confAllowed, confDefault, retentionYears: years, retentionTrigger: trigger, retentionDisposition: disposition, reviewMonths, active: fd.get('active') !== 'off' };
  // Months as the journal stores them: text (an AuditValue), rendered with their unit (lib/queries.ts).
  const months = (n: number | null): AuditValue => (n == null ? null : String(n));
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(s.docTypes).where(eq(s.docTypes.code, code));
    if (!cur) return;
    await tx.update(s.docTypes).set(next).where(eq(s.docTypes.code, code));
    const changed = changes([
      ['circuit', cur.circuit, next.circuit],
      ['confAllowed', cur.confAllowed, next.confAllowed],
      ['confDefault', cur.confDefault, next.confDefault],
      ['retention', retentionValue(cur), retentionValue(next)],
      ['reviewMonths', months(cur.reviewMonths), months(next.reviewMonths)],
      ['active', cur.active, next.active],
    ]);
    // Saving without a change leaves no entry.
    if (changed.length) await audit(tx, ctx.user.id, 'type', { kind: 'type', id: code }, '', null, { changes: changed });
  });
  refresh();
  return { ok: true, message: ctx.t.saved_ok };
}
