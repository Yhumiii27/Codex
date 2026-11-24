import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DICT } from '@/lib/i18n';
import { THEME_COOKIE, themeCookie, themeFromCookies, themeOf } from '@/lib/theme';

// Dark / light display (Norma 1.0, owner 24 November 2026): the epc2i-theme cookie, read by the server (app/layout.tsx)
// which sets data-theme on <html>, and the header's toggle right of the FR / EN switch.

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

describe('header toggle', () => {
  it('sits right of the language switch', () => {
    const src = readFileSync(new URL('../../src/components/shell/Header.tsx', import.meta.url), 'utf8');
    const lang = src.indexOf('name="lang"');
    const toggle = src.indexOf('<ThemeToggle theme={theme} />');
    const bell = src.indexOf('aria-label={t.notif}');
    expect(lang).toBeGreaterThan(0);
    expect(toggle).toBeGreaterThan(lang);
    expect(bell).toBeGreaterThan(toggle);
    // Nothing else between the end of the language switch and the toggle.
    const between = src.slice(src.indexOf('/>', lang) + 2, toggle).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').trim();
    expect(between).toBe('');
  });

  it('is named in both languages', () => {
    expect([DICT.fr.theme_group, DICT.fr.theme_dark, DICT.fr.theme_light]).toEqual(['Affichage', 'Affichage sombre', 'Affichage clair']);
    expect([DICT.en.theme_group, DICT.en.theme_dark, DICT.en.theme_light]).toEqual(['Display', 'Dark display', 'Light display']);
  });

  it('applies the light values of Norma', () => {
    const own = readFileSync(new URL('../../src/app/nocturne.css', import.meta.url), 'utf8');
    const norma = readFileSync(new URL('../../norma/charte/nocturne.css', import.meta.url), 'utf8');
    const block = (css: string) => css.slice(css.indexOf(':root { color-scheme: dark; }'));
    expect(block(own).length).toBeGreaterThan(100);
    expect(block(own)).toBe(block(norma));
  });
});
