// Dark / light display (Norma 1.0, owner 24 November 2026): the suite's convention, taken from Norma's pure module
// (norma/charte/ds/theme.ts) — one cookie for every tool (epc2i-theme, dark | light, one year), read by the server, which
// sets data-theme on <html> at render (no flash); the header's toggle (components/shell/ThemeToggle.tsx) changes both in
// the browser. Dark stays the default. The light values are the block at the end of src/app/nocturne.css.
import { THEME_COOKIE, themeOf, type Theme } from '@norma/charte/ds/theme';

export { DEFAULT_THEME, THEME_COOKIE, THEMES, themeCookie, themeOf, type Theme } from '@norma/charte/ds/theme';

/** The theme of a request, from its cookies (any other value, or none: the default, dark). */
export function themeFromCookies(jar: { get(name: string): { value: string } | undefined }): Theme {
  return themeOf(jar.get(THEME_COOKIE)?.value);
}
