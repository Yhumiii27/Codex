// Dark / light display (Norma 1.0, owner 24 November 2026; cookie renamed by Norma 3.0, suite Atrium): the suite's
// convention, taken from Norma's pure module (norma/charte/ds/theme.ts) — one cookie for every tool (atrium-theme,
// dark | light, one year; the former name is still read when the new one is absent, never written), read by the server,
// which sets data-theme on <html> at render (no flash); the header's switch (PrefsStack of the charte) changes both in the
// browser. Dark stays the default. The light values are the block at the end of src/app/nocturne.css.
import { themeFromCookies as fromCookies, type Theme } from '@norma/charte/ds/theme';

export {
  DEFAULT_THEME, LEGACY_THEME_COOKIE, THEME_COOKIE, THEME_COOKIES_READ, THEMES, themeCookie, themeOf, type Theme,
} from '@norma/charte/ds/theme';

/** The theme of a request, from its cookies: atrium-theme, else the former name, else the default (dark). */
export function themeFromCookies(jar: { get(name: string): { value: string } | undefined }): Theme {
  return fromCookies((name) => jar.get(name)?.value);
}
