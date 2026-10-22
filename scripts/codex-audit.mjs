#!/usr/bin/env node
// @ts-check
// Known vulnerabilities of the dependencies, for the CI (point 52 of docs/reste-a-faire.md):
//
//   npm run audit
//
// Two looks with `npm audit` (the registry's advisories for package-lock.json):
// - the dependencies the application runs with (--omit=dev): any advisory of high or critical severity fails;
// - all of them, development tools included: an advisory of high or critical severity fails too, unless it is in
//   ACCEPTED below, with why it is accepted. Only advisories with no fixed version and on a development tool may be
//   accepted; each is looked at again once a fix is published (`npm audit` then says "fix available").
// Moderate and low advisories are listed, never fatal. Exit status: 0 nothing to act on, 1 an advisory to act on, 2 the
// audit itself failed (registry out of reach, unreadable answer): a check that could not run never passes.

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Accepted advisories (GitHub advisory URL → why). Development tools only, with no fixed version published.
 * @type {Record<string, string>}
 */
export const ACCEPTED = {
  // braces ≤ 3.0.3 (3.0.3 is the last version published): eslint-config-next → @next/eslint-plugin-next → fast-glob →
  // micromatch → braces. Only `npm run lint` uses it, on the repository's own file patterns; nothing of the application
  // or of its users reaches it. Reviewed on 18 October 2026.
  'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm': 'braces : outil de lint seulement, aucune version corrigée publiée',
};

const FATAL = new Set(['high', 'critical']);

/**
 * @typedef {{ url: string, title: string, severity: string, packages: string[] }} Advisory
 */

/**
 * The advisories of an `npm audit --json` answer, one per URL, with the packages they reach.
 * @param {any} report
 * @returns {Advisory[]}
 */
export function advisoriesOf(report) {
  if (!report || typeof report !== 'object' || !report.vulnerabilities || typeof report.vulnerabilities !== 'object') {
    throw new Error('réponse de npm audit illisible');
  }
  /** @type {Map<string, Advisory>} */
  const by = new Map();
  for (const [name, v] of Object.entries(report.vulnerabilities)) {
    for (const via of /** @type {any[]} */ (v.via ?? [])) {
      if (typeof via !== 'object' || !via) continue;
      const url = String(via.url ?? via.source ?? name);
      const a = by.get(url) ?? { url, title: String(via.title ?? ''), severity: String(via.severity ?? v.severity ?? 'unknown'), packages: [] };
      if (!a.packages.includes(name)) a.packages.push(name);
      by.set(url, a);
    }
  }
  return [...by.values()].sort((a, b) => a.url.localeCompare(b.url));
}

/**
 * What to act on: in production, every fatal advisory; overall, every fatal one not accepted.
 * @param {Advisory[]} prod
 * @param {Advisory[]} all
 * @param {Record<string, string>} accepted
 */
export function verdict(prod, all, accepted = ACCEPTED) {
  const fatalProd = prod.filter((a) => FATAL.has(a.severity));
  const fatalDev = all.filter((a) => FATAL.has(a.severity) && !accepted[a.url] && !fatalProd.some((p) => p.url === a.url));
  const acceptedSeen = all.filter((a) => accepted[a.url] && !fatalProd.some((p) => p.url === a.url));
  // An accepted advisory that reaches the application is never accepted.
  return { fatal: [...fatalProd, ...fatalDev], accepted: acceptedSeen, other: all.filter((a) => !FATAL.has(a.severity)) };
}

/** @param {string[]} args @returns {Promise<any>} */
function npmAudit(args) {
  return new Promise((resolve, reject) => {
    // npm audit exits 1 when it finds something: the JSON answer is what counts.
    execFile('npm', ['audit', '--json', ...args], { maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' }, (err, stdout) => {
      try {
        const j = JSON.parse(stdout);
        if (j.error) return reject(new Error(`npm audit : ${j.error.summary ?? j.error.code ?? 'erreur'}`));
        resolve(j);
      } catch {
        reject(err ?? new Error('npm audit : réponse illisible'));
      }
    });
  });
}

/** @param {Advisory} a */
const line = (a) => `  - [${a.severity}] ${a.title} (${a.packages.join(', ')}) ${a.url}`;

async function main() {
  let prod, all;
  try {
    [prod, all] = await Promise.all([npmAudit(['--omit=dev']), npmAudit([])]).then(([p, a]) => [advisoriesOf(p), advisoriesOf(a)]);
  } catch (err) {
    console.error(`L'audit n'a pas pu se faire : ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 2;
    return;
  }
  const v = verdict(prod, all);
  console.log(`Dépendances de l'application : ${prod.length ? `${prod.length} avis` : 'aucun avis'} ; toutes dépendances : ${all.length ? `${all.length} avis` : 'aucun avis'}.`);
  if (v.accepted.length) console.log(`Acceptés (outils de développement sans correction publiée, scripts/codex-audit.mjs) :\n${v.accepted.map((a) => `${line(a)}\n      ${ACCEPTED[a.url]}`).join('\n')}`);
  if (v.other.length) console.log(`Gravité modérée ou faible, signalés seulement :\n${v.other.map(line).join('\n')}`);
  if (v.fatal.length) {
    console.error(`À traiter (gravité élevée ou critique) :\n${v.fatal.map(line).join('\n')}\nMettre à jour la dépendance (npm audit fix, ou une version corrigée dans package.json) ; une acceptation se justifie dans scripts/codex-audit.mjs.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
