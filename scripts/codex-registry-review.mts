// Validation workbooks of the register (Lot 10, step 2; O-05 to O-08 of docs/decisions.md, docs/registre-points-ouverts.md):
//
//   npm run registry:review -- --out <dossier>                 écrit types.csv et fonctions.csv (registre du code)
//   npm run registry:review -- --check <cahier.csv> [...]      contrôle un cahier rempli et montre l'écart avec le code
//
// The workbooks present src/db/registry.ts and the functions and holders of src/db/seed-org.ts, not a database: no
// database is opened, nothing is decided. --out refuses to overwrite a workbook already there (--force to replace it,
// a filled one included). --check reads one or two workbooks (types, functions: told apart by their header; the
// functions of a functions workbook checked alongside may stand in the circuits of the types) and, with
// --org <organigramme.csv> (npm run org:check), takes its people and departments for the holders; it writes nothing.
// Exit status: 0 when done (no error in a checked workbook), 1 on an error, 2 on a wrong usage.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkOrgCsv, orgOk } from '../src/lib/org-review';
import {
  checkFunctionsWorkbook, checkTypesWorkbook, functionKeysOf, reportLines, reviewFiles, typeFlags, workbookKind,
  type ReviewRefs,
} from '../src/lib/registry-review';
import { TYPES } from '../src/db/registry';
import { FUNCTIONS } from '../src/db/seed-org';

const USAGE = [
  'Usage :',
  '  npm run registry:review -- --out <dossier> [--force]',
  '  npm run registry:review -- --check <cahier.csv> [--check <cahier.csv>] [--org <organigramme.csv>]',
].join('\n');

function parseArgs(argv: string[]): { out?: string; force: boolean; checks: string[]; org?: string } | null {
  const res: { out?: string; force: boolean; checks: string[]; org?: string } = { force: false, checks: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : null);
    if (a === '--force') res.force = true;
    else if (a === '--out') { const v = value(); if (!v || res.out) return null; res.out = v; }
    else if (a === '--check') { const v = value(); if (!v) return null; res.checks.push(v); }
    else if (a === '--org') { const v = value(); if (!v || res.org) return null; res.org = v; }
    else return null;
  }
  if (!!res.out === !!res.checks.length) return null;
  if (res.out && res.org) return null;
  if (res.checks.length > 2) return null;
  return res;
}

const exists = (p: string) => stat(p).then(() => true, () => false);

async function writeWorkbooks(dir: string, force: boolean) {
  const files = reviewFiles();
  const target = path.resolve(dir);
  const taken = [];
  for (const name of Object.keys(files)) if (await exists(path.join(target, name))) taken.push(name);
  if (taken.length && !force) {
    console.error(`${taken.join(' et ')} ${taken.length > 1 ? 'existent' : 'existe'} déjà dans ${target} : rien n'est écrit (un cahier rempli serait perdu ; --force pour le remplacer).`);
    process.exitCode = 1;
    return;
  }
  await mkdir(target, { recursive: true });
  for (const [name, body] of Object.entries(files)) await writeFile(path.join(target, name), body, 'utf8');
  const count = (flag: string) => TYPES.filter((t) => typeFlags(t).some((f) => f.flag === flag)).length;
  console.log([
    `Écrit dans ${target} :`,
    `  types.csv : ${TYPES.length} types de src/db/registry.ts`,
    `  fonctions.csv : ${FUNCTIONS.length} fonctions de src/db/seed-org.ts et leurs titulaires de démonstration`,
    'Types liés à une question ouverte (colonne « Question liée ») :',
    `  sans durée (O-07) : ${count('no_years')}`,
    `  conservation à la fin du projet (question 3 du registre) : ${count('project_end')}`,
    `  admettent « Public » (O-08) : ${count('public')}`,
    `  code aussi celui d'un département (question 1 du registre) : ${count('code_clash')}`,
    `  sans circuit (O-06) : ${count('no_circuit')}`,
    'Colonnes « Validé (oui/non) », « Correction » (et « Nouveau code (renommage) » pour les types) laissées vides.',
    'Contrôle d\'un cahier rempli : npm run registry:review -- --check <cahier.csv>',
  ].join('\n'));
}

async function checkWorkbooks(paths: string[], orgPath?: string) {
  const refs: ReviewRefs = {};
  if (orgPath) {
    const org = checkOrgCsv(await readFile(orgPath, 'utf8'));
    if (!orgOk(org)) console.log(`Organigramme ${orgPath} : ${org.errors.length + org.duplicates.length + org.collisions.length} problème(s), voir npm run org:check -- ${orgPath}`);
    refs.people = org.people.map((p) => p.id);
    refs.departments = org.departments.map((d) => d.code);
  }
  const texts = await Promise.all(paths.map(async (p) => ({ path: p, text: await readFile(p, 'utf8') })));
  const kinds = texts.map((x) => ({ ...x, kind: workbookKind(x.text) }));
  const functionsBook = kinds.find((x) => x.kind === 'functions');
  if (functionsBook) refs.functions = functionKeysOf(functionsBook.text);
  let failed = false;
  for (const x of kinds) {
    if (!x.kind) {
      console.log(`${x.path} : ni cahier de types ni cahier de fonctions (en-tête inconnu).`);
      failed = true;
      continue;
    }
    const report = x.kind === 'types' ? checkTypesWorkbook(x.text, refs) : checkFunctionsWorkbook(x.text, refs);
    console.log(reportLines(report, x.path).join('\n'));
    if (report.errors.length) failed = true;
  }
  console.log('Rien n\'a été écrit (ni base, ni registre, ni cahier).');
  if (failed) process.exitCode = 1;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  if (opts.out) await writeWorkbooks(opts.out, opts.force);
  else await checkWorkbooks(opts.checks, opts.org);
}

main().catch((err) => {
  console.error(`Erreur : ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
