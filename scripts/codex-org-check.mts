// Check of an org chart given as CSV (O-04 of docs/decisions.md; model: docs/modeles/organigramme.csv):
//
//   npm run org:check -- <organigramme.csv>
//
// Rules of src/lib/org-rules.ts and src/lib/registry-rules.ts (codes, labels), collisions with the type codes of
// src/db/registry.ts, duplicates, unknown references (src/lib/org-review.ts). No database is opened and nothing is
// written: the file is to be typed into Administration › Organisation, or to replace the provisional values of
// src/db/seed-org.ts, once the user has decided. Exit status: 0 when the file passes, 1 on a problem, 2 on a wrong usage.

import { readFile } from 'node:fs/promises';
import { checkOrgCsv, orgOk, orgReportLines } from '../src/lib/org-review';

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0].startsWith('--')) {
    console.error('Usage : npm run org:check -- <organigramme.csv>');
    process.exitCode = 2;
    return;
  }
  const report = checkOrgCsv(await readFile(args[0], 'utf8'));
  console.log(orgReportLines(report, args[0]).join('\n'));
  if (!orgOk(report)) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`Erreur : ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
