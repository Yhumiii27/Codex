import { describe, expect, it, vi } from 'vitest';
import { classify, DEFAULT_GRACE_HOURS, graceHours, isCodexKey } from '@/lib/orphans';

// Rules of the orphan check (src/lib/orphans.ts, point 36 of docs/reste-a-faire.md); tests/integration/orphans.test.ts
// runs it on a real directory.

const HOUR = 3_600_000;
const NOW = Date.parse('2026-10-15T08:00:00Z');
const K = (n: number, name = 'upload.pdf') => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}-${name}`;

describe('graceHours', () => {
  it('is 24 h by default, whole hours otherwise, never under one hour', () => {
    expect(graceHours({})).toBe(DEFAULT_GRACE_HOURS);
    expect(DEFAULT_GRACE_HOURS).toBe(24);
    expect(graceHours({ CODEX_ORPHAN_GRACE_HOURS: ' 72 ' })).toBe(72);
    expect(graceHours({ CODEX_ORPHAN_GRACE_HOURS: '0' })).toBe(1);
  });

  it('falls back to 24 h for a value that is not a whole number of hours', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const v of ['1.5', '-3', 'abc', '24h']) expect(graceHours({ CODEX_ORPHAN_GRACE_HOURS: v }), v).toBe(24);
    expect(warn).toHaveBeenCalledTimes(4);
    warn.mockRestore();
  });
});

describe('isCodexKey', () => {
  it('knows the local names Codex gives, and nothing else', () => {
    expect(isCodexKey('local', '0a752ce3-b5e7-4330-a981-49c483e9655e-CTR-JUR-0001_A.7.pdf')).toBe(true);
    expect(isCodexKey('local', '0a752ce3-b5e7-4330-a981-49c483e9655e-upload.pdf')).toBe(true);
    for (const k of ['.DS_Store', 'tpl-modele', '0a752ce3-b5e7-4330-a981-49c483e9655e', 'note.txt', '0A752CE3-B5E7-4330-A981-49C483E9655E-x']) expect(isCodexKey('local', k), k).toBe(false);
    // SharePoint: driveItem ids of _staging, where only Codex writes.
    expect(isCodexKey('sharepoint', '01ABCDEF')).toBe(true);
  });
});

describe('classify', () => {
  const grace = 24 * HOUR;

  it('keeps referenced, recent and foreign files out of the orphans', () => {
    const files = [
      { key: K(1), size: 10, touched: NOW - 48 * HOUR }, // named by a record
      { key: K(2), size: 20, touched: NOW - 30 * HOUR }, // orphan
      { key: K(3), size: 30, touched: NOW - 2 * HOUR }, // too recent
      { key: K(4), size: 40, touched: NOW - 72 * HOUR }, // orphan, older
      { key: '.DS_Store', size: 6, touched: NOW - 99 * HOUR },
      { key: K(5), size: 50, touched: NOW - grace }, // exactly the grace period: old enough
    ];
    const r = classify('local', files, new Set([K(1)]), NOW, grace);
    expect(r.orphans.map((f) => f.key)).toEqual([K(4), K(2), K(5)]);
    expect(r).toMatchObject({ store: 'local', bytes: 110, recent: 1, foreign: 1 });
  });

  it('keeps a file named by a record however old it is', () => {
    expect(classify('local', [{ key: K(1), size: 1, touched: 0 }], new Set([K(1)]), NOW, grace).orphans).toEqual([]);
  });
});
