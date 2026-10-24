import 'server-only';
import { createHash } from 'node:crypto';
import { and, asc, eq, or, sql } from 'drizzle-orm';
import { getDb, schema as s, type Db } from '@/db';
import type { Attachment, Conf, Origin, RevStatus } from '@/db/schema';
import { readersApply } from './access';
import { contextOf, nextDocId, reserveDocId, seqWidth } from './codification';
import { dateIssues, dateIssueText } from './dates';
import { parseIsoDay, todayIso } from './format';
import { ATTACHMENTS, CONF_LEVELS, DICT, ORIGINS } from './i18n';
import { audit, refreshHeadline, type Tx } from './lifecycle';
import { logger } from './log';
import { sameFiles } from './queries';
import { checkFile, discardFile, FileRejectedError, fileColumns, nameStoredFile, stageFile, type CheckedFile, type FileRejection, type StagedFile } from './storage';
import { addTerms, loadTerms, readTerms } from './vocab';
import { canonicalSubtype, cleanTerm, docLang, VOCAB_MAX } from './vocab-rules';

// Integration endpoints (docs/api.md; their authentication: lib/server-auth.ts): the
// import of one legacy document for the migration tool (POST /api/import), and the deposit of one new document by
// another application of the group (POST /api/documents, mode 'deposit'). The business rules repeat those of
// actions.validateFields, which needs a user session and so cannot be called from a route handler.

/** System user that the migration is recorded under in the audit trail. */
export const IMPORT_ACTOR = 'codex';

/**
 * Whom the duplicate warning of an import is computed for (queries.ts sameFiles): a reader with the "read" permission
 * and no department, project or named access, outside every drafting circle. It names only a document whose file in
 * force any reader of the group has (Public, Restreint, Interne): the migration tool is outside Codex, and D-14 keeps
 * drafts, working versions and confidential documents from it.
 */
const IMPORT_VIEWER = {
  user: { id: IMPORT_ACTOR, name: 'Codex', initials: 'CX', role: 'system', title: null, department: null, site: null, isSystem: true, matricule: null },
  seesAll: false,
  can: (p: string) => p === 'read',
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

// ── Validation of the import metadata ───────────────────────────────────

export type Issue = { field: string; code: string; message: string };

const MESSAGES: Record<string, string> = {
  required: 'Champ obligatoire.',
  invalid_type: 'Type de valeur incorrect.',
  too_long: 'Valeur trop longue.',
  invalid_date: 'Date attendue au format AAAA-MM-JJ.',
  invalid_value: 'Valeur non admise.',
  invalid_letter: 'Lettre de révision attendue (A, B … Z, AA …).',
  duplicate_file: 'Fichier identique au fichier en vigueur de {docs} : importé quand même.',
  unknown_type: 'Type absent du registre ou inactif.',
  unknown_department: 'Département inconnu.',
  unknown_site: 'Site inconnu.',
  unknown_user: 'Utilisateur inconnu.',
  type_mismatch: DICT.fr.type_mismatch,
  conf_not_allowed: DICT.fr.conf_not_allowed,
  project_required: DICT.fr.project_required,
  program_required: DICT.fr.program_required,
  source_required: DICT.fr.source_required,
  readers_conf: 'Lecteurs désignés réservés aux documents confidentiels ou très confidentiels.',
  not_allowed: 'Champ réservé à la reprise de l’existant (POST /api/import) : un document déposé par une application commence en brouillon A.1 et passe par un circuit.',
  invalid_source_ref: 'Référence d’origine attendue : <application>:<référence> (ex. arche:dossier/CPX-APM-2026-01/business_case/v2), 200 caractères au plus.',
  owner_ambiguous: 'ownerId et ownerMatricule désignent deux utilisateurs différents.',
  ignored: 'Champ ignoré : il ne s’applique pas à ce document (origine, rattachement ou statut).',
  invalid_lang: 'Langue attendue : fr, en ou vide.',
  subtype_unlisted: 'Sous-type absent de la liste du type : gardé tel quel, proposé aux administrateurs du registre (Administration › Vocabulaires).',
  term_added: 'Terme ajouté au vocabulaire contrôlé : {terms}.',
};

type TypeRow = typeof s.docTypes.$inferSelect;
type UserRow = typeof s.users.$inferSelect;

type Refs = {
  types: Map<string, TypeRow>;
  departments: Set<string>;
  sites: Set<string>;
  users: Map<string, UserRow>;
  projects: Set<string>;
  programs: Set<string>;
};

async function loadRefs(db: Db): Promise<Refs> {
  const [types, departments, sites, users, projects, programs] = await Promise.all([
    db.select().from(s.docTypes),
    db.select({ code: s.departments.code }).from(s.departments),
    db.select({ key: s.sites.key }).from(s.sites),
    db.select().from(s.users),
    db.select({ code: s.projects.code }).from(s.projects),
    db.select({ code: s.researchPrograms.code }).from(s.researchPrograms),
  ]);
  return {
    types: new Map(types.map((t) => [t.code, t])),
    departments: new Set(departments.map((d) => d.code)),
    sites: new Set(sites.map((x) => x.key)),
    users: new Map(users.map((u) => [u.id, u])),
    projects: new Set(projects.map((p) => p.code)),
    programs: new Set(programs.map((p) => p.code)),
  };
}

/** Metadata of one imported document once validated against the register. */
export type ImportInput = {
  legacyRef: string; title: string; typeCode: string; subtype: string | null; origin: Origin; attachment: Attachment;
  projectCode: string | null; programCode: string | null; department: string; site: string | null; ownerId: string;
  authorId: string | null; authorText: string | null; conf: Conf; keywords: string[]; lang: string | null;
  letter: string; status: 'in_force' | 'draft';
  issuedAt: string | null; inForceAt: string | null; reviewDueAt: string | null; expiresAt: string | null;
  createdAt: string | null; modifiedAt: string | null;
  sourceOrg: string | null; externalRef: string | null; receivedAt: string | null;
  projectPhase: string | null; workPackage: string | null; discipline: string | null;
  researchTheme: string | null; studyId: string | null; ipStatus: string | null; processOwnerId: string | null;
  readers: string[]; comment: string | null;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Dates of the imported revision as they are recorded: in force on `inForceAt` (by default the issue date, then the
 * day of the import), approved until that date when it is still to come; the issue date defaults to that entry into
 * force, once it has happened.
 */
function recordedDates(v: Pick<ImportInput, 'status' | 'inForceAt' | 'issuedAt'>, today: string) {
  const inForceAt = v.status === 'in_force' ? v.inForceAt ?? v.issuedAt ?? today : null;
  const revStatus: RevStatus = v.status === 'draft' ? 'draft' : inForceAt! > today ? 'approved' : 'in_force';
  return { inForceAt, revStatus, issuedAt: v.issuedAt ?? (revStatus === 'in_force' ? inForceAt : null) };
}

/** Validates the `meta` part: shape, then the rules of the register (type admits origin, attachment, confidentiality…). */
function parseImportMeta(raw: unknown, refs: Refs): { value: ImportInput | null; issues: Issue[]; warnings: Issue[] } {
  const issues: Issue[] = [], warnings: Issue[] = [];
  const issue = (field: string, code: string) => issues.push({ field, code, message: MESSAGES[code] ?? code });
  if (!isRecord(raw)) {
    issue('meta', 'invalid_type');
    return { value: null, issues, warnings };
  }

  const given = (k: string) => raw[k] != null && String(raw[k]).trim() !== '';
  const text = (k: string, max = 300): string | null => {
    const v = raw[k];
    if (v == null) return null;
    if (typeof v !== 'string' && typeof v !== 'number') { issue(k, 'invalid_type'); return null; }
    const out = String(v).trim();
    if (out.length > max) { issue(k, 'too_long'); return null; }
    return out || null;
  };
  const required = (k: string, max?: number) => {
    const v = text(k, max);
    if (v == null && !issues.some((i) => i.field === k)) issue(k, 'required');
    return v;
  };
  // Dates: YYYY-MM-DD, or an ISO timestamp whose day is kept.
  const date = (k: string): string | null => {
    const v = text(k, 40);
    if (v == null) return null;
    const day = parseIsoDay(v);
    if (!day) { issue(k, 'invalid_date'); return null; }
    return day;
  };
  const oneOf = <T extends string>(k: string, allowed: readonly T[]): T | null => {
    const v = text(k, 40);
    if (v == null) return null;
    if (!(allowed as readonly string[]).includes(v)) { issue(k, 'invalid_value'); return null; }
    return v as T;
  };
  const person = (k: string, need = false): string | null => {
    const v = need ? required(k, 64) : text(k, 64);
    if (v == null) return null;
    const u = refs.users.get(v);
    if (!u || u.isSystem) { issue(k, 'unknown_user'); return null; }
    return v;
  };
  const list = (k: string, maxItems: number, maxLen: number): string[] => {
    const v = raw[k];
    if (v == null || v === '') return [];
    const items = typeof v === 'string' ? v.split(',') : Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null;
    if (!items) { issue(k, 'invalid_type'); return []; }
    const out = [...new Set(items.map(cleanTerm).filter(Boolean))];
    if (out.length > maxItems || out.some((x) => x.length > maxLen)) { issue(k, 'too_long'); return []; }
    return out;
  };

  const legacyRef = required('legacyRef', 200);
  const title = required('title', 500);
  const typeCode = required('typeCode', 16)?.toUpperCase() ?? null;
  const type = typeCode ? refs.types.get(typeCode) : undefined;
  if (typeCode && (!type || !type.active)) issue('typeCode', 'unknown_type');

  const projectRaw = text('projectCode', 32), programRaw = text('programCode', 32);
  const origin = given('origin') ? oneOf('origin', ORIGINS) : type?.origins[0] ?? 'interne';
  // Without an explicit attachment, a project or programme code says what the document belongs to.
  const attachment = given('attachment')
    ? oneOf('attachment', ATTACHMENTS)
    : projectRaw ? 'project' : programRaw ? 'research' : type && !type.attachments.includes('none') ? type.attachments[0] : 'none';
  const conf = given('conf') ? oneOf('conf', CONF_LEVELS) : type?.confDefault ?? null;
  const status = given('status') ? oneOf('status', ['in_force', 'draft'] as const) : 'in_force';
  const letter = (text('revision', 3) ?? 'A').toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(letter)) issue('revision', 'invalid_letter');

  const department = required('department', 8)?.toUpperCase() ?? null;
  if (department && !refs.departments.has(department)) issue('department', 'unknown_department');
  const site = text('site', 32);
  if (site && !refs.sites.has(site)) issue('site', 'unknown_site');
  const ownerId = person('ownerId', true);
  const processOwnerId = person('processOwnerId');

  // Author: a person of the group (user id) or free text (external author, former employee…).
  const author = text('author', 200);
  const authorUser = author ? refs.users.get(author) : undefined;
  const authorId = authorUser && !authorUser.isSystem ? authorUser.id : null;
  const authorText = author && !authorId ? author : null;

  const readers = list('readers', 200, 64);
  if (readers.some((u) => !refs.users.get(u) || refs.users.get(u)!.isSystem)) issue('readers', 'unknown_user');

  // Controlled values (point 59): a language fr, en or none; a sub-type in its type's spelling when it folds to one of its
  // labels, kept otherwise (the list stays open, MET-17) with a warning; keywords and source organisation are read
  // against their vocabularies when the document is written (importDocument).
  const lang = docLang(text('lang', 10));
  if (lang === undefined) issue('lang', 'invalid_lang');
  const subtype = canonicalSubtype(type?.subtypes ?? [], text('subtype', 200));
  if (type && !subtype.listed) warnings.push({ field: 'subtype', code: 'subtype_unlisted', message: MESSAGES.subtype_unlisted });
  const sourceOrgRaw = text('sourceOrg', VOCAB_MAX.source_org);
  const f = {
    subtype: subtype.value,
    keywords: list('keywords', 50, VOCAB_MAX.keyword),
    lang: lang ?? null,
    issuedAt: date('issuedAt'), inForceAt: date('inForceAt'), reviewDueAt: date('reviewDueAt'), expiresAt: date('expiresAt'),
    createdAt: date('createdAt'), modifiedAt: date('modifiedAt'),
    sourceOrg: sourceOrgRaw ? cleanTerm(sourceOrgRaw) || null : null, externalRef: text('externalRef', 200), receivedAt: date('receivedAt'),
    projectPhase: text('projectPhase', 100), workPackage: text('workPackage', 100), discipline: text('discipline', 100),
    researchTheme: text('researchTheme', 200), studyId: text('studyId', 100), ipStatus: text('ipStatus', 100),
    comment: text('comment', 2000),
  };

  // Business rules of the register (same as actions.validateFields).
  if (type && type.active && origin && attachment) {
    if (!type.origins.includes(origin)) issue('origin', 'type_mismatch');
    if (!type.attachments.includes(attachment)) issue('attachment', 'type_mismatch');
  }
  if (type && conf && !type.confAllowed.includes(conf)) issue('conf', 'conf_not_allowed');
  // Named readers only count for confidential levels (lib/access.ts).
  if (readers.length && conf && !readersApply(conf)) issue('readers', 'readers_conf');
  if (attachment === 'project' && !(projectRaw && refs.projects.has(projectRaw))) issue('projectCode', 'project_required');
  if (attachment === 'research' && !(programRaw && refs.programs.has(programRaw))) issue('programCode', 'program_required');
  if (origin === 'externe' && !f.sourceOrg) issue('sourceOrg', 'source_required');

  // Contextual fields that do not apply are dropped, as in the creation dialog, and reported back.
  const drop = <T>(field: string, v: T | null, applies: boolean): T | null => {
    if (v != null && !applies) {
      warnings.push({ field, code: 'ignored', message: MESSAGES.ignored });
      return null;
    }
    return v;
  };
  const ext = origin === 'externe', proj = attachment === 'project', res = attachment === 'research';
  const value: Omit<ImportInput, 'legacyRef' | 'title' | 'typeCode' | 'origin' | 'attachment' | 'department' | 'ownerId' | 'conf' | 'status'> = {
    ...f,
    letter, site, authorId, authorText, readers,
    projectCode: drop('projectCode', projectRaw, proj),
    programCode: drop('programCode', programRaw, res),
    sourceOrg: drop('sourceOrg', f.sourceOrg, ext),
    externalRef: drop('externalRef', f.externalRef, ext),
    receivedAt: drop('receivedAt', f.receivedAt, ext),
    projectPhase: drop('projectPhase', f.projectPhase, proj),
    workPackage: drop('workPackage', f.workPackage, proj),
    discipline: drop('discipline', f.discipline, proj),
    researchTheme: drop('researchTheme', f.researchTheme, res),
    studyId: drop('studyId', f.studyId, res),
    ipStatus: drop('ipStatus', f.ipStatus, res),
    processOwnerId: drop('processOwnerId', processOwnerId, origin === 'interne'),
    inForceAt: drop('inForceAt', f.inForceAt, status !== 'draft'),
  };

  // Coherence of the dates as they will be recorded, defaults included (lib/dates.ts: issue ≤ effect ≤ expiry…). A
  // document not issued yet will be on its entry into force still to come, or, for a draft, today at the earliest.
  if (status) {
    const today = todayIso();
    const rec = recordedDates({ status, inForceAt: value.inForceAt, issuedAt: f.issuedAt }, today);
    const effective = rec.inForceAt ? { letter, at: rec.inForceAt } : null;
    const from = rec.issuedAt ? null : rec.inForceAt ?? today;
    for (const i of dateIssues({ issuedAt: rec.issuedAt, issueFrom: from, effective, reviewDueAt: f.reviewDueAt, expiresAt: f.expiresAt, receivedAt: value.receivedAt }, today)) {
      issues.push({ field: i.field === 'effective' ? 'inForceAt' : i.field, code: i.rule, message: dateIssueText(DICT.fr, 'fr', i) });
    }
  }

  if (issues.length || !legacyRef || !title || !typeCode || !origin || !attachment || !department || !ownerId || !conf || !status) {
    return { value: null, issues, warnings };
  }
  return { value: { ...value, legacyRef, title, typeCode, origin, attachment, department, ownerId, conf, status }, issues, warnings };
}

// ── Import ──────────────────────────────────────────────────────────────

export type ImportFile = { buf: Buffer; name: string; mime: string };

export type ImportResult =
  | { kind: 'created'; id: string; revision: string; version: string | null; revStatus: RevStatus; file: boolean; warnings: Issue[] }
  /** A simulation (`dryRun`) that would have created the document `id`: nothing was stored nor written. */
  | { kind: 'dry_run'; id: string; warnings: Issue[] }
  | { kind: 'invalid'; issues: Issue[]; warnings: Issue[] }
  /** The legacy reference was already imported: the document it became. */
  | { kind: 'duplicate'; id: string }
  /**
   * The legacy reference is a Codex ID, current or former (an alias left by a reclassification), of another document,
   * which was not imported from it: id is that document's current ID.
   */
  | { kind: 'conflict'; id: string }
  /** The file was refused (format, size, virus scan: lib/storage.ts stageFile); nothing was imported. */
  | { kind: 'file_rejected'; rejection: FileRejection }
  /** A deposit whose source reference already made the document `id` from another file: nothing was written. */
  | { kind: 'ref_reused'; id: string };

/** `legacyRef` as parseImportMeta reads it, or null when it is missing or invalid. */
function legacyRefOf(raw: unknown): string | null {
  const v = isRecord(raw) ? raw.legacyRef : null;
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const ref = String(v).trim();
  return ref && ref.length <= 200 ? ref : null;
}

// ── Deposit by another application (POST /api/documents) ──────────────

/**
 * The reference of a deposited document in the application that filed it, `<application>:<reference>`
 * (« arche:dossier/CPX-APM-2026-01/business_case/v2 »): lower-case application name, then anything printable. It is
 * recorded as the document's origin reference (documents.legacy_ref, unique), never as an alias: a later call with the
 * same reference finds the document instead of creating a second one.
 */
export const SOURCE_REF = /^[a-z][a-z0-9_-]{1,31}:[^\s\p{C}](?:[^\p{C}]*[^\s\p{C}])?$/u;

function sourceRefOf(raw: unknown): string | null {
  const v = isRecord(raw) ? raw.sourceRef : null;
  if (typeof v !== 'string') return null;
  const ref = v.trim();
  return ref.length <= 200 && SOURCE_REF.test(ref) ? ref : null;
}

/**
 * Fields of a migration the deposit refuses: a deposited document is new, starts as draft A.1 and goes through a
 * circuit (docs/decisions.md: revisions are approved by a circuit); its dates are Codex's.
 */
const DEPOSIT_REFUSED = ['legacyRef', 'status', 'revision', 'inForceAt', 'issuedAt', 'createdAt', 'modifiedAt'] as const;

/**
 * The metadata of a deposit as the import reads them: the source reference as legacy reference, a draft, and the owner
 * given by Codex ID or by matricule (the person's number shared by the tools of the group, users.matricule).
 */
function depositMeta(raw: unknown, refs: Refs): { meta: unknown; issues: Issue[] } {
  const issues: Issue[] = [];
  const issue = (field: string, code: string) => issues.push({ field, code, message: MESSAGES[code] ?? code });
  if (!isRecord(raw)) return { meta: raw, issues };
  for (const k of DEPOSIT_REFUSED) if (raw[k] != null) issue(k, 'not_allowed');
  const ref = sourceRefOf(raw);
  if (!ref) issue('sourceRef', raw.sourceRef == null || raw.sourceRef === '' ? 'required' : 'invalid_source_ref');
  const meta: Record<string, unknown> = { ...raw, legacyRef: ref ?? 'invalid', status: 'draft' };
  delete meta.revision;
  delete meta.inForceAt;
  delete meta.issuedAt;
  delete meta.createdAt;
  delete meta.modifiedAt;
  const matricule = typeof raw.ownerMatricule === 'string' || typeof raw.ownerMatricule === 'number' ? String(raw.ownerMatricule).trim() : '';
  if (matricule) {
    const u = [...refs.users.values()].find((x) => !x.isSystem && x.matricule === matricule);
    if (!u) issue('ownerMatricule', 'unknown_user');
    else if (meta.ownerId != null && String(meta.ownerId).trim() !== '' && String(meta.ownerId).trim() !== u.id) issue('ownerId', 'owner_ambiguous');
    else meta.ownerId = u.id;
  }
  return { meta, issues };
}

/**
 * A deposit sent again with its source reference: the document it made, when the file is the same as the first one
 * (or neither has a file); `ref_reused` when another file comes under the same reference.
 */
async function replayedDeposit(db: Db, id: string, file: ImportFile | null): Promise<ImportResult> {
  const [first] = await db.select({ sha256: s.workingVersions.sha256 }).from(s.workingVersions)
    .innerJoin(s.revisions, eq(s.revisions.id, s.workingVersions.revisionId))
    .where(and(eq(s.workingVersions.docId, id), eq(s.workingVersions.n, 1)))
    .orderBy(asc(s.revisions.id)).limit(1);
  const sent = file ? createHash('sha256').update(file.buf).digest('hex') : null;
  return (first?.sha256 ?? null) === sent ? { kind: 'duplicate', id } : { kind: 'ref_reused', id };
}

/**
 * Who already answers to this legacy reference: the document imported from it (documents.legacy_ref) is a replay; a
 * document whose ID, current or former (an alias left by a reclassification), merely equals it is a conflict, never to
 * be recorded as the migrated document. Aliases alone cannot tell the two apart: they hold both kinds of reference.
 */
async function findByRef(tx: Tx, ref: string): Promise<Extract<ImportResult, { kind: 'duplicate' | 'conflict' }> | null> {
  const [imported] = await tx.select({ id: s.documents.id }).from(s.documents).where(eq(s.documents.legacyRef, ref)).limit(1);
  if (imported) return { kind: 'duplicate', id: imported.id };
  const [same] = await tx.select({ id: s.documents.id }).from(s.documents)
    .where(or(eq(s.documents.id, ref), sql`${s.documents.aliases} @> ${JSON.stringify([ref])}::jsonb`))
    .orderBy(sql`${s.documents.id} = ${ref} desc`).limit(1);
  return same ? { kind: 'conflict', id: same.id } : null;
}

/**
 * ID of the imported document: its legacy reference itself when it is a free, well-formed TYPE-CONTEXTE-SEQ for the
 * document's own type and context (a legacy system that already used Codex's format), otherwise the next free number.
 */
async function importId(tx: Tx, v: ImportInput): Promise<string> {
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  const pattern = new RegExp(`^${esc(v.typeCode)}-${esc(contextOf(v))}-\\d{${seqWidth(v)}}$`);
  if (pattern.test(v.legacyRef) && Number(v.legacyRef.split('-').at(-1)) > 0) {
    const [taken] = await tx.select({ id: s.documents.id }).from(s.documents)
      .where(or(eq(s.documents.id, v.legacyRef), sql`${s.documents.aliases} @> ${JSON.stringify([v.legacyRef])}::jsonb`)).limit(1);
    if (!taken) return v.legacyRef;
  }
  return nextDocId(tx, v);
}

/** Thrown to roll the transaction of a simulated import back with what it would have answered (as lib/transfer.ts). */
class DryRun extends Error {
  constructor(readonly result: ImportResult) {
    super('dry run');
  }
}

/**
 * Creates one migrated document: ID TYPE-CONTEXTE-SEQ, the legacy reference recorded (legacy_ref) and kept as an alias,
 * its revision (in force, approved with a future effective date, or in draft) and working version n°1 carrying the
 * file, stored as {ID}_{letter}.{ext} ({ID}_{letter}.1.{ext} for a draft).
 *
 * `dryRun` (POST /api/import?dryRun=1, docs/api.md « Simulation »): the same checks, file included (format, size, virus
 * scan), and the same transaction, rolled back once it has computed the ID and the warnings: no file stored, no row
 * written (document, counters, vocabularies, audit trail), an infected file not journaled. The ID given is the one a
 * real import would get if nothing changes in between.
 */
export async function importDocument(raw: unknown, file: ImportFile | null, o: { dryRun?: boolean; mode?: 'import' | 'deposit' } = {}): Promise<ImportResult> {
  const dryRun = !!o.dryRun;
  const deposit = o.mode === 'deposit';
  const db = await getDb();
  // A replay answers whatever the register has become since the first run (a type deactivated meanwhile…): 409 for an
  // import, the document already made for a deposit.
  const ref = deposit ? sourceRefOf(raw) : legacyRefOf(raw);
  const known = ref ? await findByRef(db, ref) : null;
  if (known) return deposit && known.kind === 'duplicate' ? replayedDeposit(db, known.id, file) : known;
  const refs = await loadRefs(db);
  const pre = deposit ? depositMeta(raw, refs) : { meta: raw, issues: [] };
  const parsed = parseImportMeta(pre.meta, refs);
  const { warnings } = parsed;
  const issues = [...pre.issues, ...parsed.issues.filter((i) => !(deposit && i.field === 'legacyRef'))];
  const v = issues.length ? null : parsed.value;
  if (!v) return { kind: 'invalid', issues, warnings };
  const type = refs.types.get(v.typeCode)!;
  const today = todayIso();

  // In force on its date; a date still to come leaves the revision approved until lifecycle.promoteDue puts it in force.
  const { inForceAt, revStatus, issuedAt } = recordedDates(v, today);
  const createdAt = v.createdAt ?? v.issuedAt ?? (revStatus === 'in_force' ? inForceAt! : today);
  const modifiedAt = [v.modifiedAt ?? (revStatus === 'in_force' ? inForceAt! : today), createdAt].sort().at(-1)!;
  const label = revStatus === 'draft' ? `${v.letter}.1` : v.letter;

  // The file goes to the store before the transaction (an upload never holds the database), then gets its name. A
  // simulation checks it the same way and stores nothing.
  let staged: StagedFile | null = null;
  let checked: CheckedFile | null = null;
  if (file) {
    const origin = { userId: IMPORT_ACTOR, entry: deposit ? 'create' : 'import', ref: v.legacyRef } as const;
    try {
      if (dryRun) checked = await checkFile(file.buf, file.name, file.mime, origin, { journal: false });
      else checked = staged = await stageFile(file.buf, file.name, file.mime, origin);
    } catch (err) {
      if (err instanceof FileRejectedError) return { kind: 'file_rejected', rejection: err.rejection };
      throw err;
    }
    // Not blocking: the same file may rightly be filed twice (a form attached to two projects).
    try {
      const same = await sameFiles(IMPORT_VIEWER, checked!.sha256);
      if (same.length) {
        const docs = same.map((x) => `${x.docId} ${x.label}`).join(', ');
        warnings.push({ field: 'file', code: 'duplicate_file', message: MESSAGES.duplicate_file.replace('{docs}', docs) });
      }
    } catch (err) {
      logger(deposit ? 'deposit' : 'import').warn('duplicate check failed', { err });
    }
  }
  let res: ImportResult;
  try {
    res = await db.transaction(async (tx): Promise<ImportResult> => {
      // Imports run one at a time (a no-op on PGlite's single connection): two imports of the same reference cannot both
      // find it free, and the two counter rows an import may lock (its legacy reference's scope, its own) are never
      // taken in crossed order by another import.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('codex:import'))`);
      // The legacy reference stays as an alias, and may become the ID: its number is reserved before the checks below,
      // which then see any document that drew it from the counter, and no counter hands it out again. A deposit's source
      // reference is neither (it names the document in the application that filed it).
      if (!deposit) await reserveDocId(tx, v.legacyRef);
      // Checked again inside the transaction: a concurrent import of the same reference has committed by now.
      const existing = await findByRef(tx, v.legacyRef);
      // A simulation rolls back the reservation above too.
      if (existing && dryRun) throw new DryRun(existing);
      if (existing) return existing;
      const id = deposit ? await nextDocId(tx, v) : await importId(tx, v);
      // Unknown terms are added (controlled addition, journaled under the import), never refused: the existing ones
      // give their spelling (« SIEMENS » → « Siemens »), a merged duplicate the term it was merged into.
      for (const [kind, field, values] of [['source_org', 'sourceOrg', v.sourceOrg ? [v.sourceOrg] : []], ['keyword', 'keywords', v.keywords]] as const) {
        const read = readTerms(await loadTerms(tx, kind), values);
        if (kind === 'source_org') v.sourceOrg = read.values[0] ?? null;
        else v.keywords = read.values;
        if (!read.added.length) continue;
        await addTerms(tx, kind, read.added, IMPORT_ACTOR, v.legacyRef);
        warnings.push({ field, code: 'term_added', message: MESSAGES.term_added.replace('{terms}', read.added.map((x) => `« ${x} »`).join(', ')) });
      }
      await tx.insert(s.documents).values({
        id, aliases: deposit ? [] : [v.legacyRef], legacyRef: v.legacyRef, title: v.title, origin: v.origin, attachment: v.attachment,
        projectCode: v.projectCode, programCode: v.programCode, family: type.family, typeCode: type.code, subtype: v.subtype,
        department: v.department, site: v.site, ownerId: v.ownerId, authorId: v.authorId, authorText: v.authorText,
        conf: v.conf, keywords: v.keywords, lang: v.lang, status: revStatus,
        issuedAt, reviewDueAt: v.reviewDueAt, expiresAt: v.expiresAt,
        retentionYears: type.retentionYears, retentionTrigger: type.retentionTrigger, retentionDisposition: type.retentionDisposition,
        sourceOrg: v.sourceOrg, externalRef: v.externalRef, receivedAt: v.receivedAt,
        projectPhase: v.projectPhase, workPackage: v.workPackage, discipline: v.discipline,
        researchTheme: v.researchTheme, studyId: v.studyId, ipStatus: v.ipStatus, processOwnerId: v.processOwnerId,
        createdAt, modifiedAt,
    });
    const [rev] = await tx.insert(s.revisions).values({
      docId: id, letter: v.letter, status: revStatus, createdAt,
      approvedAt: revStatus === 'draft' ? null : revStatus === 'in_force' ? inForceAt : today,
      effectiveAt: revStatus === 'approved' ? inForceAt : null,
      inForceAt: revStatus === 'in_force' ? inForceAt : null,
    }).returning();
    const stored = staged;
    // A revision that has been approved is represented by its last working version, even without a file (as in the seed);
    // a draft without a file waits for its first working version, as after createDocument.
    const withVersion = !!checked || revStatus !== 'draft';
    if (withVersion) {
      await tx.insert(s.workingVersions).values({
        revisionId: rev.id, docId: id, n: 1, authorId: v.authorId ?? v.ownerId, date: revStatus === 'in_force' ? inForceAt! : modifiedAt,
        comment: v.comment ?? (deposit
          ? { fr: `Déposé par ${v.legacyRef.split(':')[0]} (${v.legacyRef})`, en: `Filed by ${v.legacyRef.split(':')[0]} (${v.legacyRef})` }
          : { fr: `Reprise de ${v.legacyRef}`, en: `Migrated from ${v.legacyRef}` }),
        ...(stored ? fileColumns(stored) : {}),
      });
    }
    if (v.readers.length) await tx.insert(s.documentReaders).values(v.readers.map((userId) => ({ docId: id, userId })));
    await refreshHeadline(tx, id);
    // A deposit is journaled as a document created on screen (an upload of its first version), under Codex's system user,
    // its source reference in the detail; an import as the arrival of a document migrated from the legacy system.
    if (deposit) {
      await audit(tx, IMPORT_ACTOR, 'upload', id, `${withVersion ? label : v.letter} · ${v.legacyRef}`, rev.id, {
        ...(stored ? { sha256: stored.sha256 } : {}),
        text: { code: 'version', params: { label: withVersion ? label : v.letter, ...(stored ? { size: stored.size } : {}) } },
      });
    } else {
      await audit(tx, IMPORT_ACTOR, 'import', id, `${v.legacyRef} → ${withVersion ? label : v.letter}`, rev.id, {
        ...(stored ? { sha256: stored.sha256 } : {}),
        text: { code: 'import', params: { ref: v.legacyRef, label: withVersion ? label : v.letter, ...(stored ? { size: stored.size } : {}) } },
      });
    }
    const created: ImportResult = { kind: 'created', id, revision: v.letter, version: withVersion ? `${v.letter}.1` : null, revStatus, file: !!checked, warnings };
    // A simulation stops here: everything written above is rolled back.
    if (dryRun) throw new DryRun(created);
    return created;
    });
  } catch (err) {
    if (err instanceof DryRun) {
      const r = err.result;
      logger(deposit ? 'deposit' : 'import').info(`${deposit ? 'deposit' : 'import'} simulated (dry run), nothing written`, { ref: v.legacyRef, result: r.kind === 'created' ? r.id : r.kind });
      return r.kind === 'created' ? { kind: 'dry_run', id: r.id, warnings: r.warnings } : r;
    }
    await discardFile(staged);
    throw err;
  }
  if (res.kind !== 'created') await discardFile(staged);
  else if (staged) await nameStoredFile(staged, res.id, label);
  return res;
}
