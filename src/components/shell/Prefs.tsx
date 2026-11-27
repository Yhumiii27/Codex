'use client';

import { PrefsStack } from '@norma/charte/ds/HeaderTools';
import { setLang } from '@/lib/actions';
import { useApp } from './AppProvider';

/**
 * Language over display (Norma 2.0, norma/charte/COQUE.md § 4): FR | EN above dark | light, same size, left edges
 * aligned — the last element of every page header, and of the top bar at 1 024 px or less. The language is the codex-lang
 * cookie (lib/actions.ts setLang, which refreshes the page itself); the display the suite's atrium-theme cookie.
 */
export function Prefs() {
  const { lang, theme } = useApp();
  return <PrefsStack lang={lang} theme={theme} onSelect={setLang} refresh={false} />;
}
