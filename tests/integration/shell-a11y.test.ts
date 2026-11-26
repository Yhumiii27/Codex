import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import RootLayout from '@/app/layout';
import { activeScreen } from '@/components/shell/Sidebar';
import type { Lang } from '@/lib/i18n';
import { translate } from '@/i18n';
import { setupDb } from '../support/db';
import { actAs, setLangCookie } from '../support/session';

// The shell every screen sits in (src/app/layout.tsx), for keyboard and screen reader users (point 55 of
// docs/reste-a-faire.md, docs/accessibilite.md), now the common shell of Norma 2.0 (norma/charte/COQUE.md): « Aller au
// contenu » first in the page, towards <main id="main-content">; a named sidebar that leads to the help (/aide); no
// header bar above the screens (each screen renders its own header, its <h1>). `npm run a11y` checks in a browser that
// the link shows when focused and moves the focus.

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));
vi.mock('next/server', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/server')>()), connection: async () => {} }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children) }));
// The router of the browser: the shell is rendered as for /aide.
vi.mock('next/navigation', () => ({ usePathname: () => '/aide', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push() {}, replace() {}, refresh() {} }) }));
// next/font/local is compiled by Next.js only.
vi.mock('@/fonts/inter', () => ({ interClassName: 'inter' }));

setupDb();

async function shell(lang: Lang, screen?: () => Promise<ReactNode>): Promise<string> {
  actAs('owner');
  setLangCookie(lang);
  const children = screen ? await screen() : createElement('p', null, 'ÉCRAN');
  const el = await RootLayout({ children, params: Promise.resolve({}) } as Parameters<typeof RootLayout>[0]);
  return renderToStaticMarkup(el as ReactElement);
}

describe('Shell: skip link, landmarks, help', () => {
  it.each(['fr', 'en'] as const)('in %s, starts with the skip link to <main id="main-content">, which holds the screen', async (lang) => {
    const html = await shell(lang);
    const body = html.slice(html.indexOf('<body'));
    // First element of the body, so the first stop of the Tab key.
    expect(body).toMatch(new RegExp(`^<body[^>]*><a href="#main-content" class="coque-skip">${translate(lang, 'Skip to main content')}</a>`));
    // The top bar of 1 024 px or less comes first in <main> (hidden wider), then the screen.
    expect(html).toMatch(/<main id="main-content" tabindex="-1" class="coque-main"><div class="coque-topbar"[^]*?<\/div><p>ÉCRAN<\/p><\/main>/);
    expect(html.match(/id="main-content"/g)).toHaveLength(1);
    expect(html).toContain(`<html lang="${lang}"`);
  });

  it.each(['fr', 'en'] as const)('in %s, names the sidebar, links to the help as the current page, and leaves the <h1> to the screen', async (lang) => {
    const html = await shell(lang);
    expect(html).toMatch(new RegExp(`<aside id="coque-sidebar" class="coque-side" aria-label="${translate(lang, 'Main menu')}"`));
    expect(html).toMatch(new RegExp(`<a [^>]*href="/aide"[^>]*aria-current="page"[^>]*>.*?${translate(lang, 'Help')}</span></a>`));
    // No header bar of its own: the title of each screen is its PageHeader's <h1>.
    expect(html).not.toMatch(/<h1/);
    expect(html).not.toMatch(/<header/);
    // The language over display pair of the top bar, last: FR | EN above dark | light (Norma 2.0).
    const prefs = html.slice(html.indexOf('<div class="coque-prefs"'));
    expect(prefs).toMatch(new RegExp(`^<div class="coque-prefs" data-print-hide="true"><div role="group" aria-label="${translate(lang, 'Language')}" class="coque-pref">`));
    expect(prefs.indexOf(`aria-label="${translate(lang, 'Dark / light display')}"`)).toBeGreaterThan(prefs.indexOf('>EN</button>'));
  });

  it('renders a screen\'s <h1> in its common header', async () => {
    const { default: HelpPage } = await import('@/app/aide/page');
    const html = await shell('fr', HelpPage);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`<header class="coque-header">[^]*<h1 class="coque-title">${translate('fr', 'Using Codex')}</h1>`));
  });

  it('takes /aide for the help screen, and no other path', () => {
    expect(activeScreen('/aide')).toBe('help');
    expect(activeScreen('/aide/')).toBe('help');
    expect(activeScreen('/aides')).toBe('home');
    expect(activeScreen('/documents/AIDE-1')).toBe('document');
  });
});
