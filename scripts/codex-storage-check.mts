// Tries the active file store end to end, without the database (lib/storage-check.ts):
//
//   npm run storage:check            the store CODEX_STORAGE names (local by default, sharepoint when set)
//   npm run storage:check -- --dev   with the variables of `next dev` (.env.development…)
//
// A test file is uploaded under a provisional name (_staging on SharePoint), named, read whole, read by byte range, then
// removed. Nothing in the database changes, so the server may run meanwhile. Made to try SharePoint on a tenant before
// enabling it (docs/exploitation.md, « Essayer SharePoint sur un tenant »); O-01 (docs/decisions.md) is not decided and
// CODEX_STORAGE stays local by default. Variables are read as Next reads them (@next/env). Exit status: 0 every step
// passed, 1 a step failed, 2 a wrong usage.

import nextEnv from '@next/env';

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== '--dev');
if (unknown.length) {
  console.error(`Option inconnue : ${unknown.join(' ')}\nUsage : npm run storage:check [-- --dev]`);
  process.exit(2);
}
const DEV = args.includes('--dev') || process.env.NODE_ENV === 'development';
nextEnv.loadEnvConfig(process.cwd(), DEV, { info: () => {}, error: (...a: unknown[]) => console.error(...a) });

// Imported once the variables are loaded: src/db reads CODEX_DATA_DIR when it is loaded.
const { checkStorage, STEP_LABELS } = await import('../src/lib/storage-check');

const result = await checkStorage();
console.log(result.store === 'sharepoint' ? 'Essai du stockage SharePoint (Microsoft Graph)' : 'Essai du stockage local');
for (const s of result.steps) {
  console.log(`  ${s.ok ? 'ok    ' : 'ÉCHEC '} ${STEP_LABELS[s.step].padEnd(30)} ${String(s.ms).padStart(6)} ms  ${s.detail}`);
}
if (result.leftover.length) console.log(`Fichier d'essai resté dans le stockage (à supprimer à la main) : ${result.leftover.join(', ')}`);
if (result.ok) {
  console.log(result.store === 'sharepoint'
    ? 'Le stockage SharePoint fonctionne pour Codex. Il reste désactivé tant que CODEX_STORAGE n\'est pas « sharepoint » au démarrage du serveur.'
    : 'Le stockage local fonctionne.');
} else {
  console.log('Échec : voir l\'étape marquée ÉCHEC ci-dessus. Rien n\'a été changé dans la base.');
}
process.exit(result.ok ? 0 : 1);
