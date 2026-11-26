import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FR, SAME_IN_FRENCH } from '@/i18n/fr';
import { translate } from '@/i18n';

// English source strings (Norma § 2, CX-N01): every literal given to tr(), translate(lang, …) or msg() in src/, and to
// t() in the charte components Codex imports, has a French entry different from the source (or is listed as the same
// word in French); every French entry is used.

const ROOT = join(__dirname, '..', '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|mts)$/.test(n) ? [p] : [];
  });
}

const LITERAL = String.raw`'((?:[^'\\]|\\.)+)'`;
const CALLS = [new RegExp(String.raw`\btr\(\s*` + LITERAL, 'g'), new RegExp(String.raw`\btranslate\(\s*[\w.]+,\s*` + LITERAL, 'g'), new RegExp(String.raw`\bmsg\(\s*` + LITERAL, 'g')];

function sources(): Map<string, string> {
  const found = new Map<string, string>();
  const read = (p: string, patterns: RegExp[]) => {
    const text = readFileSync(p, 'utf8');
    // msg() and translate() are this module's only when the file imports it (other modules have their own msg()).
    const own = /from '(@\/i18n|[./]*src\/i18n\/index)'/.test(text);
    for (const re of patterns.filter((x, i) => i === 0 || own || patterns.length === 1)) for (const m of text.matchAll(re)) found.set(m[1].replace(/\\'/g, "'"), p);
  };
  for (const p of [...files(join(ROOT, 'src')), ...files(join(ROOT, 'scripts')).filter((p) => p.endsWith('.mts'))]) {
    if (p.endsWith(join('i18n', 'index.ts'))) continue;
    read(p, CALLS);
  }
  // Charte components used by Codex, and those they import in turn (PageHeader → HeaderActions, HeaderTools…): their
  // t('…') labels go to Codex's dictionary (norma/charte/README.md).
  const used = new Set<string>();
  const todo: string[] = [];
  const take = (name: string) => { if (!used.has(name)) { used.add(name); todo.push(name); } };
  for (const p of files(join(ROOT, 'src'))) for (const m of readFileSync(p, 'utf8').matchAll(/@norma\/charte\/ds\/(\w+)/g)) take(m[1]);
  while (todo.length) {
    const name = todo.pop()!;
    const p = join(ROOT, 'norma', 'charte', 'ds', `${name}.tsx`);
    let text: string;
    try { text = readFileSync(p, 'utf8'); } catch { continue; /* a .ts module without labels */ }
    read(p, [new RegExp(String.raw`\bt\(\s*` + LITERAL, 'g')]);
    for (const m of text.matchAll(/from '\.\/(\w+)'/g)) take(m[1]);
  }
  return found;
}

describe('English source strings', () => {
  const found = sources();

  it('finds the shell’s sources', () => {
    expect(found.has('Go to a page…')).toBe(true);
    expect(found.has('Main menu')).toBe(true);
    // Followed through PageHeader: the « Actions » menu and the language / display pair (Norma 2.0).
    expect(found.has('Actions')).toBe(true);
    expect(found.has('Language')).toBe(true);
  });

  it('every source has its French, different from the English unless listed as the same word', () => {
    const missing = [...found.keys()].filter((s) => !(s in FR) && !SAME_IN_FRENCH.includes(s));
    expect(missing).toEqual([]);
    const same = Object.entries(FR).filter(([en, fr]) => en === fr).map(([en]) => en);
    expect(same).toEqual([]);
  });

  it('every French entry is used', () => {
    expect(Object.keys(FR).filter((s) => !found.has(s))).toEqual([]);
    expect(SAME_IN_FRENCH.filter((s) => !found.has(s))).toEqual([]);
  });

  it('French is the default; English gives the source; variables are filled', () => {
    expect(translate('fr', 'Close')).toBe('Fermer');
    expect(translate('en', 'Close')).toBe('Close');
    expect(translate('fr', 'Not in the dictionary {n}', { n: 3 })).toBe('Not in the dictionary 3');
    // A context after # tells two French apart and never shows (« Approuver » the button, « Valider » the permission).
    expect(translate('fr', 'Approve')).toBe('Approuver');
    expect(translate('fr', 'Approve#permission')).toBe('Valider');
    expect(translate('en', 'Approve#permission')).toBe('Approve');
    expect(translate('fr', 'Not in the dictionary#context')).toBe('Not in the dictionary');
  });
});
