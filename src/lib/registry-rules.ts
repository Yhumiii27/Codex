import type { Attachment, Conf, Disposition, Origin, RetentionTrigger } from '@/db/schema';
import { TEMPLATE_CONTEXT, TEMPLATE_TYPE } from './codes';
import { ATTACHMENTS, CONF_LEVELS, ORIGINS, type TKey } from './i18n';
import { parseReviewMonths } from './review';

// Pure rules of the register's administration (Administration › Registre des types, Fonctions & circuits): formats of
// the codes and keys, collisions between the segments of an ID (TYPE-CONTEXTE-SEQ, docs/modele-cible.md §3), and the
// reading of the forms. lib/actions.ts applies them with the rights and the usage checks.

export const RETENTION_TRIGGERS = ['creation', 'in_force', 'superseded', 'project_end', 'contract_end', 'fiscal_year_end', 'expiry', 'asset_life', 'employee_departure', 'permanent'] as const satisfies readonly RetentionTrigger[];
export const DISPOSITIONS = ['destroy', 'review', 'archive', 'permanent'] as const satisfies readonly Disposition[];
/** Deck domain a family comes from (DI interne, DE externe, DP projet, DR recherche), kept for grouping only (D-08). */
export const FAMILY_GROUPS = ['DI', 'DE', 'DP', 'DR'] as const;
export type FamilyGroup = (typeof FAMILY_GROUPS)[number];
/** Where the holder of a function is looked up (lib/actions.ts resolveFunction). */
export const FUNCTION_SCOPES = ['global', 'department', 'project', 'research'] as const;
export type FunctionScope = (typeof FUNCTION_SCOPES)[number];

/** Functions whose project's manager answers when no holder is named for the project (lib/actions.ts resolveFunction). */
export const PROJECT_MANAGER_FUNCTIONS = ['chef_projet', 'validation_client'];
/** Function the heads of departments are read from (Administration › Organisation). */
export const DEPARTMENT_HEAD_FUNCTION = 'resp_departement';
/**
 * Entries the rules of Codex name: the type of templates (context QMS, D-10) and the functions above. They keep their
 * code and are never deleted, used or not (lib/queries.ts registryUsage counts them as used).
 */
export const BUILT_IN_TYPES: readonly string[] = [TEMPLATE_TYPE];
export const BUILT_IN_FUNCTIONS: readonly string[] = [...PROJECT_MANAGER_FUNCTIONS, DEPARTMENT_HEAD_FUNCTION];

/**
 * Settings of those entries the code relies on, kept whatever the form says. A template has no attachment: attached to a
 * project or a programme, its ID would take that context instead of QMS (lib/codes.ts contextOf, D-10). The project's
 * manager answers for PROJECT_MANAGER_FUNCTIONS at the scope of a project only (resolveFunction); the heads of
 * departments are holders at the scope of a department.
 */
export const TEMPLATE_ATTACHMENTS: readonly Attachment[] = ['none'];
export const BUILT_IN_SCOPES: ReadonlyMap<string, FunctionScope> = new Map<string, FunctionScope>([
  ...PROJECT_MANAGER_FUNCTIONS.map((k): [string, FunctionScope] => [k, 'project']),
  [DEPARTMENT_HEAD_FUNCTION, 'department'],
]);

/** Why a type named `code` may not admit these attachments (the type of templates: none but « none »), or null. */
export function builtInTypeIssue(code: string, v: { attachments: readonly Attachment[] }): TKey | null {
  if (code !== TEMPLATE_TYPE) return null;
  return v.attachments.length === TEMPLATE_ATTACHMENTS.length && v.attachments.every((a) => TEMPLATE_ATTACHMENTS.includes(a)) ? null : 'reg_template_attachments';
}

/** Why a function keyed `key` may not have this scope (a function the rules of Codex name keeps its own), or null. */
export function builtInScopeIssue(key: string, scope: FunctionScope): TKey | null {
  const fixed = BUILT_IN_SCOPES.get(key);
  return fixed && fixed !== scope ? 'reg_scope_built_in' : null;
}

/** Type code, first segment of an ID: 2 or 3 capital letters, as every code of the register (GA, PO, PRO…). */
export const TYPE_CODE_RE = /^[A-Z]{2,3}$/;
/** Programme code, the context of a research document's ID (PRT-R2601-004): a capital letter, then 2 to 9 capitals or digits. */
export const PROGRAM_CODE_RE = /^[A-Z][A-Z0-9]{2,9}$/;
/** Department code, the context of an ID without attachment (PRO-QUA-0003). */
export const DEPARTMENT_CODE_RE = /^[A-Z]{3}$/;
/** Key of a family or a function (gouvernance_management, resp_qualite): never shown, stored in the circuits and the journal. */
export const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

export const LABEL_MAX = 160;
export const SUBTYPES_MAX = 40;
export const SUBTYPE_MAX = 120;
export const ISO_MAX = 120;
export const BASIS_MAX = 500;
export const RETENTION_YEARS_MAX = 200;

/**
 * Codes already given, by what they name. Every one of them may stand in an ID: types in first place, departments,
 * projects, programmes and QMS (templates) as its context.
 */
export type CodeSpace = { types: readonly string[]; departments: readonly string[]; projects: readonly string[]; programs: readonly string[] };

/**
 * A code that would read as another segment of an ID: TYPE-CONTEXTE with the same letters (« FIN-FIN-0001 », point 1 of
 * docs/registre-points-ouverts.md, not settled, O-05), or two contexts sharing a counter. The types and departments that
 * already share a code (FIN, HSE, COM) keep it: only a new code, or a code that changes, is checked.
 */
function clash(code: string, space: CodeSpace, own: keyof CodeSpace): TKey | null {
  if (code === TEMPLATE_CONTEXT) return 'reg_code_qms';
  if (space[own].includes(code)) return 'reg_code_taken';
  const named: [keyof CodeSpace, TKey][] = [['types', 'reg_code_type'], ['departments', 'reg_code_department'], ['programs', 'reg_code_program'], ['projects', 'reg_code_project']];
  return named.find(([k]) => k !== own && space[k].includes(code))?.[1] ?? null;
}

/** Why a type code may not be given (`current`: the type's own code, which it keeps whatever the others), or null. */
export function typeCodeIssue(code: string, space: CodeSpace, current?: string): TKey | null {
  if (!TYPE_CODE_RE.test(code)) return 'reg_type_code_format';
  return code === current ? null : clash(code, space, 'types');
}

/** Why a programme code may not be given, or null. */
export function programCodeIssue(code: string, space: CodeSpace, current?: string): TKey | null {
  if (!PROGRAM_CODE_RE.test(code)) return 'reg_program_code_format';
  return code === current ? null : clash(code, space, 'programs');
}

/** Why a new department code may not be given, or null (Administration › Organisation). */
export function departmentCodeIssue(code: string, space: CodeSpace): TKey | null {
  if (!DEPARTMENT_CODE_RE.test(code)) return 'reg_department_code_format';
  return clash(code, space, 'departments');
}

/** Why the key of a family or a function may not be given (`taken`: the keys in use, `current` its own), or null. */
export function keyIssue(key: string, taken: readonly string[], current?: string): TKey | null {
  if (!KEY_RE.test(key)) return 'reg_key_format';
  return key !== current && taken.includes(key) ? 'reg_code_taken' : null;
}

/** A form refused: the message, and the field to show it under when there is one. */
export type FormIssue = { ok: false; key: TKey; field?: string };
export type Parsed<T> = { ok: true; value: T } | FormIssue;

const text = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const issue = (key: TKey, field?: string): FormIssue => ({ ok: false, key, field });

/** French label required, English one defaulting to it; both bounded. */
function labels(fd: FormData, fr = 'labelFr', en = 'labelEn'): Parsed<{ labelFr: string; labelEn: string }> {
  const labelFr = text(fd, fr);
  const labelEn = text(fd, en) || labelFr;
  if (!labelFr) return issue('reg_label_required', fr);
  if (labelFr.length > LABEL_MAX) return issue('reg_text_too_long', fr);
  if (labelEn.length > LABEL_MAX) return issue('reg_text_too_long', en);
  return { ok: true, value: { labelFr, labelEn } };
}

export type TypeValues = {
  code: string; labelFr: string; labelEn: string; family: string; origins: Origin[]; attachments: Attachment[];
  subtypes: { fr: string; en: string }[]; circuit: string[]; confAllowed: Conf[]; confDefault: Conf;
  retentionYears: number | null; retentionTrigger: RetentionTrigger; retentionDisposition: Disposition; retentionBasis: string;
  reviewMonths: number | null; iso: string | null; clientDeliverable: boolean; active: boolean;
};

/** Rows of sub-types read at most: twice as many as a type may keep, so a few empty rows pass and a flood is refused unread. */
export const SUBTYPE_ROWS_MAX = 2 * SUBTYPES_MAX;

/**
 * Sub-types sent as two lists, French and English, row by row: an empty row is dropped, the English label defaults
 * to the French one, the same French label (case aside) is kept once.
 */
export function parseSubtypes(frs: string[], ens: string[]): { fr: string; en: string }[] | null {
  if (frs.length > SUBTYPE_ROWS_MAX || ens.length > SUBTYPE_ROWS_MAX) return null;
  const out: { fr: string; en: string }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < Math.max(frs.length, ens.length); i++) {
    const en = (ens[i] ?? '').trim();
    const fr = (frs[i] ?? '').trim() || en;
    if (!fr) continue;
    if (fr.length > SUBTYPE_MAX || en.length > SUBTYPE_MAX) return null;
    const folded = fr.toLocaleLowerCase('fr');
    if (seen.has(folded)) continue;
    seen.add(folded);
    out.push({ fr, en: en || fr });
    if (out.length > SUBTYPES_MAX) return null;
  }
  return out;
}

/**
 * The type dialog (createType, updateType): every setting of a type, checked against the families and functions of
 * the register. The code is only read here: whether it may be given is typeCodeIssue's, whether it may change the
 * action's (a type in use keeps its code).
 */
export function parseTypeForm(fd: FormData, refs: { families: readonly string[]; functions: readonly string[] }): Parsed<TypeValues> {
  const code = text(fd, 'code').toUpperCase();
  const names = labels(fd);
  if (!names.ok) return names;
  const family = text(fd, 'family');
  if (!refs.families.includes(family)) return issue('reg_family_required', 'family');
  const picked = (k: string) => fd.getAll(k).map(String);
  const origins = ORIGINS.filter((o) => picked('origins').includes(o));
  if (!origins.length) return issue('reg_origins_required', 'origins');
  const attachments = ATTACHMENTS.filter((a) => picked('attachments').includes(a));
  if (!attachments.length) return issue('reg_attachments_required', 'attachments');
  const subtypes = parseSubtypes(picked('subtypeFr'), picked('subtypeEn'));
  if (!subtypes) return issue('reg_subtypes_invalid', 'subtypes');
  // Unknown functions are dropped, each step kept once, in order.
  const circuit = [...new Set(picked('circuit').filter((k) => refs.functions.includes(k)))];
  const confAllowed = CONF_LEVELS.filter((c) => picked('confAllowed').includes(c));
  const confDefault = text(fd, 'confDefault') as Conf;
  if (!confAllowed.length || !confAllowed.includes(confDefault)) return issue('conf_not_allowed', 'confDefault');
  // Empty: no periodicity. Otherwise a whole number of months, refused rather than corrected.
  const reviewMonths = parseReviewMonths(text(fd, 'reviewMonths'));
  if (reviewMonths === undefined) return issue('review_months_invalid', 'reviewMonths');
  const yearsRaw = text(fd, 'retentionYears');
  if (yearsRaw && !(/^\d{1,3}$/.test(yearsRaw) && Number(yearsRaw) <= RETENTION_YEARS_MAX)) return issue('reg_years_invalid', 'retentionYears');
  const retentionTrigger = RETENTION_TRIGGERS.find((x) => x === text(fd, 'retentionTrigger'));
  const retentionDisposition = DISPOSITIONS.find((x) => x === text(fd, 'retentionDisposition'));
  if (!retentionTrigger || !retentionDisposition) return issue('error');
  const retentionBasis = text(fd, 'retentionBasis');
  if (retentionBasis.length > BASIS_MAX) return issue('reg_text_too_long', 'retentionBasis');
  const iso = text(fd, 'iso');
  if (iso.length > ISO_MAX) return issue('reg_text_too_long', 'iso');
  return {
    ok: true,
    value: {
      code, ...names.value, family, origins, attachments, subtypes, circuit, confAllowed, confDefault,
      retentionYears: yearsRaw ? Number(yearsRaw) : null, retentionTrigger, retentionDisposition, retentionBasis, reviewMonths,
      iso: iso || null, clientDeliverable: fd.get('clientDeliverable') === 'on', active: fd.get('active') !== 'off',
    },
  };
}

export type FamilyValues = { key: string; labelFr: string; labelEn: string; grp: FamilyGroup };

export function parseFamilyForm(fd: FormData): Parsed<FamilyValues> {
  const names = labels(fd);
  if (!names.ok) return names;
  const grp = FAMILY_GROUPS.find((g) => g === text(fd, 'grp'));
  if (!grp) return issue('error');
  return { ok: true, value: { key: text(fd, 'key').toLowerCase(), ...names.value, grp } };
}

export type FunctionValues = { key: string; labelFr: string; labelEn: string; scope: FunctionScope };

export function parseFunctionForm(fd: FormData): Parsed<FunctionValues> {
  const names = labels(fd);
  if (!names.ok) return names;
  const scope = FUNCTION_SCOPES.find((x) => x === text(fd, 'scope'));
  if (!scope) return issue('error');
  return { ok: true, value: { key: text(fd, 'key').toLowerCase(), ...names.value, scope } };
}

export type ProgramValues = { code: string; name: string; managerId: string; active: boolean };

export function parseProgramForm(fd: FormData): Parsed<ProgramValues> {
  const name = text(fd, 'name');
  if (!name) return issue('reg_label_required', 'name');
  if (name.length > LABEL_MAX) return issue('reg_text_too_long', 'name');
  return { ok: true, value: { code: text(fd, 'code').toUpperCase(), name, managerId: text(fd, 'managerId'), active: fd.get('active') !== 'off' } };
}

/**
 * A document its type would no longer admit: its origin, attachment or confidentiality left out. It keeps them, but
 * the next edit of its metadata is refused until it is reclassified (lib/actions.ts validateFields).
 */
export function outsideType(d: { origin: Origin; attachment: Attachment; conf: Conf }, t: { origins: Origin[]; attachments: Attachment[]; confAllowed: Conf[] }): boolean {
  return !t.origins.includes(d.origin) || !t.attachments.includes(d.attachment) || !t.confAllowed.includes(d.conf);
}

/** Sub-types as the journal stores them: the French label, and the English one when it differs. */
export function subtypesJournal(xs: { fr: string; en: string }[]): string[] {
  return xs.map((x) => (x.en && x.en !== x.fr ? `${x.fr} / ${x.en}` : x.fr));
}
