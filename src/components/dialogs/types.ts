import type { Attachment, Conf, Origin } from '@/db/schema';
import type { Search } from '@/lib/search';

export type Option = { key: string; label: string };

/** Reference data the dialogs need, loaded once by the root layout (src/app/layout.tsx). */
export type DialogData = {
  /** Template documents in force (type FRM, context QMS). */
  templates: { id: string; label: string; rev: string; owner: string }[];
  /** Register of document types. Inactive ones are only offered to documents that already have them. */
  types: {
    code: string; label: string; family: string; familyLabel: string; origins: Origin[]; attachments: Attachment[];
    subtypes: string[]; confAllowed: Conf[]; confDefault: Conf; circuitL: string; active: boolean;
    /** Periodic review in months, null without one (lib/review.ts). */
    reviewMonths: number | null;
  }[];
  families: Option[];
  departments: Option[];
  sites: Option[];
  projects: Option[];
  programs: Option[];
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
};

/** Every editable metadata field of a document (edit dialog). */
export type MetaDoc = {
  id: string; title: string; typeCode: string; subtype: string | null; origin: Origin; attachment: Attachment;
  projectCode: string | null; programCode: string | null; department: string; site: string | null; ownerId: string;
  authorText: string | null; conf: Conf; keywords: string[]; lang: string | null; reviewDueAt: string | null; expiresAt: string | null;
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
};

/** A working version or revision file, for the compare dialog. */
export type VersionLite = { id: number; label: string; author: string; dateF: string; commentL: string; sizeF: string; pages: number | null; fileName: string | null };

export type DialogSpec =
  /**
   * New document (codified): from a template, from a file, or without a file yet (`mode` picks the initial content).
   * Preset when filing a piece Keystone expects.
   */
  | { kind: 'new'; preset?: { mode?: 'template' | 'file' | 'blank'; projectCode?: string; expectedId?: number; typeCode?: string; title?: string; label?: string; templateId?: string } }
  | { kind: 'notes' }
  | { kind: 'user' }
  /** Next working version (e.g. B.3) of the revision being drafted. */
  | { kind: 'working'; docId: string; nextLabel: string }
  | { kind: 'meta'; doc: MetaDoc }
  /** Request approval of the revision being drafted, with an optional effective date (`minDate`: today, Paris time). */
  | { kind: 'validate'; docId: string; title: string; revLabel: string; circuitL: string; minDate: string }
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
  /**
   * End a running circuit, the revision going back to drafting: reject the current step, with a reason (required), or
   * recall the request, with an optional one. `step` is the step shown: the circuit may have moved on since.
   */
  | { kind: 'reject' | 'recall'; workflowId: string; step: number; stepName: string; docId: string; title: string; letter: string }
  | { kind: 'compare'; current: VersionLite; other: VersionLite }
  /** Named readers of a confidential or "très confidentiel" document. */
  | { kind: 'readers'; docId: string; readers: string[] }
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
  /** Administration: circuit, confidentiality, retention and periodic review of a type. */
  | { kind: 'type'; type: { code: string; label: string; circuit: string[]; confAllowed: Conf[]; confDefault: Conf; retentionYears: number | null; retentionTrigger: string; retentionDisposition: string; retentionBasis: string; reviewMonths: number | null; active: boolean } }
  | { kind: 'holder'; functionKey: string; functionLabel: string; scope: 'global' | 'department' | 'project' | 'research' }
  | { kind: 'org'; what: 'department' | 'site' }
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
