import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { eq, or, sql } from 'drizzle-orm';
import { getDb, schema as s, type Db } from '@/db';
import type { Attachment, Conf, Origin, RevStatus } from '@/db/schema';
import { readersApply } from './access';
import { contextOf, nextDocId, reserveDocId, seqWidth } from './codification';
import { dateIssues, dateIssueText } from './dates';
import { fmtSize, parseIsoDay, todayIso } from './format';
import { ATTACHMENTS, CONF_LEVELS, DICT, ORIGINS } from './i18n';
import { audit, refreshHeadline, type Tx } from './lifecycle';
import { discardFile, fileColumns, nameStoredFile, stageFile, type StagedFile } from './storage';

// Integration endpoints (docs/api.md): bearer-token check shared by /api/import and /api/integrations/vigie, and the
// import of one legacy document for the migration tool. The business rules repeat those of actions.validateFields,
// which needs a user session and so cannot be called from a route handler.

/** System user that the migration is recorded under in the audit trail. */
export const IMPORT_ACTOR = 'codex';

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

// ── Integration tokens ──────────────────────────────────────────────────

const digest = (v: string) => createHash('sha256').update(v).digest();

/**
 * Null when the request carries `Authorization: Bearer <token>` matching the environment variable `envVar`.
 * Otherwise the response to send: 503 while the variable is unset (endpoint disabled), 401 for a missing or wrong token.
 */
export function checkBearer(req: Request, envVar: 'CODEX_IMPORT_TOKEN' | 'VIGIE_WEBHOOK_TOKEN'): Response | null {
  const expected = process.env[envVar]?.trim();
  if (!expected) return json({ error: 'disabled' }, 503);
  const m = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(req.headers.get('authorization') ?? '');
  // Comparing fixed-length digests keeps the check constant-time whatever the length of the token sent.
  if (!m || !timingSafeEqual(digest(m[1]), digest(expected))) {
    return json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer realm="codex"' });
  }
  return null;
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
  ignored: 'Champ ignoré : il ne s’applique pas à ce document (origine, rattachement ou statut).',
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
    const out = [...new Set(items.map((x) => x.trim()).filter(Boolean))];
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

  const f = {
    subtype: text('subtype', 200),
    keywords: list('keywords', 50, 100),
    lang: text('lang', 10)?.toLowerCase() ?? null,
    issuedAt: date('issuedAt'), inForceAt: date('inForceAt'), reviewDueAt: date('reviewDueAt'), expiresAt: date('expiresAt'),
    createdAt: date('createdAt'), modifiedAt: date('modifiedAt'),
    sourceOrg: text('sourceOrg'), externalRef: text('externalRef', 200), receivedAt: date('receivedAt'),
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
  | { kind: 'invalid'; issues: Issue[]; warnings: Issue[] }
  /** The legacy reference was already imported: the document it became. */
  | { kind: 'duplicate'; id: string }
  /**
   * The legacy reference is a Codex ID, current or former (an alias left by a reclassification), of another document,
   * which was not imported from it: id is that document's current ID.
   */
  | { kind: 'conflict'; id: string };

/** `legacyRef` as parseImportMeta reads it, or null when it is missing or invalid. */
function legacyRefOf(raw: unknown): string | null {
  const v = isRecord(raw) ? raw.legacyRef : null;
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const ref = String(v).trim();
  return ref && ref.length <= 200 ? ref : null;
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

/**
 * Creates one migrated document: ID TYPE-CONTEXTE-SEQ, the legacy reference recorded (legacy_ref) and kept as an alias,
 * its revision (in force, approved with a future effective date, or in draft) and working version n°1 carrying the
 * file, stored as {ID}_{letter}.{ext} ({ID}_{letter}.1.{ext} for a draft).
 */
export async function importDocument(raw: unknown, file: ImportFile | null): Promise<ImportResult> {
  const db = await getDb();
  // A replay answers 409 whatever the register has become since the first run (a type deactivated meanwhile…).
  const ref = legacyRefOf(raw);
  const known = ref ? await findByRef(db, ref) : null;
  if (known) return known;
  const refs = await loadRefs(db);
  const { value: v, issues, warnings } = parseImportMeta(raw, refs);
  if (!v) return { kind: 'invalid', issues, warnings };
  const type = refs.types.get(v.typeCode)!;
  const today = todayIso();

  // In force on its date; a date still to come leaves the revision approved until lifecycle.promoteDue puts it in force.
  const { inForceAt, revStatus, issuedAt } = recordedDates(v, today);
  const createdAt = v.createdAt ?? v.issuedAt ?? (revStatus === 'in_force' ? inForceAt! : today);
  const modifiedAt = [v.modifiedAt ?? (revStatus === 'in_force' ? inForceAt! : today), createdAt].sort().at(-1)!;
  const label = revStatus === 'draft' ? `${v.letter}.1` : v.letter;

  // The file goes to the store before the transaction (an upload never holds the database), then gets its name.
  const staged: StagedFile | null = file ? await stageFile(file.buf, file.name, file.mime) : null;
  let res: ImportResult;
  try {
    res = await db.transaction(async (tx): Promise<ImportResult> => {
      // Imports run one at a time (a no-op on PGlite's single connection): two imports of the same reference cannot both
      // find it free, and the two counter rows an import may lock (its legacy reference's scope, its own) are never
      // taken in crossed order by another import.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('codex:import'))`);
      // The legacy reference stays as an alias, and may become the ID: its number is reserved before the checks below,
      // which then see any document that drew it from the counter, and no counter hands it out again.
      await reserveDocId(tx, v.legacyRef);
      // Checked again inside the transaction: a concurrent import of the same reference has committed by now.
      const existing = await findByRef(tx, v.legacyRef);
      if (existing) return existing;
      const id = await importId(tx, v);
      await tx.insert(s.documents).values({
        id, aliases: [v.legacyRef], legacyRef: v.legacyRef, title: v.title, origin: v.origin, attachment: v.attachment,
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
    const withVersion = !!stored || revStatus !== 'draft';
    if (withVersion) {
      await tx.insert(s.workingVersions).values({
        revisionId: rev.id, docId: id, n: 1, authorId: v.authorId ?? v.ownerId, date: revStatus === 'in_force' ? inForceAt! : modifiedAt,
        comment: v.comment ?? { fr: `Reprise de ${v.legacyRef}`, en: `Migrated from ${v.legacyRef}` },
        ...(stored ? fileColumns(stored) : {}),
      });
    }
    if (v.readers.length) await tx.insert(s.documentReaders).values(v.readers.map((userId) => ({ docId: id, userId })));
    await refreshHeadline(tx, id);
    await audit(tx, IMPORT_ACTOR, 'import', id, `${v.legacyRef} → ${withVersion ? label : v.letter}${stored ? ` · ${fmtSize(stored.size, 'fr')}` : ''}`, rev.id);
    return { kind: 'created', id, revision: v.letter, version: withVersion ? `${v.letter}.1` : null, revStatus, file: !!stored, warnings };
    });
  } catch (err) {
    await discardFile(staged);
    throw err;
  }
  if (res.kind !== 'created') await discardFile(staged);
  else if (staged) await nameStoredFile(staged, res.id, label);
  return res;
}
