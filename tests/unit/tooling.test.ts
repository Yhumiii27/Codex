import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCEPTED, advisoriesOf, verdict } from '../../scripts/codex-audit.mjs';
import { parseVersion, satisfies } from '../../scripts/codex-node-check.mjs';

// Points 43 and 52 of docs/reste-a-faire.md: the Node.js version (engines, .nvmrc, @types/node) and the audit of the
// dependencies in the CI.

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

describe('Node.js version (scripts/codex-node-check.mjs)', () => {
  it('reads versions with or without a v', () => {
    expect(parseVersion('v22.12.0')).toEqual([22, 12, 0]);
    expect(parseVersion('20.19.3')).toEqual([20, 19, 3]);
    expect(parseVersion('22')).toBeNull();
  });

  it('applies the range of engines', () => {
    const range = pkg.engines.node;
    expect(range).toBe('^20.19.0 || >=22.12.0');
    for (const ok of ['20.19.0', '20.20.1', '22.12.0', '22.22.0', '24.1.0', '26.0.0']) expect(satisfies(ok, range), ok).toBe(true);
    for (const no of ['18.20.0', '20.18.9', '21.7.0', '22.11.0']) expect(satisfies(no, range), no).toBe(false);
  });

  it('refuses a form it does not understand rather than guess', () => {
    expect(() => satisfies('22.0.0', '~22.1')).toThrow();
    expect(() => satisfies('22.0.0', '22.x')).toThrow();
  });

  it('keeps .nvmrc and @types/node on one version that engines admits', () => {
    const ref = readFileSync(new URL('../../.nvmrc', import.meta.url), 'utf8').trim();
    expect(ref).toMatch(/^\d+$/);
    const types = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.devDependencies['@types/node']);
    expect(types?.[1]).toBe(ref);
    expect(satisfies(`${types![1]}.${types![2]}.${types![3]}`, pkg.engines.node)).toBe(true);
    // The CI runs the reference version, and the tests on the lowest version engines admits.
    const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
    expect(ci).toContain('node-version-file: .nvmrc');
    expect(ci).toContain('node-version: 20.19.0');
  });
});

describe('Audit of the dependencies (scripts/codex-audit.mjs)', () => {
  const report = (vulns: Record<string, { severity: string; via: unknown[] }>) => ({ vulnerabilities: vulns });
  const adv = (url: string, severity: string, title = 'x') => ({ url, severity, title, source: 1 });

  it('gathers one advisory per URL with the packages it reaches', () => {
    const list = advisoriesOf(report({
      braces: { severity: 'high', via: [adv('https://a/1', 'high')] },
      micromatch: { severity: 'high', via: ['braces'] },
      other: { severity: 'high', via: [adv('https://a/1', 'high')] },
    }));
    expect(list).toEqual([{ url: 'https://a/1', title: 'x', severity: 'high', packages: ['braces', 'other'] }]);
    expect(() => advisoriesOf({})).toThrow();
  });

  it('fails on a high advisory of the application, even one accepted for the tools', () => {
    const a = { url: 'https://a/1', title: 'x', severity: 'high', packages: ['p'] };
    expect(verdict([a], [a], { 'https://a/1': 'why' }).fatal).toEqual([a]);
  });

  it('fails on a high advisory of a tool unless accepted; moderate ones are only listed', () => {
    const high = { url: 'https://a/2', title: 'x', severity: 'critical', packages: ['t'] };
    const mid = { url: 'https://a/3', title: 'y', severity: 'moderate', packages: ['u'] };
    expect(verdict([], [high, mid], {}).fatal).toEqual([high]);
    const ok = verdict([], [high, mid], { 'https://a/2': 'why' });
    expect(ok.fatal).toEqual([]);
    expect(ok.accepted).toEqual([high]);
    expect(ok.other).toEqual([mid]);
  });

  it('accepts only advisories with a reason', () => {
    for (const [url, why] of Object.entries(ACCEPTED)) {
      expect(url).toMatch(/^https:\/\/github\.com\/advisories\/GHSA-/);
      expect(why.length).toBeGreaterThan(10);
    }
  });
});
