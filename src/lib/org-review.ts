import { TYPES } from '@/db/registry';
import { PROGRAMS, PROJECTS } from '@/db/seed-org';
import { parseCsv, unneutralise } from './csv';
import { DICT, MATRIX_ROLES, SIM_ROLES } from './i18n';
import { orgLabels } from './org-rules';
import { departmentCodeIssue, KEY_RE, LABEL_MAX, type CodeSpace } from './registry-rules';

// Check of an org chart given as CSV (O-04 of docs/decisions.md; model in docs/modeles/organigramme.csv), before it is
// typed into Administration › Organisation or replaces the provisional values of src/db/seed-org.ts: the rules of
// org-rules.ts and registry-rules.ts (codes, labels), collisions with the codes of the register, duplicates, unknown
// references. Nothing is written and nothing decided: a company is only a column read here (Codex has no such table).

export const ORG_COLUMNS = ['Nature', 'Code', 'Nom', 'Libellé FR', 'Libellé EN', 'Société', 'Département', 'Site', 'Responsable', 'Rôle Codex'] as const;
/** Columns a file may leave out: the company (Codex has no company, O-04). */
export const ORG_OPTIONAL_COLUMNS: readonly string[] = ['Société'];

export const ORG_NATURES = { département: 'department', departement: 'department', site: 'site', personne: 'person' } as const;
type Nature = (typeof ORG_NATURES)[keyof typeof ORG_NATURES];

/** Roles a person may be given: the simulated ones of Codex and those of the rights matrix (which one applies is O-02). */
export const ORG_ROLES: readonly string[] = [...new Set<string>([...SIM_ROLES, ...MATRIX_ROLES])];
/** A person's identifier, until the authentication provider gives one (O-02): no space, no separator of the workbooks. */
export const PERSON_ID_RE = /^[^\s;|=,()]{1,120}$/;

export type OrgIssue = { line: number; code: string; column?: string; message: string };
export type OrgDepartment = { code: string; labelFr: string; labelEn: string; company: string; head: string };
export type OrgSite = { key: string; labelFr: string; labelEn: string; company: string };
export type OrgPerson = { id: string; name: string; titleFr: string; titleEn: string; company: string; department: string; site: string; role: string };

export type OrgReport = {
  departments: OrgDepartment[];
  sites: OrgSite[];
  people: OrgPerson[];
  companies: string[];
  /** Formats, unknown references, missing values. */
  errors: OrgIssue[];
  /** A department code that is already a type code, QMS, a project or a programme (question 1 of the register, O-05). */
  collisions: OrgIssue[];
  /** The same code twice. */
  duplicates: OrgIssue[];
};

export const orgOk = (r: OrgReport) => !r.errors.length && !r.collisions.length && !r.duplicates.length;

/** The codes a department code may not take: the types of src/db/registry.ts, the demonstration's projects and programmes. */
export function registerCodeSpace(): Omit<CodeSpace, 'departments'> {
  return { types: TYPES.map((t) => t.code), projects: PROJECTS.map((p) => p.code), programs: PROGRAMS.map((p) => p.code) };
}

export function checkOrgCsv(text: string, space: Omit<CodeSpace, 'departments'> = registerCodeSpace()): OrgReport {
  const report: OrgReport = { departments: [], sites: [], people: [], companies: [], errors: [], collisions: [], duplicates: [] };
  const all = parseCsv(text);
  const header = (all[0] ?? []).map((h) => h.trim());
  const absent = ORG_COLUMNS.filter((c) => !ORG_OPTIONAL_COLUMNS.includes(c) && !header.includes(c));
  if (absent.length) {
    report.errors.push({ line: 1, code: '', message: `colonnes absentes : ${absent.join(', ')} (modèle : docs/modeles/organigramme.csv)` });
    return report;
  }
  const rows = all.slice(1).map((r, i) => ({ line: i + 2, cell: (c: string) => { const j = header.indexOf(c); return j < 0 ? '' : unneutralise((r[j] ?? '').trim()); } }));
  const seen: Record<Nature, Map<string, number>> = { department: new Map(), site: new Map(), person: new Map() };
  const refs: { line: number; code: string; column: string; kind: Nature; value: string }[] = [];

  for (const { line, cell } of rows) {
    const natureCell = cell('Nature');
    const nature = ORG_NATURES[natureCell.toLocaleLowerCase('fr') as keyof typeof ORG_NATURES] as Nature | undefined;
    const code = cell('Code');
    const err = (column: string, message: string) => report.errors.push({ line, code, column, message });
    if (!nature) { err('Nature', `« ${natureCell} » : département, site ou personne`); continue; }
    const company = cell('Société');
    if (company.length > LABEL_MAX) err('Société', DICT.fr.reg_text_too_long);
    if (company && !report.companies.includes(company)) report.companies.push(company);
    const first = seen[nature].get(code);
    if (code && first) { report.duplicates.push({ line, code, column: 'Code', message: `déjà donné ligne ${first}` }); continue; }
    if (code) seen[nature].set(code, line);

    if (nature === 'department' || nature === 'site') {
      const labels = orgLabels(cell('Libellé FR'), cell('Libellé EN'));
      if (!labels.ok) err(labels.field === 'labelEn' ? 'Libellé EN' : 'Libellé FR', DICT.fr[labels.key]);
      const { labelFr, labelEn } = labels.ok ? labels.value : { labelFr: cell('Libellé FR'), labelEn: cell('Libellé EN') };
      if (nature === 'department') {
        // Duplicates are reported above; here, format and the codes of the register.
        const issue = departmentCodeIssue(code, { ...space, departments: [] });
        if (issue === 'reg_department_code_format') err('Code', DICT.fr[issue]);
        else if (issue) report.collisions.push({ line, code, column: 'Code', message: `${DICT.fr[issue]}${issue === 'reg_code_type' ? ` (${code}-${code}-0001 ; question 1 du registre, O-05)` : ''}` });
        const head = cell('Responsable');
        if (head) refs.push({ line, code, column: 'Responsable', kind: 'person', value: head });
        report.departments.push({ code, labelFr, labelEn, company, head });
      } else {
        if (!KEY_RE.test(code)) err('Code', DICT.fr.reg_key_format);
        report.sites.push({ key: code, labelFr, labelEn, company });
      }
      continue;
    }

    if (!PERSON_ID_RE.test(code)) err('Code', 'identifiant de personne : 1 à 120 caractères, sans espace ni ; | = , ( )');
    const name = cell('Nom');
    if (!name) err('Nom', 'le nom est obligatoire');
    if (name.length > LABEL_MAX) err('Nom', DICT.fr.reg_text_too_long);
    const titleFr = cell('Libellé FR');
    const titleEn = cell('Libellé EN');
    if (titleFr.length > LABEL_MAX) err('Libellé FR', DICT.fr.reg_text_too_long);
    if (titleEn.length > LABEL_MAX) err('Libellé EN', DICT.fr.reg_text_too_long);
    const department = cell('Département');
    if (!department) err('Département', 'le département est obligatoire');
    else refs.push({ line, code, column: 'Département', kind: 'department', value: department });
    const site = cell('Site');
    if (site) refs.push({ line, code, column: 'Site', kind: 'site', value: site });
    const role = cell('Rôle Codex');
    if (role && !ORG_ROLES.includes(role)) err('Rôle Codex', `« ${role} » : ${ORG_ROLES.join(', ')} ou vide`);
    report.people.push({ id: code, name, titleFr, titleEn, company, department, site, role });
  }

  const what: Record<Nature, string> = { department: 'département', site: 'site', person: 'personne' };
  for (const r of refs) {
    if (!seen[r.kind].has(r.value)) report.errors.push({ line: r.line, code: r.code, column: r.column, message: `${what[r.kind]} « ${r.value} » absent du fichier` });
  }
  if (!report.departments.length) report.errors.push({ line: 1, code: '', message: 'aucun département : il en faut un au moins (contexte des identifiants sans rattachement)' });
  return report;
}

/** The report as lines of text (npm run org:check). */
export function orgReportLines(r: OrgReport, file: string): string[] {
  const lines = [
    `Organigramme : ${file}`,
    `${r.departments.length} département(s), ${r.sites.length} site(s), ${r.people.length} personne(s)${r.companies.length ? ` ; sociétés citées : ${r.companies.join(', ')}` : ' ; aucune société citée'}.`,
  ];
  const block = (title: string, xs: OrgIssue[]) => {
    if (!xs.length) return;
    lines.push(`${title} (${xs.length}) :`);
    for (const e of xs) lines.push(`  ligne ${e.line}${e.code ? ` ${e.code}` : ''}${e.column ? `, ${e.column}` : ''} : ${e.message}`);
  };
  block('Erreurs', r.errors);
  block('Doublons', r.duplicates);
  block('Collisions avec les codes du registre', r.collisions);
  if (orgOk(r)) lines.push('Aucune erreur, aucun doublon, aucune collision.');
  lines.push('Rien n\'a été écrit (ni base ni fichier).');
  return lines;
}
