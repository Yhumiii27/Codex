#!/usr/bin/env node
// @ts-check
// Does the Node.js running this script satisfy "engines.node" of package.json (point 43 of docs/reste-a-faire.md)?
//
//   node scripts/codex-node-check.mjs          exit status 0 when it does, 1 (with a message) when it does not
//
// Used by desktop/build-app.sh, which picks the first `node` it finds for the Mac app; .nvmrc gives the reference
// version (the one of the CI). Only the forms package.json uses are understood: ranges joined by "||", each "^x.y.z",
// ">=x.y.z" or an exact "x.y.z". Anything else is refused rather than guessed (exit status 2).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** @param {string} v "22.12.0", "v22.12.0" → [22, 12, 0]; null when it is not such a version. */
export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** @param {number[]} a @param {number[]} b */
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * Does `version` satisfy `range`? Throws on a form it does not understand.
 * @param {string} version
 * @param {string} range
 */
export function satisfies(version, range) {
  const v = parseVersion(version);
  if (!v) throw new Error(`version not understood: ${version}`);
  return range.split('||').some((part) => {
    const p = part.trim();
    let m;
    if ((m = /^\^(\S+)$/.exec(p))) {
      const min = parseVersion(m[1]);
      if (!min) throw new Error(`range not understood: ${p}`);
      // ^x.y.z with x ≥ 1: same major, at least x.y.z (the only caret form engines uses).
      return v[0] === min[0] && cmp(v, min) >= 0;
    }
    if ((m = /^>=\s*(\S+)$/.exec(p))) {
      const min = parseVersion(m[1]);
      if (!min) throw new Error(`range not understood: ${p}`);
      return cmp(v, min) >= 0;
    }
    const exact = parseVersion(p);
    if (!exact) throw new Error(`range not understood: ${p}`);
    return cmp(v, exact) === 0;
  });
}

function main() {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const range = pkg.engines?.node;
  if (!range) return;
  let ok;
  try {
    ok = satisfies(process.versions.node, range);
  } catch (err) {
    console.error(`codex-node-check : ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 2;
    return;
  }
  if (!ok) {
    console.error(`Node.js ${process.versions.node} (${process.execPath}) ne convient pas : Codex demande ${range} (package.json, « engines »). Version de référence : .nvmrc.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
