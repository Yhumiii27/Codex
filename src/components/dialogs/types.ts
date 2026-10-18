import type { Attachment, Conf, Origin } from '@/db/schema';
import type { FileRules } from '@/lib/filetypes';
import type { Search } from '@/lib/search';

export type Option = { key: string; label: string };

/** Every setting of a register type, as the type dialog edits it; `used`: see DialogSpec 'type'. */
export type TypeSettings = {
  code: string; labelFr: string; labelEn: string; family: string; origins: Origin[]; attachments: Attachment[]; subtypes: { fr: string; en: string }[];
  circuit: string[]; confAllowed: Conf[]; confDefault: Conf; retentionYears: number | null; retentionTrigger: string; retentionDisposition: string;
  retentionBasis: string; reviewMonths: number | null; iso: string | null; clientDeliverable: boolean; active: boolean; used: boolean;
  /**
   * Retention classes of its documents (lib/queries.ts retentionByType): how many a change of its rule would reach when
   * applied to those that follow it, and how many derogations it leaves as they are.
   */
  retention?: RetentionByType;
};

export type RetentionByType = { following: { retentionYears: number | null; retentionTrigger: string; retentionDisposition: string; held: boolean; n: number }[]; overrides: number };

/** Reference data the dialogs need, loaded once by the root layout (src/app/layout.tsx). */
export type DialogData = {
  /** Template documents in force (type FRM, context QMS); `types`: those it is meant for, offered first for them. */
  templates: { id: string; label: string; rev: string; owner: string; types: string[] }[];
  /** Register of document types. Inactive ones are only offered to documents that already have them. */
  types: {
    code: string; label: string; family: string; familyLabel: string; origins: Origin[]; attachments: Attachment[];
    subtypes: string[]; confAllowed: Conf[]; confDefault: Conf; circuitL: string; active: boolean;
    /** Periodic review in months, null without one (lib/review.ts). */
    reviewMonths: number | null;
  }[];
  families: Option[];
  /**
   * Departments and sites; an inactive one is only offered where it is already set (lib/org-rules.ts offered), and an
   * inactive department, marked, to a new holder of a department-scoped function (markInactive).
   */
  departments: (Option & { active: boolean })[];
  sites: (Option & { active: boolean })[];
  projects: Option[];
  /** Research programmes; an inactive (closed) one is only offered to a document that already has it. */
  programs: (Option & { active: boolean })[];
  confs: Option[];
  /** People of the group; `approver`: their default role may approve (function holders, delegation targets). */
  users: { id: string; name: string; initials: string; role: string; department: string | null; approver: boolean }[];
  functions: { key: string; label: string; scope: 'global' | 'department' | 'project' | 'research' }[];
  currentUserId: string;
  currentRole: string;
  currentDepartment: string | null;
  perms: string[];
  /** Records manager (sees every document, simulates Vigie decisions). */
  seesAll: boolean;
  /** Formats and size admitted on upload (lib/filetypes.ts), checked by the file picker before sending; the server decides. */
  files: FileRules;
  /** Terms of the controlled vocabularies the forms offer (lib/queries.ts vocabSuggestions, D-14). */
  vocab: { sourceOrgs: string[]; keywords: string[] };
};

/** Every editable metadata field of a document (edit dialog). */
export type MetaDoc = {
  id: string; title: string; typeCode: string; subtype: string | null; origin: Origin; attachment: Attachment;
  projectCode: string | null; programCode: string | null; department: string; site: string | null; ownerId: string;
  /** The author: a person, or a free text (external author); both null for a record migrated without one (shows the owner). */
  authorId: string | null; authorText: string | null; conf: Conf; keywords: string[]; lang: string | null; reviewDueAt: string | null; expiresAt: string | null;
  sourceOrg: string | null; externalRef: string | null; receivedAt: string | null;
  projectPhase: string | null; workPackage: string | null; discipline: string | null;
  researchTheme: string | null; studyId: string | null; ipStatus: string | null; processOwnerId: string | null;
  /** False once a revision has been approved: the ID no longer changes. */
  idMayChange: boolean;
  /**
   * A revision is in force: a review date emptied here is not recomputed (only an entry into force applies the type's
   * periodicity, lib/lifecycle.ts putInForce), the dialog says so.
   */
  inForce: boolean;
  /** An approval workflow is running: type and context (which resolved its approvers) cannot change. */
  classificationLocked: boolean;
  /**
   * Version of the record shown (documents.version), sent back to detect a change since (lib/concurrency.ts); 0 for
   * whoever may not edit it, outside the drafting circle (D-14).
   */
  version: number;
};

/** A working version or revision file, for the compare dialog. */
/** `sha256`: of its file, as recorded when it entered Codex (null without file, or stored before it was computed). */
export type VersionLite = { id: number; label: string; author: string; dateF: string; commentL: string; sizeF: string; pages: number | null; fileName: string | null; sha256: string | null };

export type DialogSpec =
  /**
   * New document (codified): from a template, from a file, or without a file yet (`mode` picks the initial content).
   * Preset when filing a piece Keystone expects.
   */
  | { kind: 'new'; preset?: { mode?: 'template' | 'file' | 'blank'; projectCode?: string; expectedId?: number; typeCode?: string; title?: string; label?: string; templateId?: string } }
  | { kind: 'notes' }
  | { kind: 'user' }
  /**
   * Next working version (e.g. B.3) of the revision being drafted. `base`: that revision and the number of the last
   * working version shown (0 before the first), sent back so that one uploaded since is not passed over.
   */
  | { kind: 'working'; docId: string; nextLabel: string; base: { revisionId: number; n: number } }
  | { kind: 'meta'; doc: MetaDoc }
  /**
   * Request approval of the revision being drafted, with an optional effective date (`minDate`: today, Paris time).
   * `base`: as for an upload, the last working version shown, so that the circuit does not start on one uploaded since.
   */
  | { kind: 'validate'; docId: string; title: string; revLabel: string; circuitL: string; minDate: string; base: { revisionId: number; n: number } }
  /**
   * Change request (ECR) or withdrawal request, both sent to Vigie. `openRev`: for a change asked while a revision is
   * open, that revision and its status (an accepted change waits for its entry into force, or may be grafted onto it
   * while it is drafted, D-26); given to the drafting circle only (lib/access.ts openRevisionView, D-14).
   * `replacements`: for a withdrawal, the documents that may be proposed to replace this one (active, readable by the
   * user, lib/links.ts replacementIssue).
   */
  | { kind: 'change'; docId: string; title: string; change: 'modification' | 'obsolescence'; openRev?: { letter: string; status: 'draft' | 'in_review' | 'approved' }; replacements?: Option[] }
  /**
   * Link the document to another one (lib/actions.ts addDocLink): `withdrawn`, whether Vigie withdrew it (only then is
   * it « remplacé par »); `active`, neither obsolete nor archived (only then does it replace another); `candidates`, the
   * documents the user may read and has the link rights on, each with the same flags.
   */
  | { kind: 'link'; docId: string; title: string; withdrawn: boolean; active: boolean; candidates: (Option & { withdrawn: boolean; active: boolean })[] }
  /** Hand the current step on: `step` is the step shown, `excluded` the people who may not approve this revision. */
  | { kind: 'delegate'; workflowId: string; stepName: string; step: number; excluded: string[] }
  /** A records manager hands on the current step held by someone else (`holder`), with the rules of a delegation. */
  | { kind: 'reassign'; workflowId: string; stepName: string; step: number; excluded: string[]; holder: string; holderName: string }
  /** A term of a controlled vocabulary: added (no `term`) or renamed. */
  | { kind: 'vocabTerm'; vocab: 'source_org' | 'keyword'; term?: { id: number; name: string } }
  /** Merges a duplicate term (`from`) into another of the same vocabulary, chosen among `others`. */
  | { kind: 'vocabMerge'; vocab: 'source_org' | 'keyword'; from: { id: number; name: string }; others: { id: number; name: string }[] }
  /**
   * End a running circuit, the revision going back to drafting: reject the current step, with a reason (required), or
   * recall the request, with an optional one. `step` is the step shown: the circuit may have moved on since.
   */
  | { kind: 'reject' | 'recall'; workflowId: string; step: number; stepName: string; docId: string; title: string; letter: string }
  /** Compares the attributes and the text (GET /api/documents/[id]/compare) of two versions of `docId`. */
  | { kind: 'compare'; docId: string; current: VersionLite; other: VersionLite }
  /** Named readers of a confidential or "très confidentiel" document; `version`: of the record shown (lib/concurrency.ts). */
  | { kind: 'readers'; docId: string; readers: string[]; version: number }
  /** Types a template is meant for (lib/actions.ts setTemplateTypes); `version`: of the record shown. */
  | { kind: 'templateTypes'; docId: string; title: string; types: string[]; version: number }
  /**
   * Records manager simulating Vigie's decision on a change request. `modifierId`: the author proposed by default;
   * `drafters`: the people who may draft the document, the only ones offered as author; `deferred`: that an acceptance
   * will be recorded without applying at once, and what it will wait for: the lock of an archived, obsolete or frozen
   * document to lift, then, for a change, the revision already open to enter into force or be cancelled (D-26). An
   * acceptance is never refused for a revision already open.
   */
  | { kind: 'vigie'; requestId: string; docTitle: string; change: 'modification' | 'obsolescence'; modifierId: string; drafters: string[]; deferred?: string }
  /**
   * Graft a change Vigie accepted onto the revision being drafted, instead of waiting for it to enter into force (D-26).
   * `author`: who writes that revision, and the change once grafted; `vigieModifier`: the author Vigie named, when it is
   * someone else.
   */
  | { kind: 'graft'; requestId: string; ecoRef: string; docId: string; title: string; letter: string; reason: string; author: string; vigieModifier?: string }
  /**
   * Record the periodic review of the revision in force (lib/actions.ts recordReview): `reviewDueAt`, the date it was
   * due; `months`, the type's periodicity that sets the next date when none is entered; `minDate`, the earliest one
   * (tomorrow, Paris time).
   */
  | { kind: 'review'; docId: string; title: string; letter: string; reviewDueAt: string | null; months: number | null; minDate: string }
  /**
   * Date of the event a document's retention counts from (end of life of the asset, departure of the employee: lib/actions.ts
   * setRetentionEvent): `eventAt`, the one entered; `triggerL`, the trigger; `maxDate`, today (Paris time); `version`, of
   * the record shown.
   */
  | { kind: 'retentionEvent'; docId: string; title: string; triggerL: string; eventAt: string | null; maxDate: string; version: number }
  /**
   * Retention class of one document (lib/actions.ts setRetentionClass): its class, whether it is a derogation, and its
   * type's rule, which « Revenir à la règle du type » puts back. `version`: of the record shown.
   */
  | {
    kind: 'retentionClass'; docId: string; title: string; version: number; override: boolean;
    current: { retentionYears: number | null; retentionTrigger: string; retentionDisposition: string };
    type: { code: string; retentionYears: number | null; retentionTrigger: string; retentionDisposition: string };
  }
  /**
   * Administration › Registre des types: a new type (`family`: the family the register is filtered on, preset), or every
   * setting of one (lib/actions.ts createType, updateType). `used`: documents or projects refer to it, so its code no
   * longer changes and it cannot be deleted, only made inactive.
   */
  | { kind: 'type'; type?: TypeSettings; family?: string }
  /** A family of types (lib/actions.ts createFamily, updateFamily); `used`: types or documents have it. */
  | { kind: 'family'; family?: { key: string; labelFr: string; labelEn: string; grp: string; used: boolean } }
  /**
   * A function circuits are made of (lib/actions.ts createFunction, updateFunction); `used`: a circuit, a holder or a
   * started circuit refers to it; `held`: it has holders, so its scope does not change.
   */
  | { kind: 'function'; fn?: { key: string; labelFr: string; labelEn: string; scope: 'global' | 'department' | 'project' | 'research'; used: boolean; held: boolean } }
  /** A research programme (lib/actions.ts createProgram, updateProgram); `used`: documents or holders have it. */
  | { kind: 'program'; program?: { code: string; name: string; managerId: string; active: boolean; used: boolean } }
  | { kind: 'holder'; functionKey: string; functionLabel: string; scope: 'global' | 'department' | 'project' | 'research' }
  /**
   * Administration › Organisation: a new department or site, or one to rename, make inactive or active again, or delete
   * (lib/actions.ts addOrgValue, updateOrgValue, deleteOrgValue). `value.id`: the department's code or the site's key,
   * which never change; `used`: something refers to it (lib/queries.ts orgUsage), so it is made inactive, not deleted.
   */
  | { kind: 'org'; what: 'department' | 'site'; value?: { id: string; labelFr: string; labelEn: string; active: boolean; used: boolean } }
  /**
   * Administration › Organisation: facets the page of a department puts forward (lib/actions.ts setDepartmentFeatured).
   * `featured`: those it puts forward now; `isDefault`: they are the default ones, the department has none of its own.
   */
  | { kind: 'featured'; department: { code: string; label: string }; featured: string[]; isDefault: boolean }
  /**
   * Save the criteria of /recherche and the order of its results under a label (lib/actions.ts saveSearch). `search`: as
   * read from the URL (lib/search.ts parseSearch); `criteria`: the same, as lines to read; `mayShare`: the user may share
   * it with a department or the group (lib/access.ts mayShareSearches).
   */
  | { kind: 'saveSearch'; search: Search; criteria: string[]; mayShare: boolean };
