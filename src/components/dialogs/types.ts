import type { Attachment, Conf, Origin } from '@/db/schema';

export type Option = { key: string; label: string };

/** Reference data the dialogs need, loaded once by the root layout (src/app/layout.tsx). */
export type DialogData = {
  /** Template documents in force (type FRM, context QMS). */
  templates: { id: string; label: string; rev: string; owner: string }[];
  /** Register of document types. Inactive ones are only offered to documents that already have them. */
  types: {
    code: string; label: string; family: string; familyLabel: string; origins: Origin[]; attachments: Attachment[];
    subtypes: string[]; confAllowed: Conf[]; confDefault: Conf; circuitL: string; active: boolean;
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
  /** Change request (ECR) or withdrawal request, both sent to Vigie. */
  | { kind: 'change'; docId: string; title: string; change: 'modification' | 'obsolescence' }
  /** Hand the current step on: `step` is the step shown, `excluded` the people who may not approve this revision. */
  | { kind: 'delegate'; workflowId: string; stepName: string; step: number; excluded: string[] }
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
  /** Administration: circuit, confidentiality and retention of a type. */
  | { kind: 'type'; type: { code: string; label: string; circuit: string[]; confAllowed: Conf[]; confDefault: Conf; retentionYears: number | null; retentionTrigger: string; retentionDisposition: string; retentionBasis: string; active: boolean } }
  | { kind: 'holder'; functionKey: string; functionLabel: string; scope: 'global' | 'department' | 'project' | 'research' }
  | { kind: 'org'; what: 'department' | 'site' };
