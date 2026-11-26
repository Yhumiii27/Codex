import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import HelpPage, { generateMetadata } from '@/app/aide/page';
import { FR, SAME_IN_FRENCH } from '@/i18n/fr';
import { FR_HELP } from '@/i18n/fr-help';
import { HELP } from '@/lib/help';
import type { Lang } from '@/lib/i18n';
import { setupDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs, setLangCookie } from '../support/session';
import { translatorFor } from '@/i18n';

// Help page (/aide, point 69 of docs/reste-a-faire.md): the common tasks in the user's language (lib/help.ts HELP, English sources),
// with what is simulated said where it applies, and a link to the screen where a task starts only for a user who has
// that screen (lib/context.ts screens).

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));
// next/link wants the app router mounted; a plain <a> keeps the href the page gives it.
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children) }));
// The common page header (Norma 2.0) needs the shell's context (AppProvider): here only its title, as the page gives it.
vi.mock('@/components/shell/PageHeader', () => ({ PageHeader: ({ title }: { title: ReactNode }) => createElement('header', null, createElement('h1', null, title)) }));

setupDb();

async function render(who: Person, lang: Lang): Promise<string> {
  actAs(who);
  setLangCookie(lang);
  return renderToStaticMarkup((await HelpPage()) as ReactElement);
}

/** Text of the HTML, entities decoded, tags removed. */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('Help page', () => {
  it('has its topics, each with a title and steps, every text translated into French', () => {
    for (const x of HELP.topics) {
      expect(x.title.trim()).not.toBe('');
      expect(x.steps.length).toBeGreaterThan(0);
      for (const s of [x.title, x.intro, ...x.steps, ...(x.notes ?? []), ...(x.simulated ? [x.simulated] : [])]) expect(FR_HELP[s] ?? FR[s], s).toBeTruthy();
    }
    // The journeys asked for (docs/reste-a-faire.md, point 69).
    expect(HELP.topics.map((x) => x.id)).toEqual(['simulation', 'create', 'working', 'restore', 'approval', 'decide', 'vigie', 'compare', 'confidentiality', 'search']);
  });

  it.each(['fr', 'en'] as const)('renders in %s: title, contents linked to each section, simulated parts marked', async (lang) => {
    const html = await render('owner', lang);
    const tr = translatorFor(lang);
    expect(html).toContain(`<h2`);
    expect(text(html)).toContain(tr('Using Codex'));
    for (const x of HELP.topics) {
      expect(html).toContain(`href="#${x.id}"`);
      expect(html).toContain(`id="${x.id}"`);
      expect(text(html)).toContain(tr(x.title));
      for (const s of x.steps) expect(text(html)).toContain(tr(s));
    }
    // Vigie's decision is the simulated part of its journey, said there.
    const vigie = html.slice(html.indexOf('id="vigie"'), html.indexOf('id="compare"'));
    expect(text(vigie)).toContain(tr(HELP.simulatedLabel));
    expect(text(vigie)).toContain(tr(HELP.topics.find((x) => x.id === 'vigie')!.simulated!));
    // Nothing of the other language.
    expect(text(html)).not.toContain(translatorFor(lang === 'fr' ? 'en' : 'fr')(HELP.topics[1].title));
  });

  it('links a task to its screen only for a user who has that screen', async () => {
    // A collaborator has Validations; an auditor does not (lib/context.ts), and gets no link to it.
    expect(await render('owner', 'fr')).toContain('href="/validations"');
    const auditor = await render('auditor', 'fr');
    expect(auditor).not.toContain('href="/validations');
    expect(auditor).toContain('href="/recherche"');
  });

  it('names itself « Aide — Codex » or « Help — Codex »', async () => {
    actAs('owner');
    expect((await generateMetadata()).title).toEqual({ absolute: 'Aide — Codex' });
    setLangCookie('en');
    expect((await generateMetadata()).title).toEqual({ absolute: 'Help — Codex' });
  });

  it('quotes the labels the screens show: every « … » of the help that names a button is in the dictionary', () => {
    // A renamed button would leave the help pointing at a label that no longer exists.
    const quoted = (s: string, lang: Lang) => [...s.matchAll(lang === 'fr' ? /« ([^»]+) »/g : /“([^”]+)”/g)].map((m) => m[1]);
    for (const lang of ['fr', 'en'] as const) {
      // The labels of the screens (src/i18n/fr.ts), the help's own texts set aside.
      const labels = Object.entries(FR).filter(([en]) => !(en in FR_HELP));
      const values = new Set([...(lang === 'fr' ? labels.map(([, fr]) => fr) : labels.map(([en]) => en.replace(/#[a-z][\w-]*$/, ''))), ...SAME_IN_FRENCH]);
      const tr = translatorFor(lang);
      const all = HELP.topics.flatMap((x) => [x.intro, ...x.steps, ...(x.notes ?? []), x.simulated ?? '']).flatMap((s) => quoted(s ? tr(s) : '', lang));
      // Not a label: the comment Codex gives a restored version.
      const missing = all.filter((q) => !values.has(q) && !/^(Restaurée depuis|Restored from) A\.1$/.test(q));
      expect(missing).toEqual([]);
      expect(all.length).toBeGreaterThan(15);
    }
  });
});
