import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import RootLayout from '@/app/layout';
import { activeScreen } from '@/components/shell/Sidebar';
import { DICT, type Lang } from '@/lib/i18n';
import { setupDb } from '../support/db';
import { actAs, setLangCookie } from '../support/session';

// The shell every screen sits in (src/app/layout.tsx), for keyboard and screen reader users (point 55 of
// docs/reste-a-faire.md, docs/accessibilite.md): « Aller au contenu » first in the page, towards <main id="contenu">;
// a named navigation that leads to the help (/aide); the screen's name as the page's only <h1>. `npm run a11y` checks
// in a browser that the link shows when focused and moves the focus.

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children) }));
// The router of the browser: the shell is rendered as for /aide.
vi.mock('next/navigation', () => ({ usePathname: () => '/aide', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push() {}, replace() {}, refresh() {} }) }));
// next/font/local is compiled by Next.js only.
vi.mock('@/fonts/inter', () => ({ interClassName: 'inter' }));

setupDb();

async function shell(lang: Lang): Promise<string> {
  actAs('owner');
  setLangCookie(lang);
  const el = await RootLayout({ children: createElement('p', null, 'ÉCRAN'), params: Promise.resolve({}) } as Parameters<typeof RootLayout>[0]);
  return renderToStaticMarkup(el as ReactElement);
}

describe('Shell: skip link, landmarks, help', () => {
  it.each(['fr', 'en'] as const)('in %s, starts with the skip link to <main id="contenu">, which holds the screen', async (lang) => {
    const html = await shell(lang);
    const t = DICT[lang];
    const body = html.slice(html.indexOf('<body'));
    // First element of the body, so the first stop of the Tab key.
    expect(body).toMatch(new RegExp(`^<body[^>]*><a href="#contenu" class="skip-link">${t.skip_to_content}</a>`));
    expect(html).toMatch(/<main id="contenu" class="app-main" tabindex="-1"><p>ÉCRAN<\/p><\/main>/);
    expect(html.match(/id="contenu"/g)).toHaveLength(1);
    expect(html).toContain(`<html lang="${lang}"`);
  });

  it.each(['fr', 'en'] as const)('in %s, names the navigation, links to the help as the current page, and has one <h1>', async (lang) => {
    const html = await shell(lang);
    const t = DICT[lang];
    expect(html).toContain(`<nav class="nav `);
    expect(html).toMatch(new RegExp(`<nav [^>]*aria-label="${t.nav_label}"`));
    expect(html).toMatch(new RegExp(`<a [^>]*href="/aide"[^>]*aria-current="page"[^>]*>.*?${t.nav_help}</a>`));
    // The header names the screen: the page's only level-one heading.
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`<h1 [^>]*>${t.sc_help}</h1>`));
  });

  it('takes /aide for the help screen, and no other path', () => {
    expect(activeScreen('/aide')).toBe('help');
    expect(activeScreen('/aide/')).toBe('help');
    expect(activeScreen('/aides')).toBe('home');
    expect(activeScreen('/documents/AIDE-1')).toBe('document');
  });
});
