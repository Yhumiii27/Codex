#!/usr/bin/env node
// @ts-check
// Measures the main screens and routes of a running Codex (point 56 of docs/reste-a-faire.md, docs/performances.md):
//
//   npm run perf [-- --base http://localhost:3100] [--runs 5] [--as cbardet:gestionnaire,synth00001:collaborateur]
//                [--doc <ID>] [--json <file>] [--label <text>] [--parallel 10]
//
// Each route is fetched once to warm it up, then --runs times, one request at a time, for each person and simulated
// role of --as (cookies codex-user, codex-role, codex-lang, as the profile menu sets them); the time is the whole
// answer, body read to its end. Then, for the first person, --parallel requests of a few routes sent at once (default
// 10; 0 skips it): how long the last one takes to come back, which tells whether the database serves them side by side
// (a PostgreSQL server's pool) or one after the other (PGlite's one connection). Prints a Markdown table (median, slowest, size, status) and, with --json, writes every
// measure to a file. Run it against `npm run start` (a production build) on the database to measure (npm run
// seed:large, then CODEX_DATA_DIR=.data-large or DATABASE_URL=…), with CODEX_RATE_LIMIT=off so that the exports are not
// limited. Reads nothing but what the routes answer; journals what they journal (consultations, exports).

import { writeFile } from 'node:fs/promises';

/** @param {string[]} argv */
function parse(argv) {
  const a = { base: 'http://localhost:3100', runs: 5, parallel: 10, as: 'cbardet:gestionnaire,synth00001:collaborateur', doc: '', json: '', label: '' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[++i];
    if (v === undefined) throw new Error(`${k} attend une valeur`);
    if (k === '--base') a.base = v.replace(/\/$/, '');
    else if (k === '--runs') a.runs = Math.max(1, Math.min(100, Number(v) || 5));
    else if (k === '--as') a.as = v;
    else if (k === '--doc') a.doc = v;
    else if (k === '--parallel') a.parallel = Math.max(0, Math.min(200, Number(v) || 0));
    else if (k === '--json') a.json = v;
    else if (k === '--label') a.label = v;
    else throw new Error(`option inconnue : ${k}`);
  }
  return a;
}

/** The routes measured: screens (server rendering, whole HTML) and the CSV exports. `{doc}` is a document's ID. */
const ROUTES = [
  ['Accueil', '/'],
  ['Recherche, sans critère', '/recherche'],
  ['Recherche « soudure »', '/recherche?q=soudure'],
  ['Recherche, filtre Confidentiel', '/recherche?conf=confidentiel'],
  ['Recherche, page 20', '/recherche?page=20'],
  ['Explorateur', '/explorateur'],
  ['Fiche document', '/documents/{doc}'],
  ['Validations', '/validations'],
  ['Archivage', '/archivage'],
  ['Département QUA', '/departements/QUA'],
  ['Administration › Journal', '/administration?tab=audit'],
  ['Export CSV de la recherche « soudure »', '/api/export/search?q=soudure'],
  ['Export CSV de la recherche, tout', '/api/export/search'],
  ['Santé (/api/health)', '/api/health'],
];

/**
 * @param {string} url
 * @param {string} cookie
 * @returns {Promise<{ ms: number, status: number, bytes: number, body: string }>}
 */
async function timed(url, cookie) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { cookie }, redirect: 'manual' });
  const body = await res.text();
  return { ms: performance.now() - t0, status: res.status, bytes: Buffer.byteLength(body), body };
}

/** @param {number[]} xs */
const median = (xs) => {
  const s = [...xs].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
/** @param {number} n */
const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} Mo` : `${Math.round(n / 1024)} Ko`).replace('.', ',');
/** @param {number} ms */
const msText = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`).replace('.', ',');

async function main() {
  const a = parse(process.argv.slice(2));
  const people = a.as.split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
    const [user, role] = x.split(':');
    return { user, role: role || '' };
  });
  const health = await fetch(`${a.base}/api/health`).then((r) => r.json()).catch(() => null);
  if (!health) throw new Error(`aucun serveur Codex ne répond sur ${a.base}`);
  /** @type {{ person: string, label: string, path: string, status: number, bytes: number, ms: number[] }[]} */
  const results = [];
  /** @type {{ label: string, path: string, n: number, single: number, wall: number, statuses: number[] }[]} */
  const parallel = [];
  let firstDoc = '';
  for (const p of people) {
    const cookie = `codex-user=${encodeURIComponent(p.user)}; codex-lang=fr${p.role ? `; codex-role=${encodeURIComponent(p.role)}` : ''}`;
    let doc = a.doc;
    if (!doc) {
      // A document this person may read: the first line of the search export.
      const csv = (await timed(`${a.base}/api/export/search?q=soudure`, cookie)).body;
      doc = csv.split('\n')[1]?.split(/[;,]/)[0]?.replace(/^"|"$/g, '') ?? '';
    }
    firstDoc ||= doc;
    for (const [label, route] of ROUTES) {
      const path = route.replace('{doc}', encodeURIComponent(doc));
      await timed(a.base + path, cookie);
      /** @type {number[]} */
      const ms = [];
      let last = { status: 0, bytes: 0 };
      for (let i = 0; i < a.runs; i++) {
        const r = await timed(a.base + path, cookie);
        ms.push(r.ms);
        last = r;
      }
      results.push({ person: `${p.user}${p.role ? ` (${p.role})` : ''}`, label, path, status: last.status, bytes: last.bytes, ms });
      process.stderr.write('.');
    }
  }
  if (a.parallel && people.length) {
    const p = people[0];
    const cookie = `codex-user=${encodeURIComponent(p.user)}; codex-lang=fr${p.role ? `; codex-role=${encodeURIComponent(p.role)}` : ''}`;
    for (const [label, route] of [['Recherche « soudure »', '/recherche?q=soudure'], ['Fiche document', `/documents/${encodeURIComponent(firstDoc)}`], ['Validations', '/validations']]) {
      const single = median([await timed(a.base + route, cookie), await timed(a.base + route, cookie), await timed(a.base + route, cookie)].map((r) => r.ms));
      const t0 = performance.now();
      const all = await Promise.all(Array.from({ length: a.parallel }, () => timed(a.base + route, cookie)));
      parallel.push({ label, path: route, n: a.parallel, single, wall: performance.now() - t0, statuses: [...new Set(all.map((r) => r.status))] });
      process.stderr.write('.');
    }
  }
  process.stderr.write('\n');
  const lines = [
    `Mesures ${a.label ? `« ${a.label} » ` : ''}sur ${a.base}, ${a.runs} requêtes par route après une de chauffe, le ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
    '',
    '| Personne | Route | Médiane | Plus lente | Taille | Statut |',
    '| --- | --- | ---: | ---: | ---: | :---: |',
    ...results.map((r) => `| ${r.person} | ${r.label} (\`${r.path}\`) | ${msText(median(r.ms))} | ${msText(Math.max(...r.ms))} | ${kb(r.bytes)} | ${r.status} |`),
  ];
  if (parallel.length) {
    lines.push('', `Requêtes simultanées (${people[0].user}) : durée jusqu'à la dernière réponse, comparée à une requête seule (médiane de 3).`, '',
      '| Route | Seule | Simultanées | Toutes reçues en | Rapport | Statuts |', '| --- | ---: | ---: | ---: | ---: | :---: |',
      ...parallel.map((x) => `| ${x.label} (\`${x.path}\`) | ${msText(x.single)} | ${x.n} | ${msText(x.wall)} | ${(x.wall / x.single).toFixed(1).replace('.', ',')} | ${x.statuses.join(', ')} |`));
  }
  console.log(lines.join('\n'));
  if (a.json) await writeFile(a.json, `${JSON.stringify({ base: a.base, runs: a.runs, label: a.label, at: new Date().toISOString(), results, parallel }, null, 2)}\n`);
}

main().catch((err) => {
  console.error(`Erreur : ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
