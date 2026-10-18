import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

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
/** Who sees a saved search: its owner, the members of a department, or the whole group. */
export type SearchScope = 'personal' | 'department' | 'group';
/** Period of a search on one date of the documents (lib/search.ts Period), bounds included. */
export type SearchPeriod = { field: 'modified' | 'issued' | 'effective' | 'review' | 'expiry'; from: string | null; to: string | null };
/** Orders of the search results (lib/search.ts SORT_KEYS). */
export type SearchOrder = 'relevance' | 'modified' | 'issued' | 'due' | 'id' | 'title';

// ── Organisation (provisional until the org chart is provided) ─────────────

/**
 * Departments and sites are renamed and retired in Administration › Organisation (lib/org-rules.ts). A department's code
 * is the context of the IDs without attachment (PRO-QUA-0003): it never changes. One that something uses is made
 * inactive rather than deleted: no longer offered to a new document or a shared search, still shown wherever it is
 * already set; an inactive department still takes function holders, for the circuits of its documents.
 */
export const departments = pgTable('departments', {
  code: text('code').primaryKey(), // 3 letters, used in document IDs without attachment
  labelFr: text('label_fr').notNull(),
  labelEn: text('label_en').notNull(),
  sort: integer('sort').notNull().default(0),
  /**
   * Search facets the department's page puts forward (lib/departments.ts), in order; null for the default ones. Set in
   * Administration › Organisation; the choice per department awaits the survey of each department's needs.
   */
  featured: jsonb('featured').$type<string[]>(),
  active: boolean('active').notNull().default(true),
});

export const sites = pgTable('sites', {
  /** Made from the French label when the site is added; stored on documents and people, never shown, never changed. */
  key: text('key').primaryKey(),
  labelFr: text('label_fr').notNull(),
  labelEn: text('label_en').notNull(),
  sort: integer('sort').notNull().default(0),
  active: boolean('active').notNull().default(true),
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
  /**
   * Periodic review, in months (lib/review.ts): the next review date of a document of this type when it enters into
   * force without one, or when its review is recorded without a date. Null: none (values await the register's review).
   */
  reviewMonths: integer('review_months'),
  iso: text('iso'),
  clientDeliverable: boolean('client_deliverable').notNull().default(false),
  /** Where the entry comes from: the deck, the Keystone register, both (seed), or Administration (`codex`). */
  source: text('source').notNull().default('deck'),
  active: boolean('active').notNull().default(true),
  sort: integer('sort').notNull().default(0),
}, (t) => [check('doc_types_review_months', sql`${t.reviewMonths} is null or ${t.reviewMonths} between 1 and 240`)]);

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

/**
 * Research programmes, the context of a research document's ID (PRT-R2601-004). Managed in Administration › Fonctions &
 * circuits; a closed programme is made inactive rather than removed once used: it is no longer offered to a new
 * document, and the documents that have it keep it.
 */
export const researchPrograms = pgTable('research_programs', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  /** Answers for the programme's research-scoped steps when no holder is named for it (lib/actions.ts resolveFunction). */
  managerId: text('manager_id').notNull().references(() => users.id),
  active: boolean('active').notNull().default(true),
});

// ── Controlled vocabularies (point 59 of docs/reste-a-faire.md) ─────────

/**
 * Terms of a controlled vocabulary (lib/vocab.ts): the source organisations of external documents and the keywords.
 * Documents keep the term's name as text (documents.source_org, documents.keywords), so that search, export and import
 * read them as before; a term stands for every value that folds to its `key` or to one of its `aliases` (lib/vocab-rules.ts
 * vocabKey: case, accents and spaces set aside). Added by Administration › Vocabulaires, by a document's form once its
 * author confirms the new term, or by the import; renamed or merged there, the documents that carry it following
 * (those under legal hold keep their value, which the former name, kept as an alias, still resolves).
 */
const vocabColumns = () => ({
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  /** vocabKey(name): one term per key. */
  key: text('key').notNull(),
  /** Former names and names merged into this term, still resolved to it (an import, a document under legal hold). */
  aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
  createdAt: date('created_at', { mode: 'string' }).notNull(),
});

export const sourceOrgs = pgTable('source_orgs', vocabColumns(), (t) => [uniqueIndex('source_orgs_key').on(t.key)]);
export const keywordTerms = pgTable('keyword_terms', vocabColumns(), (t) => [uniqueIndex('keyword_terms_key').on(t.key)]);

// ── Documents ───────────────────────────────────────────────────────────

export const documents = pgTable(
  'documents',
  {
    /** TYPE-CONTEXTE-SEQ, frozen once a revision has been approved. */
    id: text('id').primaryKey(),
    /** Earlier IDs (reclassification before first approval, migrated legacy references). */
    aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
    /**
     * Reference in the legacy system the document was migrated from (/api/import), also kept in aliases; null for a
     * document created in Codex. Aliases also hold former IDs: only this column says which reference was imported.
     */
    legacyRef: text('legacy_ref').unique(),
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
    // Retention class: copied from the type at creation, adjustable by a records manager (lib/actions.ts setRetentionClass).
    retentionYears: integer('retention_years'),
    retentionTrigger: text('retention_trigger').$type<RetentionTrigger>().notNull(),
    retentionDisposition: text('retention_disposition').$type<Disposition>().notNull(),
    /**
     * The class was set on this document by a records manager and no longer follows its type: a change of the type's rule
     * applied to its documents leaves it as it is (lib/actions.ts updateType). False: it follows the type's rule.
     */
    retentionOverride: boolean('retention_override').notNull().default(false),
    /**
     * Date of a trigger event Codex cannot know (end of life of the asset, departure of the employee: lib/retention.ts
     * EVENT_TRIGGERS), entered on the record by its owner or a records manager; null until then.
     */
    retentionEventAt: date('retention_event_at', { mode: 'string' }),
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
    /**
     * Raised by the database at every change of the row, whatever writes it (trigger documents_version, src/db/index.ts),
     * and by hand when the named readers change. The record's dialogs send it back: an edit from an outdated view is
     * refused (lib/actions.ts updateMeta, setReaders; lib/concurrency.ts). Shown to the drafting circle only (docView).
     */
    version: integer('version').notNull().default(1),
  },
  // A former ID (reclassification, migration) resolves with `aliases @> '["…"]'` (lib/queries.ts getDoc, lib/importer.ts).
  (t) => [index('documents_aliases').using('gin', t.aliases.op('jsonb_path_ops'))],
);

const docRef = () => documents.id;
const cascade = { onUpdate: 'cascade' as const };

/** Documents Keystone expects on a project (checklist of the project tab). */
export const projectExpected = pgTable(
  'project_expected',
  {
    id: serial('id').primaryKey(),
    projectCode: text('project_code').notNull().references(() => projects.code),
    label: jsonb('label').$type<Localized>().notNull(),
    typeCode: text('type_code').references(() => docTypes.code),
    docId: text('doc_id').references(docRef, cascade),
    later: boolean('later').notNull().default(false),
    sort: integer('sort').notNull().default(0),
  },
  // The project tab's checklist (lib/keystone.ts); the expected item a document fills, and the cascade of a reclassification.
  (t) => [index('project_expected_project').on(t.projectCode), index('project_expected_doc').on(t.docId)],
);

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
  // The key serves a document's readers; user_id the readers' clause of lib/access.ts readableSql, in every list.
  (t) => [primaryKey({ columns: [t.docId, t.userId] }), index('document_readers_user').on(t.userId)],
);

/**
 * Types a template (type FRM, context QMS) is meant for: « Nouveau depuis un modèle » offers it first to a document of
 * one of these types (lib/actions.ts setTemplateTypes). A type a template is linked to counts as in use in the register.
 */
export const templateTypes = pgTable(
  'template_types',
  {
    docId: text('doc_id').notNull().references(docRef, { onUpdate: 'cascade', onDelete: 'cascade' }),
    typeCode: text('type_code').notNull().references(() => docTypes.code, { onUpdate: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.docId, t.typeCode] })],
);

/** Group of score() a searched value of the record weighs in (lib/search.ts SCORE_WEIGHT). */
export type TermField = 'id' | 'title' | 'keyword' | 'ref' | 'other';

/**
 * Values of the record /recherche searches, one row per value, folded as lib/search.ts fold folds them (accents and
 * case ignored): ID and former IDs, title, keywords, external reference and study ID, subtype, source organisation and
 * free-text author. Written by the database whenever a document is inserted or one of these columns changes (trigger
 * documents_terms, src/db/index.ts), never by the application. Values from elsewhere (type label in the reader's
 * language, names of the owner and of the author) are matched when the search runs (lib/queries.ts searchDocs).
 */
export const documentTerms = pgTable(
  'document_terms',
  {
    docId: text('doc_id').notNull().references(docRef, { onUpdate: 'cascade', onDelete: 'cascade' }),
    field: text('field').$type<TermField>().notNull(),
    term: text('term').notNull(),
  },
  // Trigrams find the values holding a piece of text (LIKE '%…%') without reading them all.
  (t) => [index('document_terms_doc').on(t.docId), index('document_terms_term').using('gin', t.term.op('gin_trgm_ops'))],
);

/** Nature of a link between two documents (lib/links.ts); « Remplacé par » is a `replaces` link read from its target. */
export type LinkKind = 'replaces' | 'see_also';
/** A link as one of its documents reads it: it replaces the other, is replaced by it, or refers to it. */
export type LinkRel = 'replaces' | 'replaced_by' | 'see_also';
/**
 * Why the replacement proposed with a withdrawal was not linked when the withdrawal applied (lib/links.ts
 * replacementOutcome): no longer active, a legal hold on either document, a « remplace » link the other way already.
 */
export type LinkSkip = 'inactive' | 'hold' | 'linked';

/**
 * Links between two distinct documents (point 16 of docs/reste-a-faire.md): `source` replaces `target`, or each refers
 * to the other (`see_also`). One record per pair of documents, whatever its direction: no link to itself, no duplicate,
 * never both « remplace » and « remplacé par ». Both ends follow a reclassification (cascade on documents.id).
 */
export const documentLinks = pgTable(
  'document_links',
  {
    id: serial('id').primaryKey(),
    sourceId: text('source_id').notNull().references(docRef, cascade),
    targetId: text('target_id').notNull().references(docRef, cascade),
    kind: text('kind').$type<LinkKind>().notNull(),
    createdBy: text('created_by').notNull().references(() => users.id),
    createdAt: date('created_at', { mode: 'string' }).notNull(),
  },
  (t) => [
    check('document_links_kind', sql`${t.kind} in ('replaces', 'see_also')`),
    check('document_links_distinct', sql`${t.sourceId} <> ${t.targetId}`),
    uniqueIndex('document_links_pair').on(sql`least(${t.sourceId}, ${t.targetId})`, sql`greatest(${t.sourceId}, ${t.targetId})`),
    // The links of one document, either end (lib/queries.ts listDocLinks, lib/lifecycle.ts linkBetween), and the cascades of a reclassification.
    index('document_links_source').on(t.sourceId),
    index('document_links_target').on(t.targetId),
  ],
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
    /** Vigie change order that opened this revision; those grafted onto it later point to it (change_requests.revision_id). */
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
    /**
     * SHA-256 of the file's bytes (64 lowercase hex), computed as it entered Codex (lib/storage.ts stageFile): the
     * reference the integrity check (lib/integrity-core.mjs) and full downloads compare the stored bytes with, and the
     * key of the duplicate warning. Null for a version without file, or whose file was stored before it was computed
     * until an integrity check establishes it.
     */
    sha256: text('sha256'),
  },
  // Per revision (the key), per document (listRevisions, file route, cascade of a reclassification), per stored file
  // (lib/storage.ts nameStoredFile, lib/orphans.ts), per SHA-256 (duplicate warning).
  (t) => [
    uniqueIndex('working_versions_rev_n').on(t.revisionId, t.n),
    index('working_versions_doc').on(t.docId),
    index('working_versions_file_key').on(t.fileKey),
    index('working_versions_sha256').on(t.sha256),
  ],
);

/** Outcome of a conversion to PDF for the preview (lib/office-preview.ts). */
export type PreviewStatus = 'ready' | 'failed';

/**
 * PDF rendering of an Office file for its preview (point 15 of docs/reste-a-faire.md, M12), made by the conversion
 * service the first time someone may see it (lib/office-preview.ts) and kept in the local store beside the files. Derived
 * data: it can always be made again from the working version's file, so the full export leaves it out (like
 * document_terms); a backup keeps its file; the orphan check counts its key as named. `failed`: the last attempt failed
 * (`error`: timeout, failed, invalid), tried again an hour later at the earliest.
 */
export const versionPreviews = pgTable(
  'version_previews',
  {
    workingVersionId: integer('working_version_id').primaryKey().references(() => workingVersions.id, { onDelete: 'cascade' }),
    status: text('status').$type<PreviewStatus>().notNull(),
    /** Key of the PDF in the local store (`<uuid>-<ID>_<version>.apercu.pdf`); null when the conversion failed. */
    fileKey: text('file_key'),
    size: integer('size'),
    /** Page count of the rendering (lib/storage.ts countPdfPages), shown by the preview's pager. */
    pages: integer('pages'),
    /** SHA-256 of the rendering as it was stored: checked whenever it is served whole. */
    sha256: text('sha256'),
    error: text('error'),
    /** Converter that made it or failed: soffice or gotenberg. */
    converter: text('converter').notNull(),
    at: timestamp('at', { mode: 'string', withTimezone: true }).notNull(),
  },
  (t) => [
    check('version_previews_status', sql`(${t.status} = 'ready' and ${t.fileKey} is not null) or (${t.status} = 'failed' and ${t.fileKey} is null)`),
    index('version_previews_file_key').on(t.fileKey),
  ],
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
    /**
     * Set when the workflow ends: approved; rejected at a step (the revision goes back to draft; also a circuit closed
     * by the withdrawal of its document); recalled by its requester or a records manager before the last approval (the
     * revision goes back to draft).
     */
    outcome: text('outcome').$type<'approved' | 'rejected' | 'recalled'>(),
    /** Who ended the workflow (last approver, rejecting approver, the one who recalled it, Vigie's withdrawal), and the day. */
    closedBy: text('closed_by').references(() => users.id),
    closedAt: date('closed_at', { mode: 'string' }),
    /** Why it was rejected (required) or recalled (optional); also kept in its comments and in the journal. */
    reason: text('reason'),
    createdAt: date('created_at', { mode: 'string' }).notNull(),
  },
  // A revision has one running workflow at most. Per document (lib/actions.ts, lib/lifecycle.ts, cascade of a
  // reclassification) and per revision, finished ones included (lib/queries.ts approvalRecord).
  (t) => [
    uniqueIndex('workflows_running').on(t.revisionId).where(sql`${t.outcome} is null`),
    index('workflows_doc').on(t.docId),
    index('workflows_revision').on(t.revisionId),
  ],
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
  // Steps of one person: the drafting circle of lib/access.ts draftingCircleSql, in every list.
  (t) => [primaryKey({ columns: [t.workflowId, t.idx] }), index('workflow_steps_assignee').on(t.assigneeId)],
);

export const workflowComments = pgTable(
  'workflow_comments',
  {
    id: serial('id').primaryKey(),
    workflowId: text('workflow_id').notNull().references(() => workflows.id),
    authorId: text('author_id').notNull().references(() => users.id),
    at: date('at', { mode: 'string' }).notNull(),
    text: jsonb('text').$type<Localized>().notNull(),
  },
  (t) => [index('workflow_comments_workflow').on(t.workflowId)],
);

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
    /**
     * submitted → accepted / rejected (Vigie decision) → implemented (Codex applied it). An acceptance stays 'accepted'
     * while the document is locked or, for a change, while a revision is already open (lib/lifecycle.ts).
     */
    status: text('status').$type<ChangeStatus>().notNull(),
    ecoRef: text('eco_ref'),
    modifierId: text('modifier_id').references(() => users.id),
    /**
     * Revision an implemented change is carried by: the one it opened, or the one already open it was grafted onto
     * (D-26), which may then carry several change orders. Null for a withdrawal and for a change not applied yet.
     */
    revisionId: integer('revision_id').references(() => revisions.id),
    decisionNote: text('decision_note'),
    /**
     * Withdrawal only: the document proposed to replace this one, readable by the requester when asked. Once the
     * withdrawal applies, it becomes a « remplace » link (lib/lifecycle.ts implementChange). Follows a reclassification.
     */
    replacementId: text('replacement_id').references(docRef, cascade),
    source: text('source').notNull().default('codex'),
    createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
    decidedAt: timestamp('decided_at', { mode: 'string' }),
  },
  (t) => [
    // One pending request per document.
    uniqueIndex('change_requests_pending').on(t.docId).where(sql`${t.status} in ('submitted', 'accepted')`),
    // Every request of a document, decided ones included (lib/queries.ts), and the cascades of a reclassification.
    index('change_requests_doc').on(t.docId),
    index('change_requests_replacement').on(t.replacementId).where(sql`${t.replacementId} is not null`),
    check('change_requests_replacement', sql`${t.replacementId} is null or (${t.kind} = 'obsolescence' and ${t.replacementId} <> ${t.docId})`),
  ],
);

// ── Identifier counters ─────────────────────────────────────────────────

/** Last number handed out per sequence (lib/codification.ts): document IDs per type and context, W-n circuits, ECR references per year. */
export const idCounters = pgTable('id_counters', {
  scope: text('scope').primaryKey(),
  last: integer('last').notNull(),
});

// ── Audit, rights, saved searches ───────────────────────────────────────

/**
 * What an entry without document is about: a cell of the rights matrix, an organisation value, a function, a family or
 * a type of the register, a research programme, an export (target id: 'search' or 'audit' for a CSV, 'full' for the
 * full export of lib/export-core.mjs).
 */
/** 'file': a file refused on its way in (target id: where it came from, lib/storage.ts UploadOrigin). */
/** 'storage': a file store (target id: 'local' or 'sharepoint'), cleaned of its orphan files (lib/orphans.ts). */
/** 'backup': an archive of the database and files (target id: its file name, lib/backup-core.mjs). */
/** 'integrity': a check of the stored files against their SHA-256 (target id: 'files', lib/integrity-core.mjs). */
/** 'user': a person whose holdings were handed to a replacement (target id: their user id, lib/transfer.ts). */
/** 'source_org', 'keyword': a term of a controlled vocabulary (target id: its name at the time, lib/vocab.ts). */
export type AuditTargetKind = 'permission' | 'department' | 'site' | 'function' | 'family' | 'type' | 'program' | 'export' | 'file' | 'storage' | 'backup' | 'integrity' | 'user' | 'source_org' | 'keyword';

/** A value in a journal change, as stored: keys and codes, rendered in the reader's language (lib/queries.ts). */
export type AuditValue = string | string[] | boolean | null | { years: number | null; trigger: string; disposition: string };

/**
 * One change, before → after. `field` names it (a metadata field, a register setting, `granted`, `holder`); `scope`
 * is the scope of a function holder (null: the whole group). Without before and after, the values are withheld from
 * the reader (lib/queries.ts, auditForReader).
 */
export type AuditChange = { field: string; before?: AuditValue; after?: AuditValue; scope?: string | null };

/** Structured part of a journal entry, next to its free `detail`. */
export type AuditData = {
  changes?: AuditChange[];
  /**
   * CSV export: query, facets, period and chosen order of a search export (none for the full journal), rows written,
   * download cut short.
   */
  export?: { q?: string; facets?: Partial<Record<string, string[]>>; period?: SearchPeriod; sort?: string; rows: number; interrupted?: boolean };
  /** Metadata edit: the document's strictest level across the change, and whether a revision was in force. */
  doc?: { conf: Conf; inForce: boolean };
  /**
   * Link added or removed (actions 'link', 'unlink'): this document replaces the other, is replaced by it, or refers to
   * it; the other under its ID at the time. Shown only to who may read that other document (lib/queries.ts, auditForReader).
   * `skipped` (action 'link_skipped'): the replacement proposed with a withdrawal was not linked when it applied, and why.
   */
  link?: { rel: LinkRel; other: string; skipped?: LinkSkip };
  /**
   * File refused by the virus scan (action 'file_rejected'), never stored: its name and size, what the scanner found, the
   * document it was meant for (shown to records managers only, D-14) or the legacy reference of an import.
   */
  file?: { name: string; size: number; threat: string; doc?: string; ref?: string };
  /**
   * Orphan files removed from a store (action 'files_purged', lib/orphans.ts): each one's key, size and last change, the
   * bytes freed, the files that could not be removed. The keys may carry IDs and versions of drafts: shown to records
   * managers only (D-14).
   */
  purge?: { files: { key: string; size: number; touched: string }[]; bytes: number; failed?: number };
  /**
   * An archive written (action 'backup_created': Administration, or npm run backup) or restored ('backup_restored': npm
   * run restore, journaled in the restored database), lib/backup-core.mjs: its name, size and SHA-256 (of the whole
   * file when written), what it holds (documents, local files and their size, files the store lacked, files kept by
   * SharePoint and not archived); for a restore, when the backup was made and whether a database was replaced. Counts
   * only: no document is named; the counts and sizes are shown to records managers only (lib/queries.ts backupL, D-14).
   */
  backup?: {
    archive: string; size: number; sha256?: string; documents: number; files: number; bytes: number; missing: number; sharepoint: number;
    createdAt?: string; replaced?: boolean;
  };
  /**
   * Full export (lib/export-core.mjs, target 'export' 'full'). At its start ('export_full', written in the snapshot the
   * archive is made from): documents, files and their recorded size. At its end ('export_full_end'): the archive's size
   * and SHA-256, the files written, missing from the store, or kept by a store the command line cannot reach; or that
   * it was interrupted (stopped while being sent: sent is not received) or failed, after `size` bytes. Counts only, no document named; shown to
   * records managers only (lib/queries.ts archiveL, D-14).
   */
  archive?: {
    documents?: number; files?: number; bytes?: number; size?: number; sha256?: string; missing?: number; skipped?: number;
    altered?: number; interrupted?: boolean; failed?: boolean;
  };
  /**
   * SHA-256 of the file a working version received (actions 'upload', 'working', 'import'). Kept from readers outside the
   * drafting circle (lib/queries.ts auditForReader, D-14): it would tell a draft's file apart.
   */
  sha256?: string;
  /**
   * Check of the stored files against their recorded SHA-256 (action 'integrity_checked', lib/integrity-core.mjs).
   * `checked`: files read, `bytes`
   * their size; `altered` and `missing`: the working versions concerned (document under its ID at the time, version
   * label), at most INTEGRITY_LIST_MAX of each, `alteredCount`/`missingCount` all of them; `filled`: fingerprints
   * recorded for files stored before they were computed; `skipped`: files kept by a store this process cannot reach.
   * Documents and counts are shown to records managers only (lib/queries.ts integrityL, D-14).
   */
  integrity?: {
    checked: number; bytes: number; altered: IntegrityItem[]; alteredCount: number; missing: IntegrityItem[]; missingCount: number;
    filled: number; skipped: number; by?: 'app' | 'cli'; failed?: boolean;
  };
  /**
   * Holdings of a person handed to a replacement in one operation (action 'transfer_summary', target 'user', lib/transfer.ts):
   * the replacement, what was transferred by kind, what could not be. Counts only, they count drafts: shown to records
   * managers only (lib/queries.ts transferL, D-14). Each object transferred has its own entry (action 'transfer').
   */
  transfer?: { to: string; done: Partial<Record<string, number>>; skipped: number };
};

/** A working version an integrity check names: its row, its document under the ID of the time, its label (A.2). */
export type IntegrityItem = { v: number; doc: string; label: string };

/** Append-only: the database refuses UPDATE, DELETE and TRUNCATE on it (src/db/index.ts). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: serial('id').primaryKey(),
    /** UTC instant, shown in Paris time (lib/format.ts, parisStamp). */
    at: timestamp('at', { mode: 'string', withTimezone: true }).notNull(),
    userId: text('user_id').notNull().references(() => users.id),
    action: text('action').notNull(),
    /** Document under its ID at the time: a later reclassification adds an alias and never rewrites the entry. */
    docId: text('doc_id'),
    /** Target of an entry without document (role:permission, department code, site key, function key, type code, export, file). */
    targetKind: text('target_kind').$type<AuditTargetKind>(),
    targetId: text('target_id'),
    detail: text('detail').notNull().default(''),
    /** Values before → after, export query and size: stored as keys, rendered in the reader's language. */
    data: jsonb('data').$type<AuditData>(),
    /** Revision the entry is about (working version, circuit, entry into force…); null for the document as a whole (lib/access.ts). */
    revisionId: integer('revision_id'),
  },
  // Newest first (Journal tab, export, activity feeds); per document (dates shown outside the drafting circle), and per
  // document, user and action (a user's latest consultation of a document, lib/lifecycle.ts journalConsultation); per
  // user and per action, newest first (filters of the Journal tab, latest integrity check); per revision (approval record).
  (t) => [
    check('audit_log_subject', sql`${t.docId} is not null or (${t.targetKind} is not null and ${t.targetId} is not null)`),
    index('audit_log_at').on(t.at, t.id),
    index('audit_log_doc').on(t.docId, t.userId, t.action, t.at),
    index('audit_log_user').on(t.userId, t.at, t.id),
    index('audit_log_action').on(t.action, t.at, t.id),
    index('audit_log_revision').on(t.revisionId).where(sql`${t.revisionId} is not null`),
  ],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    role: text('role').notNull(),
    perm: text('perm').notNull(),
    granted: boolean('granted').notNull(),
  },
  (t) => [primaryKey({ columns: [t.role, t.perm] })],
);

/**
 * Search criteria (query and facets) saved under a label: never documents, so a saved search shows each person only what
 * they may read (lib/access.ts). Personal: seen by its owner only; department: by the members of `department`; group: by
 * everyone. Only records managers and administrators share (lib/access.ts mayShareSearches). `sort`: display order.
 */
export const savedSearches = pgTable(
  'saved_searches',
  {
    id: serial('id').primaryKey(),
    label: jsonb('label').$type<Localized>().notNull(),
    q: text('q').notNull().default(''),
    facets: jsonb('facets').$type<Record<string, string[]>>().notNull(),
    ownerId: text('owner_id').notNull().references(() => users.id),
    scope: text('scope').$type<SearchScope>().notNull().default('personal'),
    department: text('department').references(() => departments.code),
    /** Period on a date of the documents, null without one. */
    period: jsonb('period').$type<SearchPeriod>(),
    /** Order of the results chosen with the search, null for the default one (lib/search.ts sortOf). */
    orderBy: text('order_by').$type<SearchOrder>(),
    /** Display order in the list of saved searches. */
    sort: integer('sort').notNull().default(0),
  },
  (t) => [
    check('saved_searches_scope', sql`${t.scope} in ('personal', 'department', 'group')`),
    check('saved_searches_order_by', sql`${t.orderBy} in ('relevance', 'modified', 'issued', 'due', 'id', 'title')`),
    // A department-wide search names its department; no other one does.
    check('saved_searches_department', sql`(${t.scope} = 'department') = (${t.department} is not null)`),
  ],
);

// ── Scheduler and integration signatures ────────────────────────────────

/** What a scheduled task's last run came to (lib/scheduler.ts): 'skipped' when it had nothing it could do (busy, not possible here). */
export type SchedulerStatus = 'running' | 'ok' | 'skipped' | 'error';

/**
 * One row per scheduled task (lib/scheduler.ts), shared by every Codex process on the database: the lease that lets one
 * process at a time run it (`leaseOwner` until `leaseUntil`, renewed while it runs; an expired lease is taken over), and
 * what its last run did. A process runs a task only once its last start is at least one interval old, so that several
 * processes on one database do not each run it on their own schedule.
 */
export const schedulerRuns = pgTable('scheduler_runs', {
  task: text('task').primaryKey(),
  leaseOwner: text('lease_owner'),
  leaseUntil: timestamp('lease_until', { mode: 'string', withTimezone: true }),
  startedAt: timestamp('started_at', { mode: 'string', withTimezone: true }),
  finishedAt: timestamp('finished_at', { mode: 'string', withTimezone: true }),
  status: text('status').$type<SchedulerStatus>(),
  /** Figures of the last run (documents put in force, files removed…), never a document's content or a secret. */
  summary: jsonb('summary').$type<Record<string, unknown>>(),
  /** The error of a failed run, as the technical log keeps it (message only). */
  error: text('error'),
  /** When the process that ran it last plans the next run: start + interval. */
  nextAt: timestamp('next_at', { mode: 'string', withTimezone: true }),
});

/**
 * Signed integration requests already accepted (lib/server-auth.ts), kept until their timestamp leaves the window: the
 * same signature sent again within it is refused as a replay, whichever Codex process receives it. `digest`: SHA-256 of
 * the endpoint, timestamp and signature, never the secret or the body.
 */
export const integrationSignatures = pgTable(
  'integration_signatures',
  {
    digest: text('digest').primaryKey(),
    endpoint: text('endpoint').notNull(),
    expiresAt: timestamp('expires_at', { mode: 'string', withTimezone: true }).notNull(),
  },
  (t) => [index('integration_signatures_expires').on(t.expiresAt)],
);
