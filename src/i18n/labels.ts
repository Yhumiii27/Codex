// Labels of the values Codex stores (a status, a level, a kind…), as English source strings (Norma § 2, CX-N01): a screen
// shows one with `labelOf(tr, STATUS_LABEL, doc.status)`, translated by fr.ts like any other source. They replace the
// keys built from a prefix in the former keyed dictionary.

import { msg, type Translate } from '@/i18n';
import type { DateRule } from '@/lib/dates';
import type { ChangeDecisionError, LockKey } from '@/lib/lifecycle';
import type { LinkIssue, ReplacementIssue } from '@/lib/links';
import type { EventDateIssue } from '@/lib/retention';
import type { NextReviewError } from '@/lib/review';
import type { TermIssue } from '@/lib/vocab-rules';

/** The label of `key` in `table`, translated; the key itself when the table does not know it (a value from elsewhere). */
export function labelOf(tr: Translate, table: Readonly<Record<string, string>>, key: string | null | undefined): string {
  if (key == null) return '';
  return Object.hasOwn(table, key) ? tr(table[key]) : key;
}

/** Origins of a document (ORIGINS). */
export const ORIGIN_LABEL: Readonly<Record<string, string>> = {
  interne: msg('Internal'),
  externe: msg('External'),
};

/** Attachments of a document (ATTACHMENTS). */
export const ATTACHMENT_LABEL: Readonly<Record<string, string>> = {
  none: msg('None'),
  project: msg('Project'),
  research: msg('Research'),
  capex: msg('CAPEX'),
};

/** Statuses of a document or a revision, and states of a workflow step. */
export const STATUS_LABEL: Readonly<Record<string, string>> = {
  done: msg('Done'),
  current: msg('In progress'),
  todo: msg('Upcoming'),
  draft: msg('Draft'),
  archived: msg('Archived'),
  in_review: msg('In review'),
  approved: msg('Approved'),
  in_force: msg('In force'),
  superseded: msg('Superseded'),
  obsolete: msg('Obsolete'),
  cancelled: msg('Cancelled'),
};

/** Confidentiality levels (CONF_LEVELS). */
export const CONF_LABEL: Readonly<Record<string, string>> = {
  public: msg('Public'),
  restreint: msg('Restricted'),
  interne: msg('Internal'),
  confidentiel: msg('Confidential'),
  tres_confidentiel: msg('Highly confidential'),
};

/** Events that start a retention period. */
export const TRIGGER_LABEL: Readonly<Record<string, string>> = {
  creation: msg('Creation'),
  in_force: msg('Entry into force'),
  superseded: msg('Document withdrawal or archiving'),
  project_end: msg('Project end'),
  contract_end: msg('Contract end'),
  fiscal_year_end: msg('Fiscal year close'),
  expiry: msg('Expiry'),
  asset_life: msg('Asset life'),
  employee_departure: msg('Employee departure'),
  permanent: msg('Permanent'),
};

/** What happens at the end of a retention period. */
export const DISPOSITION_LABEL: Readonly<Record<string, string>> = {
  destroy: msg('Destruction'),
  review: msg('Review'),
  archive: msg('Archive#disposition'),
  permanent: msg('Permanent retention'),
};

/** Kinds of a change request sent to Vigie. */
export const CHANGE_KIND_LABEL: Readonly<Record<string, string>> = {
  modification: msg('Change'),
  obsolescence: msg('Withdrawal (obsolete)'),
};

/** Statuses of a change request sent to Vigie. */
export const CHANGE_STATUS_LABEL: Readonly<Record<string, string>> = {
  submitted: msg('Sent to Vigie'),
  accepted: msg('Accepted'),
  rejected: msg('Rejected#request'),
  implemented: msg('Applied'),
};

/** Relations between two documents. */
export const LINK_LABEL: Readonly<Record<string, string>> = {
  replaces: msg('Replaces'),
  replaced_by: msg('Replaced by'),
  see_also: msg('See also'),
};

/** Action proposed at a retention or review deadline. */
export const PROPOSED_ACTION_LABEL: Readonly<Record<string, string>> = {
  renew: msg('Renew'),
  review: msg('Review#proposed'),
  archive: msg('Archive'),
  destroy: msg('Destroy'),
};

/** Permissions of the matrix (PERMS). */
export const PERM_LABEL: Readonly<Record<string, string>> = {
  read: msg('Read'),
  upload: msg('Upload'),
  edit: msg('Edit#permission'),
  approve: msg('Approve#permission'),
  publish: msg('Publish'),
  archive: msg('Archive'),
  destroy: msg('Destroy'),
  admin: msg('Administer'),
};

/** How a file entered Codex (audit trail). */
export const FILE_ENTRY_LABEL: Readonly<Record<string, string>> = {
  create: msg('new document'),
  template: msg('copy of a template'),
  working: msg('working version'),
  import: msg('import'),
};

/** Where the files are stored (audit trail). */
export const STORAGE_LABEL: Readonly<Record<string, string>> = {
  local: msg('local'),
  sharepoint: msg('SharePoint'),
};

/** Why a link was not made. */
export const LINK_SKIP_LABEL: Readonly<Record<string, string>> = {
  inactive: msg('document obsolete, archived or not found'),
  hold: msg('legal hold'),
  linked: msg('already linked the other way'),
};

/** What a transfer of holdings moves. */
export const TRANSFER_KIND_LABEL: Readonly<Record<string, string>> = {
  owner: msg('Document ownership'),
  process_owner: msg('Process ownership'),
  reader: msg('Named reader'),
  modifier: msg('Designated author of open revisions'),
  step: msg('Pending approval steps'),
  holder: msg('Function holderships'),
};

/** Entries of the audit trail and of a record’s activity. */
export const ACTIVITY_LABEL: Readonly<Record<string, string>> = {
  upload: msg('Upload#activity'),
  edit: msg('Edit'),
  request: msg('Approval request'),
  sign: msg('Signed'),
  download: msg('Download#activity'),
  consult: msg('Record opened'),
  view: msg('File viewed'),
  approve: msg('Approved#activity'),
  archive: msg('Archived#activity'),
  reject: msg('Rejected#activity'),
  delegate: msg('Delegated'),
  hold: msg('Legal hold'),
  restore: msg('Restored'),
  graft: msg('Change grafted'),
  ecr: msg('Change request'),
  obsolete: msg('Withdrawal'),
  import: msg('Import'),
  in_force: msg('Entry into force'),
  reclass: msg('Reclassification'),
  working: msg('Working version'),
  release: msg('Hold released'),
  perm: msg('Permission changed'),
  org_add: msg('Organisation value added'),
  holder_add: msg('Holder added'),
  holder_remove: msg('Holder removed'),
  type: msg('Type changed'),
  comment: msg('Comment'),
  export: msg('CSV export'),
  recall: msg('Approval request recalled'),
  dept_featured: msg('Featured filters changed'),
  reviewed: msg('Review done'),
  review_planned: msg('Next review set'),
  link: msg('Link added'),
  unlink: msg('Link removed'),
  link_skipped: msg('Replacement not applied'),
  visa: msg('Approval record issued'),
  file_rejected: msg('File refused (virus scan)'),
  destroy: msg('Destroyed'),
  files_purged: msg('Orphan files removed'),
  files_renamed: msg('Files renamed'),
  backup_created: msg('Backup created'),
  backup_restored: msg('Database restored'),
  files_restored: msg('Files put back'),
  export_full: msg('Full export'),
  export_full_end: msg('Full export sent'),
  integrity_checked: msg('Integrity check'),
  file_altered: msg('Altered file detected'),
  type_add: msg('Type added'),
  type_remove: msg('Type deleted'),
  family_add: msg('Family added'),
  family: msg('Family changed'),
  family_remove: msg('Family deleted'),
  function_add: msg('Function added'),
  function: msg('Function changed'),
  function_remove: msg('Function deleted'),
  program_add: msg('Programme added'),
  program: msg('Programme changed'),
  program_remove: msg('Programme deleted'),
  org_edit: msg('Organisation value changed'),
  org_remove: msg('Organisation value deleted'),
  retention: msg('Retention class changed'),
  retention_type: msg('Type rule applied'),
  retention_event: msg('Retention event date'),
  retention_applied: msg('Retention rule applied to documents'),
  transfer: msg('Handover (departure)'),
  transfer_summary: msg('Responsibilities handed over'),
  reassign: msg('Step reassigned'),
  vocab_add: msg('Term added to the vocabulary'),
  vocab_rename: msg('Term renamed'),
  vocab_merge: msg('Terms merged'),
  vocab_apply: msg('Vocabulary term applied'),
};

/** Simulated roles (SIM_ROLES). */
export const ROLE_LABEL: Readonly<Record<string, string>> = {
  collaborateur: msg('Employee'),
  validateur: msg('Approving manager'),
  auditeur: msg('Audit & compliance'),
  gestionnaire: msg('Records manager'),
};

/** State of the revision already open, in a change request. */
export const OPEN_REVISION_LABEL: Readonly<Record<string, string>> = {
  draft: msg('being drafted'),
  in_review: msg('under review'),
  approved: msg('approved, waiting for its effective date'),
};

/** Why a version could not be compared. */
export const COMPARE_FAILURE_LABEL: Readonly<Record<string, string>> = {
  unsupported: msg('{label}: format not supported for the text comparison (PDF, Word, Excel, PowerPoint, OpenDocument and text).'),
  too_large: msg('{label}: file too large to extract its text.'),
  timeout: msg('{label}: text extraction took too long and was stopped.'),
  unreadable: msg('{label}: text cannot be read (damaged file or unexpected structure).'),
  encrypted: msg('{label}: file protected by a password.'),
  empty: msg('{label}: no text found (scanned document without a text layer?).'),
  no_file: msg('{label}: no file for this version.'),
  unavailable: msg('{label}: file not found in the store.'),
  altered: msg('{label}: file altered (SHA-256 fingerprint differs from the one recorded at upload), not compared.'),
};

/** Scopes of a function. */
export const FUNCTION_SCOPE_LABEL: Readonly<Record<string, string>> = {
  global: msg('Group'),
  department: msg('Per department'),
  project: msg('Per project'),
  research: msg('Per programme'),
};

/** Groups of document families. */
export const FAMILY_GROUP_LABEL: Readonly<Record<string, string>> = {
  DI: msg('DI · Internal'),
  DE: msg('DE · External'),
  DP: msg('DP · Project'),
  DR: msg('DR · Research'),
};

/** Who sees a saved search (SEARCH_SCOPES). */
export const SEARCH_SCOPE_LABEL: Readonly<Record<string, string>> = {
  personal: msg('Only you'),
  department: msg('A department'),
  group: msg('The whole group'),
};

/** Screens a help topic leads to. */
export const SCREEN_LABEL: Readonly<Record<string, string>> = {
  home: msg('Home'),
  explorer: msg('Browse'),
  search: msg('Search'),
  workflow: msg('Approvals'),
  admin: msg('Administration'),
};

/** Why an item of a transfer is not moved. */
export const TRANSFER_REASON_LABEL: Readonly<Record<string, string>> = {
  owner_approves: msg('the replacement approves the revision in progress: they would judge their own revision. Reassign their step first.'),
  modifier_approves: msg('the replacement approves this revision: they cannot also be its author. Reassign their step first.'),
  self_approval: msg('the replacement is set apart from this workflow (requester, author of the revision or of a working version).'),
  cannot_approve: msg('the replacement’s default role cannot approve.'),
  cannot_draft: msg('the replacement’s default role cannot upload.'),
  cannot_read: msg('the replacement cannot read this document.'),
  locked_hold: msg('document under legal hold: its workflow is frozen until the hold is lifted.'),
  locked_archived: msg('archived document: its workflow is frozen.'),
  locked_obsolete: msg('obsolete document: its workflow is frozen.'),
};

/** Why a scheduled task was skipped. */
export const SCHEDULE_REASON_LABEL: Readonly<Record<string, string>> = {
  busy: msg('already running'),
  no_source: msg('view arche.pub_capex not readable (link to be granted by Matrix)'),
  server: msg('PostgreSQL database: to be backed up by its own tools'),
  recent: msg('backup less than 15 minutes old'),
};

/** Scheduled tasks. */
export const SCHEDULE_TASK_LABEL: Readonly<Record<string, string>> = {
  promote: msg('Deferred entry into force and pending decisions'),
  capex: msg('CAPEX published by Arche'),
  orphans: msg('Removal of orphan files'),
  renames: msg('Rename of files left under a provisional name'),
  integrity: msg('Integrity check'),
  backup: msg('Backup'),
  export: msg('Full export'),
};

/** States of a scheduled task run. */
export const SCHEDULE_STATUS_LABEL: Readonly<Record<string, string>> = {
  ok: msg('done'),
  skipped: msg('skipped'),
  error: msg('failed'),
  running: msg('running'),
};

/** Tabs of the archiving screen. */
export const RETENTION_TAB_LABEL: Readonly<Record<string, string>> = {
  due: msg('Deadlines'),
  rules: msg('Retention rules'),
  archives: msg('Archives'),
  events: msg('Event dates'),
};

/** Kinds of deadline (archiving screen). */
export const DUE_KIND_LABEL: Readonly<Record<string, string>> = {
  retention: msg('Retention'),
  expiry: msg('Expiry'),
  review: msg('Periodic review'),
};

/** Status filters of the lists. */
export const FILTER_LABEL: Readonly<Record<string, string>> = {
  all: msg('All'),
  draft: msg('Drafts'),
  archived: msg('Archived#filter'),
  in_force: msg('In force'),
  in_review: msg('In review'),
  obsolete: msg('Obsolete#filter'),
  expired: msg('Expired'),
  review_late: msg('Reviews overdue'),
};

/** Tabs of a document record (the others are named where they are drawn). */
export const RECORD_TAB_LABEL: Readonly<Record<string, string>> = {
  meta: msg('Record'),
  approval: msg('Approval'),
  history: msg('History'),
};

/** Views of a record’s history. */
export const HISTORY_LABEL: Readonly<Record<string, string>> = {
  activity: msg('Activity'),
  metadata: msg('Metadata'),
  consultations: msg('Consultations'),
};

/** Rows of the permission matrix (MATRIX_ROLES). */
export const MATRIX_ROLE_LABEL: Readonly<Record<string, string>> = {
  lecteur: msg('Reader'),
  contributeur: msg('Contributor'),
  gestionnaire: msg('Records manager'),
  validateur: msg('Approver'),
  auditeur: msg('Auditor'),
  administrateur: msg('Administrator'),
};

/** Languages of a document. */
export const LANGUAGE_LABEL: Readonly<Record<string, string>> = {
  fr: msg('French'),
  en: msg('English'),
};

/** Values of the « past due » facet of the search (OVERDUE_KEYS). */
export const OVERDUE_LABEL: Readonly<Record<string, string>> = {
  expired: msg('Expired#indicator'),
  review: msg('Review overdue'),
};

/** Why a document cannot be changed (lib/lifecycle.ts lockOf). */
export const LOCK_LABEL: Readonly<Record<LockKey, string>> = {
  locked_archived: msg('Archived document: it cannot be changed.'),
  locked_obsolete: msg('Obsolete document: it cannot be changed.'),
  locked_hold: msg('Document under legal hold: it cannot be changed.'),
};

/** Why the next review date entered is refused (lib/review.ts nextReviewDate). */
export const NEXT_REVIEW_ERROR_LABEL: Readonly<Record<NextReviewError, string>> = {
  date_malformed: msg('invalid date, enter a calendar day (YYYY-MM-DD).'),
  review_next_past: msg('The next review must come after today.'),
  review_next_required: msg('Enter the next review date: the document type has no review periodicity.'),
};

/** Why a link or a proposed replacement is refused (lib/links.ts linkIssue, replacementIssue). */
export const LINK_ISSUE_LABEL: Readonly<Record<LinkIssue | ReplacementIssue, string>> = {
  link_self: msg('A document cannot be linked to itself.'),
  link_exists: msg('These two documents are already linked.'),
  link_not_withdrawn: msg('Only a document Vigie withdrew (obsolete) can be replaced. For a document in force, send a withdrawal request naming its replacement.'),
  link_replacer_inactive: msg('The replacing document must be active: an obsolete or archived document replaces nothing.'),
  replacement_not_found: msg('Replacement document not found.'),
  replacement_inactive: msg('The replacement document is obsolete or archived: propose an active document.'),
};

/** Why Vigie's decision could not be applied (lib/lifecycle.ts applyChangeDecision). */
export const CHANGE_DECISION_ERROR_LABEL: Readonly<Record<ChangeDecisionError, string>> = {
  not_found: msg('Document not found.'),
  modifier_not_allowed: msg('The designated author cannot draft this document (upload permission of their role, access to the document)'),
};

/** A date that breaks a rule (lib/dates.ts): {date} is the date it conflicts with, {rev} the revision. */
export const DATE_RULE_LABEL: Readonly<Record<DateRule, string>> = {
  expires_before_issued: msg('The expiry date must be after the document’s issue date ({date}): choose a later date.'),
  expires_before_effective: msg('The expiry date must be after the effective date of revision {rev} ({date}): choose a later date.'),
  expires_before_approval: msg('Revision {rev}, under approval, will take effect when approved, on {date} at the earliest: choose a later expiry date.'),
  expires_before_first_issue: msg('The document is not issued yet; it will be on {date} at the earliest: choose a later expiry date.'),
  effective_before_issued: msg('Revision {rev} cannot enter into force before the document’s issue date ({date}), which is its first entry into force: correct one of the two dates.'),
  review_before_issued: msg('The review date must be after the document’s issue date ({date}): choose a later date.'),
  review_before_first_issue: msg('The document is not issued yet; it will be on {date} at the earliest: choose a later review date.'),
  received_in_future: msg('The received date cannot be in the future: choose today or an earlier date.'),
  received_after_issued: msg('The received date cannot be after the document’s issue date ({date}): choose that date or an earlier one.'),
  effective_after_expiry: msg('The effective date must come before the document expires on {date}: choose an earlier date; otherwise, the expiry date must first be moved in the metadata, by the document’s owner or a records manager.'),
  approval_after_expiry: msg('The document is not issued yet: it will be when this revision is approved, today at the earliest, after it expires on {date}. The expiry date must first be moved in the metadata, by the document’s owner or a records manager.'),
  effective_after_review: msg('The document is not issued yet: it will be on the effective date, after its review date, {date}. Choose an earlier effective date; otherwise, the review date must first be moved in the metadata, by the document’s owner or a records manager.'),
  approval_after_review: msg('The document is not issued yet: it will be when this revision is approved, today at the earliest, after its review date, {date}. The review date must first be moved in the metadata, by the document’s owner or a records manager.'),
};

/** Why the name of a term is refused (lib/vocab-rules.ts termNameIssue). */
export const TERM_ISSUE_LABEL: Readonly<Record<TermIssue, string>> = {
  vocab_name_required: msg('Name required.'),
  vocab_name_too_long: msg('Name too long.'),
  vocab_name_taken: msg('A term already has this name (case, accents and blanks aside).'),
};

/** Why the date of a retention event is refused (lib/retention.ts parseEventDate). */
export const EVENT_DATE_ISSUE_LABEL: Readonly<Record<EventDateIssue, string>> = {
  retention_event_invalid: msg('Invalid event date.'),
  retention_event_future: msg('The event must have happened: the date cannot be later than today.'),
};
