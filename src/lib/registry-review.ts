import type { Attachment, Conf, Disposition, Origin, RetentionTrigger } from '@/db/schema';
import { FAMILIES, TYPES, type RegistryType } from '@/db/registry';
import { DEPARTMENTS, FUNCTIONS, HOLDERS, PROGRAMS, PROJECTS, USERS } from '@/db/seed-org';
import { csv, parseCsv, unneutralise } from './csv';
import { ATTACHMENTS, CONF_LEVELS, DICT, ORIGINS, type TKey } from './i18n';
import {
  BASIS_MAX, BUILT_IN_FUNCTIONS, builtInScopeIssue, builtInTypeIssue, DISPOSITIONS, FUNCTION_SCOPES, ISO_MAX, keyIssue, LABEL_MAX,
  parseSubtypes, RETENTION_TRIGGERS, RETENTION_YEARS_MAX, typeCodeIssue, type CodeSpace, type FunctionScope,
} from './registry-rules';

// Validation workbooks of the register (Lot 10, step 2; O-05, O-06, O-07, O-08 of docs/decisions.md): the types of
// src/db/registry.ts and the functions and holders of src/db/seed-org.ts written as CSV, one row each, with the open
// question each row is tied to and two empty columns for the user's answer; then the check of a filled workbook against
// the rules of the register (registry-rules.ts) and its difference with the code. Nothing here decides, writes or
// recommends: the workbook presents the register of the code (not a database), the check only reads.

/** Separator of the values of a list cell (origins, circuit, sub-types…). A comma is read too, except in sub-types. */
export const LIST_SEP = ' | ';
const YES = 'oui';
const NO = 'non';

export const TYPE_COLUMNS = [
  'Code', 'Libellé FR', 'Libellé EN', 'Famille', 'Famille (libellé)', 'Origines', 'Rattachements', 'Sous-types FR',
  'Sous-types EN', 'Circuit', 'Durée (ans)', 'Déclencheur', 'Sort final', 'Fondement', 'Fondement EN', 'Niveaux admis',
  'Niveau par défaut', 'Livrable client', 'ISO', 'Source', 'Question liée', 'Validé (oui/non)', 'Correction',
  'Nouveau code (renommage)',
] as const;

export const FUNCTION_COLUMNS = [
  'Clé', 'Libellé FR', 'Libellé EN', 'Portée', 'Titulaires', 'Circuits (types)', 'Question liée', 'Validé (oui/non)',
  'Correction',
] as const;

/** Columns the check compares with the code; the others are shown for reading (label of the family, source, questions). */
const TYPE_COMPARED = ['Libellé FR', 'Libellé EN', 'Famille', 'Origines', 'Rattachements', 'Sous-types FR', 'Sous-types EN', 'Circuit', 'Durée (ans)', 'Déclencheur', 'Sort final', 'Fondement', 'Fondement EN', 'Niveaux admis', 'Niveau par défaut', 'Livrable client', 'ISO'] as const;
const FUNCTION_COMPARED = ['Libellé FR', 'Libellé EN', 'Portée', 'Titulaires'] as const;

// ── Flags: the open question each row is tied to ────────────────────────────────────────────────────────────────

export type TypeFlag = 'no_years' | 'project_end' | 'public' | 'code_clash' | 'no_circuit';
export type FunctionFlag = 'demo' | 'built_in' | 'no_holder' | 'unused';

/** Department codes a type code would read as (FIN-FIN-0001): question 1 of docs/registre-points-ouverts.md. */
export const departmentCodes = (): string[] => DEPARTMENTS.map(([code]) => code);

/** Which open questions a type of the register is tied to, in a fixed order, with the text shown in the workbook. */
export function typeFlags(t: RegistryType, departments: readonly string[] = departmentCodes()): { flag: TypeFlag; text: string }[] {
  const out: { flag: TypeFlag; text: string }[] = [];
  if (t.retention.years == null) out.push({ flag: 'no_years', text: `O-07 : aucune durée (${DICT.fr[`trig_${t.retention.trigger}` as TKey]})` });
  if (t.retention.trigger === 'project_end') out.push({ flag: 'project_end', text: 'Registre, question 3 (O-05) : conservation à la fin du projet, date que Codex ne connaît pas' });
  if (t.confAllowed.includes('public')) out.push({ flag: 'public', text: 'O-08 : admet « Public »' });
  if (departments.includes(t.code)) out.push({ flag: 'code_clash', text: `Registre, question 1 (O-05) : aussi code de département (${t.code}-${t.code}-0001)` });
  if (!t.circuit.length) out.push({ flag: 'no_circuit', text: 'O-06 : aucun circuit (approuvé dès la demande)' });
  return out;
}

/** Types whose circuit names the function `key`, in the order of the register. */
export function typesUsing(key: string): string[] {
  return TYPES.filter((t) => t.circuit.includes(key)).map((t) => t.code);
}

export function functionFlags(key: string): { flag: FunctionFlag; text: string }[] {
  const out: { flag: FunctionFlag; text: string }[] = [{ flag: 'demo', text: 'O-06 : fonction et titulaires de démonstration' }];
  if (BUILT_IN_FUNCTIONS.includes(key)) out.push({ flag: 'built_in', text: 'Fonction des règles de Codex : portée fixe' });
  if (!HOLDERS.some(([f]) => f === key)) out.push({ flag: 'no_holder', text: 'O-06 : aucun titulaire nommé' });
  if (!typesUsing(key).length) out.push({ flag: 'unused', text: 'O-06 : aucun circuit ne la nomme' });
  return out;
}

// ── Writing the workbooks ────────────────────────────────────────────────────────────────────────────────────────

const familyLabel = (key: string) => FAMILIES.find((f) => f.key === key)?.label_fr ?? '';
const userName = (id: string) => USERS.find((u) => u.id === id)?.name;

/** The compared cells of a type, in canonical form: what the workbook shows and what a filled row is read back into. */
type TypeCells = Record<(typeof TYPE_COMPARED)[number], string>;

function typeCells(t: { labelFr: string; labelEn: string; family: string; origins: readonly string[]; attachments: readonly string[]; subtypes: readonly { fr: string; en: string }[]; circuit: readonly string[]; years: number | null; trigger: string; disposition: string; basis: string; basisEn: string; confAllowed: readonly string[]; confDefault: string; clientDeliverable: boolean; iso: string }): TypeCells {
  return {
    'Libellé FR': t.labelFr,
    'Libellé EN': t.labelEn,
    Famille: t.family,
    Origines: ORIGINS.filter((o) => t.origins.includes(o)).join(LIST_SEP),
    Rattachements: ATTACHMENTS.filter((a) => t.attachments.includes(a)).join(LIST_SEP),
    'Sous-types FR': t.subtypes.map((s) => s.fr).join(LIST_SEP),
    'Sous-types EN': t.subtypes.map((s) => s.en).join(LIST_SEP),
    Circuit: t.circuit.join(LIST_SEP),
    'Durée (ans)': t.years == null ? '' : String(t.years),
    Déclencheur: t.trigger,
    'Sort final': t.disposition,
    Fondement: t.basis,
    'Fondement EN': t.basisEn,
    'Niveaux admis': CONF_LEVELS.filter((c) => t.confAllowed.includes(c)).join(LIST_SEP),
    'Niveau par défaut': t.confDefault,
    'Livrable client': t.clientDeliverable ? YES : NO,
    ISO: t.iso,
  };
}

const registryCells = (t: RegistryType): TypeCells => typeCells({
  labelFr: t.label_fr, labelEn: t.label_en, family: t.family, origins: t.origins, attachments: t.attachments,
  subtypes: t.subtypes, circuit: t.circuit, years: t.retention.years, trigger: t.retention.trigger,
  disposition: t.retention.disposition, basis: t.retention.basis, basisEn: t.retention.basisEn ?? '',
  confAllowed: t.confAllowed, confDefault: t.confDefault, clientDeliverable: !!t.clientDeliverable, iso: t.iso ?? '',
});

/** One row per type of the register, in its order, the three answer columns empty. */
export function typeRows(): string[][] {
  return TYPES.map((t) => {
    const c = registryCells(t);
    const row: Record<(typeof TYPE_COLUMNS)[number], string> = {
      Code: t.code, ...c, 'Famille (libellé)': familyLabel(t.family), Source: t.source,
      'Question liée': typeFlags(t).map((f) => f.text).join(LIST_SEP),
      'Validé (oui/non)': '', Correction: '', 'Nouveau code (renommage)': '',
    };
    return TYPE_COLUMNS.map((k) => row[k]);
  });
}

/** Holders of a function as the workbook writes them: « DIR=hcosta (Hélène Costa) », or « hcosta (…) » without a scope value. */
function holdersCell(key: string, withNames: boolean): string {
  return HOLDERS.filter(([f]) => f === key)
    .map(([, scope, user]) => `${scope ? `${scope}=` : ''}${user}${withNames && userName(user) ? ` (${userName(user)})` : ''}`)
    .join(LIST_SEP);
}

/** One row per function of src/db/seed-org.ts, with its demonstration holders and the types whose circuit names it. */
export function functionRows(): string[][] {
  return FUNCTIONS.map(([key, fr, en, scope]) => {
    const row: Record<(typeof FUNCTION_COLUMNS)[number], string> = {
      Clé: key, 'Libellé FR': fr, 'Libellé EN': en, Portée: scope, Titulaires: holdersCell(key, true),
      'Circuits (types)': typesUsing(key).join(LIST_SEP), 'Question liée': functionFlags(key).map((f) => f.text).join(LIST_SEP),
      'Validé (oui/non)': '', Correction: '',
    };
    return FUNCTION_COLUMNS.map((k) => row[k]);
  });
}

/** The two workbooks, as the other exports of Codex: BOM, semicolons, formulas neutralised (lib/csv.ts). */
export function reviewFiles(): { 'types.csv': string; 'fonctions.csv': string } {
  return {
    'types.csv': csv([[...TYPE_COLUMNS], ...typeRows()]),
    'fonctions.csv': csv([[...FUNCTION_COLUMNS], ...functionRows()]),
  };
}

// ── Checking a filled workbook ───────────────────────────────────────────────────────────────────────────────────

/** A problem of a filled workbook: `line` is the line of the file (1 = header), `code` the row's code or key. */
export type ReviewIssue = { line: number; code: string; column?: string; message: string };
export type ReviewChange = { code: string; column: string; before: string; after: string };

export type ReviewReport = {
  kind: 'types' | 'functions';
  rows: number;
  /** Values the rules of the register refuse: formats, unknown references, collisions. */
  errors: ReviewIssue[];
  /** Differences with the code, row by row. */
  changes: ReviewChange[];
  added: string[];
  missing: string[];
  renamed: { from: string; to: string }[];
  answers: { yes: string[]; no: string[]; blank: number };
  /** Facts to know, neither errors nor changes (a « non » with neither correction nor change…). */
  notes: ReviewIssue[];
};

/** People and departments the holders and the codes are checked against: the demonstration's, or an org chart's (org:check). */
export type ReviewRefs = { people?: readonly string[]; departments?: readonly string[]; functions?: readonly string[] };

const msg = (key: TKey) => DICT.fr[key];
const splitList = (cell: string, commas = true) => cell.split(commas ? /[|,]/ : /\|/).map((s) => s.trim()).filter(Boolean);
const lower = (s: string) => s.trim().toLocaleLowerCase('fr');

type Table = { header: string[]; rows: { line: number; cells: Record<string, string> }[] };

function readTable(text: string): Table {
  const all = parseCsv(text);
  const header = (all[0] ?? []).map((h) => h.trim());
  // Line numbers count the lines read; a cell with a line break would shift them, which the messages tolerate.
  const rows = all.slice(1).map((r, i) => ({
    line: i + 2,
    cells: Object.fromEntries(header.map((h, j) => [h, unneutralise((r[j] ?? '').trim())])),
  }));
  return { header, rows };
}

/** Which workbook a file is, by its header: types (« Code »), functions (« Clé »), or neither. */
export function workbookKind(text: string): 'types' | 'functions' | null {
  const head = readTable(text).header;
  if (head[0] === 'Code' && head.includes('Déclencheur')) return 'types';
  if (head[0] === 'Clé' && head.includes('Titulaires')) return 'functions';
  return null;
}

function missingColumns(header: string[], wanted: readonly string[]): string[] {
  return wanted.filter((c) => !header.includes(c));
}

function readAnswer(cell: string, line: number, code: string, report: ReviewReport) {
  const v = lower(cell);
  if (v === YES) report.answers.yes.push(code);
  else if (v === NO) report.answers.no.push(code);
  else if (!v) report.answers.blank++;
  else report.errors.push({ line, code, column: 'Validé (oui/non)', message: `« ${cell} » : oui, non ou vide` });
}

function emptyReport(kind: ReviewReport['kind']): ReviewReport {
  return { kind, rows: 0, errors: [], changes: [], added: [], missing: [], renamed: [], answers: { yes: [], no: [], blank: 0 }, notes: [] };
}

/** Values of a list cell, each among `allowed`; the unknown ones reported. */
function pick<T extends string>(cell: string, allowed: readonly T[], err: (bad: string) => void): T[] {
  const vals = splitList(cell);
  for (const v of vals) if (!(allowed as readonly string[]).includes(v)) err(v);
  return allowed.filter((a) => vals.includes(a));
}

/**
 * The types workbook filled by the user: every value checked as the type dialog of the Administration checks it
 * (parseTypeForm, typeCodeIssue), but reported instead of dropped; then its difference with src/db/registry.ts. A row
 * keeps its code (the identity of the row); a renaming is asked in « Nouveau code (renommage) ».
 */
export function checkTypesWorkbook(text: string, refs: ReviewRefs = {}): ReviewReport {
  const report = emptyReport('types');
  const table = readTable(text);
  const absent = missingColumns(table.header, TYPE_COLUMNS);
  if (absent.length) {
    report.errors.push({ line: 1, code: '', message: `colonnes absentes : ${absent.join(', ')} (cahier de types attendu, écrit par npm run registry:review)` });
    return report;
  }
  const functions = refs.functions ?? FUNCTIONS.map(([k]) => k);
  const departments = refs.departments ?? departmentCodes();
  const families = FAMILIES.map((f) => f.key);
  const codes = table.rows.map((r) => r.cells.Code.toUpperCase());
  const renames = table.rows.map((r) => r.cells['Nouveau code (renommage)'].toUpperCase()).filter(Boolean);
  report.rows = table.rows.length;

  table.rows.forEach(({ line, cells }, i) => {
    const code = codes[i];
    const err = (column: string, message: string) => report.errors.push({ line, code, column, message });
    const known = TYPES.find((t) => t.code === code);
    // The codes that would still stand once the workbook applied: the others' codes (renamed ones under their new code).
    const others = table.rows.flatMap((r, j) => (j === i ? [] : [r.cells['Nouveau code (renommage)'].toUpperCase() || codes[j]]));
    const space: CodeSpace = { types: others, departments, projects: PROJECTS.map((p) => p.code), programs: PROGRAMS.map((p) => p.code) };
    if (!code) err('Code', 'code vide');
    else if (codes.indexOf(code) !== i) err('Code', 'code en double dans le cahier');
    else {
      // A code of the register keeps its letters (as in the Administration); a new one is checked as a new code.
      const issue = typeCodeIssue(code, space, known ? code : undefined);
      if (issue) err('Code', msg(issue));
      if (!known) report.added.push(code);
    }
    const renamed = cells['Nouveau code (renommage)'].toUpperCase();
    if (renamed && renamed !== code) {
      const issue = typeCodeIssue(renamed, space);
      if (issue) err('Nouveau code (renommage)', msg(issue));
      else if (renames.indexOf(renamed) !== renames.lastIndexOf(renamed)) err('Nouveau code (renommage)', 'même nouveau code sur deux lignes');
      report.renamed.push({ from: code, to: renamed });
    }

    const labelFr = cells['Libellé FR'];
    const labelEn = cells['Libellé EN'] || labelFr;
    if (!labelFr) err('Libellé FR', msg('reg_label_required'));
    if (labelFr.length > LABEL_MAX) err('Libellé FR', msg('reg_text_too_long'));
    if (labelEn.length > LABEL_MAX) err('Libellé EN', msg('reg_text_too_long'));
    const family = cells.Famille;
    if (!families.includes(family)) err('Famille', `famille « ${family} » inconnue (clés : colonne Famille du cahier d'origine)`);
    const origins = pick<Origin>(cells.Origines, ORIGINS, (v) => err('Origines', `« ${v} » : ${ORIGINS.join(', ')}`));
    if (!origins.length) err('Origines', msg('reg_origins_required'));
    const attachments = pick<Attachment>(cells.Rattachements, ATTACHMENTS, (v) => err('Rattachements', `« ${v} » : ${ATTACHMENTS.join(', ')}`));
    if (!attachments.length) err('Rattachements', msg('reg_attachments_required'));
    const builtIn = code ? builtInTypeIssue(code, { attachments }) : null;
    if (builtIn) err('Rattachements', msg(builtIn));
    const subtypes = parseSubtypes(splitList(cells['Sous-types FR'], false), splitList(cells['Sous-types EN'], false));
    if (!subtypes) err('Sous-types FR', msg('reg_subtypes_invalid'));
    const circuit = splitList(cells.Circuit);
    for (const f of circuit) if (!functions.includes(f)) err('Circuit', `fonction « ${f} » inconnue`);
    if (new Set(circuit).size !== circuit.length) err('Circuit', 'même fonction deux fois');
    const yearsRaw = cells['Durée (ans)'];
    const yearsOk = !yearsRaw || (/^\d{1,3}$/.test(yearsRaw) && Number(yearsRaw) <= RETENTION_YEARS_MAX);
    if (!yearsOk) err('Durée (ans)', msg('reg_years_invalid'));
    const trigger = RETENTION_TRIGGERS.find((x) => x === cells['Déclencheur']);
    if (!trigger) err('Déclencheur', `« ${cells['Déclencheur']} » : ${RETENTION_TRIGGERS.join(', ')}`);
    const disposition = DISPOSITIONS.find((x) => x === cells['Sort final']);
    if (!disposition) err('Sort final', `« ${cells['Sort final']} » : ${DISPOSITIONS.join(', ')}`);
    if (cells.Fondement.length > BASIS_MAX) err('Fondement', msg('reg_text_too_long'));
    if (cells['Fondement EN'].length > BASIS_MAX) err('Fondement EN', msg('reg_text_too_long'));
    const confAllowed = pick<Conf>(cells['Niveaux admis'], CONF_LEVELS, (v) => err('Niveaux admis', `« ${v} » : ${CONF_LEVELS.join(', ')}`));
    const confDefault = cells['Niveau par défaut'] as Conf;
    if (!confAllowed.length || !confAllowed.includes(confDefault)) err('Niveau par défaut', msg('conf_not_allowed'));
    const deliverable = lower(cells['Livrable client']);
    if (deliverable && deliverable !== YES && deliverable !== NO) err('Livrable client', `« ${cells['Livrable client']} » : oui ou non`);
    if (cells.ISO.length > ISO_MAX) err('ISO', msg('reg_text_too_long'));
    readAnswer(cells['Validé (oui/non)'], line, code, report);

    if (!known || !code || codes.indexOf(code) !== i) return;
    const now = typeCells({
      labelFr, labelEn, family, origins, attachments, subtypes: subtypes ?? [], circuit,
      years: yearsOk && yearsRaw ? Number(yearsRaw) : null, trigger: (trigger ?? cells['Déclencheur']) as RetentionTrigger,
      disposition: (disposition ?? cells['Sort final']) as Disposition, basis: cells.Fondement, basisEn: cells['Fondement EN'],
      confAllowed, confDefault, clientDeliverable: deliverable === YES, iso: cells.ISO,
    });
    // An unreadable sub-type list is an error already; it is not a change as well.
    if (!subtypes) { now['Sous-types FR'] = registryCells(known)['Sous-types FR']; now['Sous-types EN'] = registryCells(known)['Sous-types EN']; }
    const before = registryCells(known);
    const changed = TYPE_COMPARED.filter((k) => before[k] !== now[k]);
    for (const k of changed) report.changes.push({ code, column: k, before: before[k], after: now[k] });
    if (lower(cells['Validé (oui/non)']) === NO && !changed.length && !cells.Correction && !renamed) {
      report.notes.push({ line, code, message: '« non » sans correction ni valeur changée' });
    }
  });
  report.missing = TYPES.map((t) => t.code).filter((c) => !codes.includes(c));
  return report;
}

/** Holders read from a cell: « DIR=hcosta (Hélène Costa) | hcosta », names in brackets ignored. */
export function parseHolders(cell: string): { scope: string | null; user: string }[] {
  return splitList(cell).map((entry) => {
    const bare = entry.replace(/\s*\([^)]*\)\s*$/, '').trim();
    const eq = bare.indexOf('=');
    return eq < 0 ? { scope: null, user: bare } : { scope: bare.slice(0, eq).trim() || null, user: bare.slice(eq + 1).trim() };
  });
}

const holdersKey = (xs: { scope: string | null; user: string }[]) =>
  xs.map((h) => `${h.scope ? `${h.scope}=` : ''}${h.user}`).sort().join(LIST_SEP);

/**
 * The functions workbook filled by the user: keys, labels, scopes (a function the rules of Codex name keeps its own)
 * and holders, each holder a known person and, for a scoped function, a known department, project or programme. Then
 * its difference with FUNCTIONS and HOLDERS of src/db/seed-org.ts.
 */
export function checkFunctionsWorkbook(text: string, refs: ReviewRefs = {}): ReviewReport {
  const report = emptyReport('functions');
  const table = readTable(text);
  const absent = missingColumns(table.header, FUNCTION_COLUMNS);
  if (absent.length) {
    report.errors.push({ line: 1, code: '', message: `colonnes absentes : ${absent.join(', ')} (cahier de fonctions attendu, écrit par npm run registry:review)` });
    return report;
  }
  const people = refs.people ?? USERS.filter((u) => !u.system).map((u) => u.id);
  const departments = refs.departments ?? departmentCodes();
  const scopeValues: Record<FunctionScope, readonly string[]> = {
    global: [], department: departments, project: PROJECTS.map((p) => p.code), research: PROGRAMS.map((p) => p.code),
  };
  const keys = table.rows.map((r) => r.cells['Clé'].toLowerCase());
  report.rows = table.rows.length;

  table.rows.forEach(({ line, cells }, i) => {
    const key = keys[i];
    const err = (column: string, message: string) => report.errors.push({ line, code: key, column, message });
    const known = FUNCTIONS.find(([k]) => k === key);
    const format = keyIssue(key, []);
    const duplicate = !format && keys.indexOf(key) !== i;
    if (format) err('Clé', msg(format));
    else if (duplicate) err('Clé', 'clé en double dans le cahier');
    else if (!known) report.added.push(key);
    const labelFr = cells['Libellé FR'];
    const labelEn = cells['Libellé EN'] || labelFr;
    if (!labelFr) err('Libellé FR', msg('reg_label_required'));
    if (labelFr.length > LABEL_MAX) err('Libellé FR', msg('reg_text_too_long'));
    if (labelEn.length > LABEL_MAX) err('Libellé EN', msg('reg_text_too_long'));
    const scope = FUNCTION_SCOPES.find((s) => s === cells['Portée']);
    if (!scope) err('Portée', `« ${cells['Portée']} » : ${FUNCTION_SCOPES.join(', ')}`);
    const fixed = scope ? builtInScopeIssue(key, scope) : null;
    if (fixed) err('Portée', msg(fixed));
    const holders = parseHolders(cells.Titulaires);
    for (const h of holders) {
      if (!people.includes(h.user)) err('Titulaires', `personne « ${h.user} » inconnue${refs.people ? ' de l’organigramme' : ' (personnes de démonstration, ou --org <organigramme.csv>)'}`);
      if (!scope || !h.scope) continue;
      if (scope === 'global') err('Titulaires', `« ${h.scope}=${h.user} » : une fonction de portée global n'a pas de valeur de portée`);
      else if (!scopeValues[scope].includes(h.scope)) err('Titulaires', `« ${h.scope} » n'est pas un code connu pour la portée ${scope}`);
    }
    const seen = holders.map((h) => `${h.scope}=${h.user}`);
    if (new Set(seen).size !== seen.length) err('Titulaires', 'même titulaire deux fois');
    readAnswer(cells['Validé (oui/non)'], line, key, report);

    if (!known || format || duplicate) return;
    const before: Record<(typeof FUNCTION_COMPARED)[number], string> = {
      'Libellé FR': known[1], 'Libellé EN': known[2], Portée: known[3], Titulaires: holdersKey(parseHolders(holdersCell(key, false))),
    };
    const now: typeof before = { 'Libellé FR': labelFr, 'Libellé EN': labelEn, Portée: cells['Portée'], Titulaires: holdersKey(holders) };
    const changed = FUNCTION_COMPARED.filter((k) => before[k] !== now[k]);
    for (const k of changed) report.changes.push({ code: key, column: k, before: before[k], after: now[k] });
    if (lower(cells['Validé (oui/non)']) === NO && !changed.length && !cells.Correction) {
      report.notes.push({ line, code: key, message: '« non » sans correction ni valeur changée' });
    }
  });
  report.missing = FUNCTIONS.map(([k]) => k).filter((k) => !keys.includes(k));
  return report;
}

/** The keys of the functions a types workbook may name in its circuits: those of a functions workbook checked alongside. */
export function functionKeysOf(text: string): string[] {
  return readTable(text).rows.map((r) => (r.cells['Clé'] ?? '').toLowerCase()).filter(Boolean);
}

/** The report as lines of text (npm run registry:review -- --check). */
export function reportLines(r: ReviewReport, file: string): string[] {
  const what = r.kind === 'types' ? 'types' : 'fonctions';
  const lines = [`Cahier de ${what} : ${file} (${r.rows} ligne(s))`];
  lines.push(`Réponses : ${r.answers.yes.length} « oui », ${r.answers.no.length} « non », ${r.answers.blank} sans réponse.`);
  if (r.answers.no.length) lines.push(`  « non » : ${r.answers.no.join(', ')}`);
  lines.push(r.errors.length ? `Erreurs (${r.errors.length}) :` : 'Aucune erreur : chaque valeur suit les règles du registre.');
  for (const e of r.errors) lines.push(`  ligne ${e.line}${e.code ? ` ${e.code}` : ''}${e.column ? `, ${e.column}` : ''} : ${e.message}`);
  const diff = r.changes.length + r.added.length + r.missing.length + r.renamed.length;
  lines.push(diff ? `Écart avec le code (${r.kind === 'types' ? 'src/db/registry.ts' : 'src/db/seed-org.ts'}) :` : 'Aucun écart avec le code.');
  for (const c of r.changes) lines.push(`  ${c.code}, ${c.column} : ${c.before || '(vide)'} → ${c.after || '(vide)'}`);
  for (const x of r.renamed) lines.push(`  ${x.from} → ${x.to} : renommage demandé`);
  for (const a of r.added) lines.push(`  ${a} : absent du code (nouvelle ligne)`);
  for (const m of r.missing) lines.push(`  ${m} : absent du cahier`);
  if (r.notes.length) {
    lines.push(`À savoir (${r.notes.length}) :`);
    for (const n of r.notes) lines.push(`  ligne ${n.line} ${n.code} : ${n.message}`);
  }
  return lines;
}
