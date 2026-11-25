import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { translate } from '@/i18n';
import { THEME_COOKIE, themeCookie, themeFromCookies, themeOf } from '@/lib/theme';

// Dark / light display (Norma 1.0, owner 24 November 2026): the epc2i-theme cookie, read by the server (app/layout.tsx)
// which sets data-theme on <html>, and the switch under the FR / EN one (Norma 2.0, PrefsStack) in every page header.

const jar = (value?: string) => ({ get: (name: string) => (name === THEME_COOKIE && value !== undefined ? { value } : undefined) });

describe('theme from the cookie', () => {
  it('is the cookie shared by every tool of the suite', () => {
    expect(THEME_COOKIE).toBe('epc2i-theme');
  });

  it('is dark by default, light only when asked', () => {
    expect(themeFromCookies(jar())).toBe('dark');
    expect(themeFromCookies(jar('light'))).toBe('light');
    expect(themeFromCookies(jar('dark'))).toBe('dark');
    for (const other of ['', 'LIGHT', 'sombre', 'auto']) expect(themeOf(other)).toBe('dark');
  });

  it('is kept a year for the whole site', () => {
    expect(themeCookie('light')).toBe('epc2i-theme=light; path=/; max-age=31536000; samesite=lax');
    expect(themeCookie('dark')).toMatch(/^epc2i-theme=dark; path=\/; max-age=31536000;/);
  });
});

describe('language over display (Norma 2.0, norma/charte/COQUE.md § 4)', () => {
  const src = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

  it('is the charte\'s PrefsStack, with Codex\'s language action, and nothing of the former toggles is left', () => {
    const prefs = src('src/components/shell/Prefs.tsx');
    expect(prefs).toMatch(/import \{ PrefsStack \} from '@norma\/charte\/ds\/HeaderTools'/);
    expect(prefs).toMatch(/<PrefsStack lang=\{lang\} theme=\{theme\} onSelect=\{setLang\}/);
    for (const gone of ['src/components/shell/ThemeToggle.tsx', 'src/components/shell/Header.tsx', 'src/components/ui/Seg.tsx']) {
      expect(() => src(gone)).toThrow();
    }
  });

  it('is the last element of every page header and of the top bar', () => {
    // Codex's PageHeader gives the pair as `prefs` of the charte's, which renders it last (HeaderTools).
    const header = src('src/components/shell/PageHeader.tsx');
    expect(header).toMatch(/prefs=\{<Prefs \/>\}/);
    const tools = src('norma/charte/ds/HeaderTools.tsx');
    expect(tools.indexOf('{prefs}', tools.indexOf('export function HeaderTools'))).toBeGreaterThan(tools.indexOf('{bell}', tools.indexOf('export function HeaderTools')));
    expect(src('src/components/shell/Shell.tsx')).toMatch(/<MobileTopBar name="Codex" logo=\{<ToolLogo code="codex" size=\{20\} \/>\} tools=\{<Bell \/>\} prefs=\{<Prefs \/>\} \/>/);
    // Never in the sidebar.
    expect(src('src/components/shell/Sidebar.tsx')).not.toMatch(/Prefs|ThemeSwitch|LangSwitch|setLang/);
  });

  it('every screen renders the common page header', () => {
    const screens = ['src/app/page.tsx', 'src/app/explorateur/page.tsx', 'src/app/recherche/page.tsx', 'src/app/departements/[code]/page.tsx',
      'src/app/documents/[id]/page.tsx', 'src/app/validations/page.tsx', 'src/app/archivage/page.tsx', 'src/app/archivage/DueTable.tsx',
      'src/app/administration/page.tsx', 'src/app/aide/page.tsx', 'src/app/not-found.tsx', 'src/app/error.tsx', 'src/components/ui/Forbidden.tsx'];
    for (const f of screens) expect(src(f), f).toMatch(/<PageHeader\b/);
  });

  it('is named in both languages', () => {
    const names = ['Language', 'Dark / light display', 'Dark display', 'Light display'];
    expect(names.map((x) => translate('fr', x))).toEqual(['Langue', 'Affichage', 'Affichage sombre', 'Affichage clair']);
    expect(names.map((x) => translate('en', x))).toEqual(names);
  });

  it('keeps src/app/nocturne.css the copy of Norma\'s, Inter from the repository aside', () => {
    const own = src('src/app/nocturne.css');
    const norma = src('norma/charte/nocturne.css');
    // Same file once the header comment and the two font stacks of next/font/local are set aside.
    const body = (css: string) => css.slice(css.indexOf(':root')).replace(/var\(--font-inter\), /g, '');
    expect(body(own)).toBe(body(norma));
    const block = (css: string) => css.slice(css.indexOf(':root { color-scheme: dark; }'));
    expect(block(own).length).toBeGreaterThan(100);
    // The tokens of Norma 2.0 the shell uses.
    for (const token of ['--text-title: 26px', '--shell-sidebar-w: 232px', '--pref-opt-w: 36px', '--pref-h: 26px', '--panel-w: 640px']) expect(own).toContain(token);
  });
});
