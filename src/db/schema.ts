import { sql } from 'drizzle-orm';
import { boolean, date, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

// Data model of the GED — see docs/modele-cible.md.

/** Text that is either written once (user content) or carried in both interface languages (system labels, seed data). */
export type Localized = string | { fr: string; en: string };

export type Origin = 'interne' | 'externe';
export type Attachment = 'none' | 'project' | 'research';
export type Conf = 'public' | 'restreint' | 'interne' | 'confidentiel' | 'tres_confidentiel';
/** Lifecycle of one revision (A, B…); `cancelled` closes a revision left open when its document is withdrawn. */
export type RevStatus = 'draft' | 'in_review' | 'approved' | 'in_force' | 'superseded' | 'cancelled';
/** Lifecycle of the document as a whole. */
export type DocState = 'active' | 'obsolete' | 'archived';
export type RetentionTrigger = 'creation' | 'in_force' | 'superseded' | 'project_end' | 'contract_end' | 'fiscal_year_end' | 'expiry' | 'asset_life' | 'employee_departure' | 'permanent';
export type Disposition = 'destroy' | 'review' | 'archive' | 'permanent';

// ── Organisation (provisional until the org chart is provided) ─────────────

export const departments = pgTable('departments', {
  code: text('code').primaryKey(), // 3 letters, used in document IDs without attachment
  labelFr: text('label_fr').notNull(),
  labelEn: text('label_en').notNull(),
  sort: integer('sort').notNull().default(0),
});

export const sites = pgTable('sites', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  sort: integer('sort').notNull().default(0),
});

/** People of the group. `role` is the default simulated application role; system actors (Codex, Keystone, Vigie) are flagged. */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  initials: text('initials').notNull(),
  role: text('role').notNull(),
  title: jsonb('title').$type<Localized>(),
  department: text('department').references(() => departments.code),
  site: text('site').references(() => sites.key),
  isSystem: boolean('is_system').notNull().default(false),
});

// ── Registry of document types (owned by Codex, read by Keystone) ─────────

export const families = pgTable('families', {
  key: text('key').primaryKey(),
  labelFr: text('label_fr').notNull(),
  labelEn: text('label_en').notNull(),
  /** Deck domain the family comes from (DI interne, DE externe, DP projet, DR recherche) — used for grouping only. */
  grp: text('grp').notNull(),
  sort: integer('sort').notNull().default(0),
});

export const docTypes = pgTable('doc_types', {
  code: text('code').primaryKey(),
  labelFr: text('label_fr').notNull(),
  labelEn: text('label_en').notNull(),
  family: text('family').notNull().references(() => families.key),
  origins: jsonb('origins').$type<Origin[]>().notNull(),
  attachments: jsonb('attachments').$type<Attachment[]>().notNull(),
  subtypes: jsonb('subtypes').$type<{ fr: string; en: string }[]>().notNull(),
  /** Approval steps after the author, as function keys; empty = approved as soon as requested. */
  circuit: jsonb('circuit').$type<string[]>().notNull(),
  retentionYears: integer('retention_years'),
  retentionTrigger: text('retention_trigger').$type<RetentionTrigger>().notNull(),
  retentionDisposition: text('retention_disposition').$type<Disposition>().notNull(),
  retentionBasis: text('retention_basis').notNull().default(''),
  confAllowed: jsonb('conf_allowed').$type<Conf[]>().notNull(),
  confDefault: text('conf_default').$type<Conf>().notNull(),
  iso: text('iso'),
  clientDeliverable: boolean('client_deliverable').notNull().default(false),
  source: text('source').notNull().default('deck'),
  active: boolean('active').notNull().default(true),
  sort: integer('sort').notNull().default(0),
});

/** Functions that approval circuits are made of (Responsable qualité, Chef de projet…). */
export const functions = pgTable('functions', {
  key: text('key').primaryKey(),
  labelFr: text('label_fr').notNull(),
  labelEn: text('label_en').notNull(),
  /** Where the holder is looked up: one person for the group, per department, per project or per research programme. */
  scope: text('scope').$type<'global' | 'department' | 'project' | 'research'>().notNull(),
  sort: integer('sort').notNull().default(0),
});

export const functionHolders = pgTable('function_holders', {
  id: serial('id').primaryKey(),
  functionKey: text('function_key').notNull().references(() => functions.key),
  /** Department code, project code or programme code for scoped functions; null for global ones. */
  scopeValue: text('scope_value'),
  userId: text('user_id').notNull().references(() => users.id),
});

// ── Projects (Keystone) and research programmes ─────────────────────────

/** Projects mirrored from Keystone (simulated until the Keystone integration exists). */
export const projects = pgTable('projects', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  client: text('client').notNull(),
  stage: text('stage').notNull(),
  managerId: text('manager_id').notNull().references(() => users.id),
  site: text('site').notNull(),
  tiers: text('tiers').notNull(),
  syncedAt: timestamp('synced_at', { mode: 'string' }).notNull(),
});

export const researchPrograms = pgTable('research_programs', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  managerId: text('manager_id').notNull().references(() => users.id),
});

// ── Documents ───────────────────────────────────────────────────────────

export const documents = pgTable('documents', {
  /** TYPE-CONTEXTE-SEQ, frozen once a revision has been approved. */
  id: text('id').primaryKey(),
  /** Earlier IDs (reclassification before first approval, migrated legacy references). */
  aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
  title: text('title').notNull(),
  origin: text('origin').$type<Origin>().notNull(),
  attachment: text('attachment').$type<Attachment>().notNull(),
  projectCode: text('project_code').references(() => projects.code),
  programCode: text('program_code').references(() => researchPrograms.code),
  family: text('family').notNull().references(() => families.key),
  typeCode: text('type_code').notNull().references(() => docTypes.code),
  subtype: text('subtype'),
  department: text('department').notNull().references(() => departments.code),
  site: text('site').references(() => sites.key),
  ownerId: text('owner_id').notNull().references(() => users.id),
  authorId: text('author_id').references(() => users.id),
  authorText: text('author_text'),
  conf: text('conf').$type<Conf>().notNull(),
  keywords: jsonb('keywords').$type<string[]>().notNull(),
  lang: text('lang'),
  state: text('state').$type<DocState>().notNull().default('active'),
  /** Headline status for lists and filters, kept in step with the revisions (see lib/lifecycle.ts). */
  status: text('status').notNull(),
  /** Letter of the revision in force, and of the revision being drafted or reviewed. */
  revInForce: text('rev_in_force'),
  revWorking: text('rev_working'),
  issuedAt: date('issued_at', { mode: 'string' }),
  reviewDueAt: date('review_due_at', { mode: 'string' }),
  expiresAt: date('expires_at', { mode: 'string' }),
  // Retention class: copied from the type at creation, adjustable by a records manager.
  retentionYears: integer('retention_years'),
  retentionTrigger: text('retention_trigger').$type<RetentionTrigger>().notNull(),
  retentionDisposition: text('retention_disposition').$type<Disposition>().notNull(),
  // External documents
  sourceOrg: text('source_org'),
  externalRef: text('external_ref'),
  receivedAt: date('received_at', { mode: 'string' }),
  // Project documents
  projectPhase: text('project_phase'),
  workPackage: text('work_package'),
  discipline: text('discipline'),
  // Research documents
  researchTheme: text('research_theme'),
  studyId: text('study_id'),
  ipStatus: text('ip_status'),
  // Internal documents
  processOwnerId: text('process_owner_id').references(() => users.id),
  legalHold: boolean('legal_hold').notNull().default(false),
  legalHoldAt: date('legal_hold_at', { mode: 'string' }),
  obsoleteAt: date('obsolete_at', { mode: 'string' }),
  archivedAt: date('archived_at', { mode: 'string' }),
  createdAt: date('created_at', { mode: 'string' }).notNull(),
  modifiedAt: date('modified_at', { mode: 'string' }).notNull(),
});

const docRef = () => documents.id;
const cascade = { onUpdate: 'cascade' as const };

/** Documents Keystone expects on a project (checklist of the project tab). */
export const projectExpected = pgTable('project_expected', {
  id: serial('id').primaryKey(),
  projectCode: text('project_code').notNull().references(() => projects.code),
  label: jsonb('label').$type<Localized>().notNull(),
  typeCode: text('type_code').references(() => docTypes.code),
  docId: text('doc_id').references(docRef, cascade),
  later: boolean('later').notNull().default(false),
  sort: integer('sort').notNull().default(0),
});

export const projectEvents = pgTable('project_events', {
  id: serial('id').primaryKey(),
  projectCode: text('project_code').notNull().references(() => projects.code),
  at: timestamp('at', { mode: 'string' }).notNull(),
  text: jsonb('text').$type<Localized>().notNull(),
});

/** Named readers of a confidential or "très confidentiel" document (lib/access.ts). */
export const documentReaders = pgTable(
  'document_readers',
  {
    docId: text('doc_id').notNull().references(docRef, cascade),
    userId: text('user_id').notNull().references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.docId, t.userId] })],
);

export const revisions = pgTable(
  'revisions',
  {
    id: serial('id').primaryKey(),
    docId: text('doc_id').notNull().references(docRef, cascade),
    letter: text('letter').notNull(),
    status: text('status').$type<RevStatus>().notNull(),
    effectiveAt: date('effective_at', { mode: 'string' }),
    approvedAt: date('approved_at', { mode: 'string' }),
    inForceAt: date('in_force_at', { mode: 'string' }),
    supersededAt: date('superseded_at', { mode: 'string' }),
    /** Person designated by the ECO to write this revision. */
    modifierId: text('modifier_id').references(() => users.id),
    /** Vigie change order that opened this revision. */
    changeRef: text('change_ref'),
    createdAt: date('created_at', { mode: 'string' }).notNull(),
  },
  // One letter per document, and at most one revision in force.
  (t) => [uniqueIndex('revisions_doc_letter').on(t.docId, t.letter), uniqueIndex('revisions_in_force').on(t.docId).where(sql`${t.status} = 'in_force'`)],
);

/** Working versions A.1, A.2… of a revision; the last one becomes the revision when approved. */
export const workingVersions = pgTable(
  'working_versions',
  {
    id: serial('id').primaryKey(),
    revisionId: integer('revision_id').notNull().references(() => revisions.id),
    docId: text('doc_id').notNull().references(docRef, cascade),
    n: integer('n').notNull(),
    comment: jsonb('comment').$type<Localized>().notNull(),
    authorId: text('author_id').notNull().references(() => users.id),
    date: date('date', { mode: 'string' }).notNull(),
    storage: text('storage'),
    fileKey: text('file_key'),
    fileName: text('file_name'),
    mime: text('mime'),
    size: integer('size'),
    pages: integer('pages'),
  },
  (t) => [uniqueIndex('working_versions_rev_n').on(t.revisionId, t.n)],
);

// ── Approval workflows ──────────────────────────────────────────────────

export const workflows = pgTable(
  'workflows',
  {
    id: text('id').primaryKey(),
    docId: text('doc_id').notNull().references(docRef, cascade),
    revisionId: integer('revision_id').notNull().references(() => revisions.id),
    requesterId: text('requester_id').notNull().references(() => users.id),
    due: date('due', { mode: 'string' }).notNull(),
    step: integer('step').notNull(),
    /** Set when the workflow ends: approved, or rejected (the revision goes back to draft; closed with a comment when the document is withdrawn). */
    outcome: text('outcome').$type<'approved' | 'rejected'>(),
    createdAt: date('created_at', { mode: 'string' }).notNull(),
  },
  // A revision has one running workflow at most.
  (t) => [uniqueIndex('workflows_running').on(t.revisionId).where(sql`${t.outcome} is null`)],
);

export const workflowSteps = pgTable(
  'workflow_steps',
  {
    workflowId: text('workflow_id').notNull().references(() => workflows.id),
    idx: integer('idx').notNull(),
    /** Function key of the step (null for the author's own step). */
    functionKey: text('function_key'),
    name: jsonb('name').$type<Localized>().notNull(),
    assigneeId: text('assignee_id').notNull().references(() => users.id),
    date: date('date', { mode: 'string' }),
    sign: boolean('sign').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.workflowId, t.idx] })],
);

export const workflowComments = pgTable('workflow_comments', {
  id: serial('id').primaryKey(),
  workflowId: text('workflow_id').notNull().references(() => workflows.id),
  authorId: text('author_id').notNull().references(() => users.id),
  at: date('at', { mode: 'string' }).notNull(),
  text: jsonb('text').$type<Localized>().notNull(),
});

// ── Change requests (owned by Vigie, mirrored here) ─────────────────────

export type ChangeStatus = 'submitted' | 'accepted' | 'rejected' | 'implemented';

export const changeRequests = pgTable(
  'change_requests',
  {
    /** Vigie reference (ECR-…). */
    id: text('id').primaryKey(),
    kind: text('kind').$type<'modification' | 'obsolescence'>().notNull(),
    docId: text('doc_id').notNull().references(docRef, cascade),
    requesterId: text('requester_id').notNull().references(() => users.id),
    reason: text('reason').notNull(),
    description: text('description').notNull().default(''),
    /** submitted → accepted / rejected (Vigie decision) → implemented (Codex applied it). */
    status: text('status').$type<ChangeStatus>().notNull(),
    ecoRef: text('eco_ref'),
    modifierId: text('modifier_id').references(() => users.id),
    decisionNote: text('decision_note'),
    source: text('source').notNull().default('codex'),
    createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
    decidedAt: timestamp('decided_at', { mode: 'string' }),
  },
  // One pending request per document.
  (t) => [uniqueIndex('change_requests_pending').on(t.docId).where(sql`${t.status} in ('submitted', 'accepted')`)],
);

// ── Audit, rights, saved searches ───────────────────────────────────────

export const auditLog = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  at: timestamp('at', { mode: 'string' }).notNull(),
  userId: text('user_id').notNull().references(() => users.id),
  action: text('action').notNull(),
  docId: text('doc_id').notNull(),
  detail: text('detail').notNull().default(''),
  /** Revision the entry is about (working version, circuit, entry into force…); null for the document as a whole (lib/access.ts). */
  revisionId: integer('revision_id'),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    role: text('role').notNull(),
    perm: text('perm').notNull(),
    granted: boolean('granted').notNull(),
  },
  (t) => [primaryKey({ columns: [t.role, t.perm] })],
);

export const savedSearches = pgTable('saved_searches', {
  id: serial('id').primaryKey(),
  label: jsonb('label').$type<Localized>().notNull(),
  q: text('q').notNull().default(''),
  facets: jsonb('facets').$type<Record<string, string[]>>().notNull(),
  sort: integer('sort').notNull().default(0),
});
