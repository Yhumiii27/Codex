import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import HelpPage, { generateMetadata } from '@/app/aide/page';
import { DICT, HELP, type Lang } from '@/lib/i18n';
import { setupDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs, setLangCookie } from '../support/session';

// Help page (/aide, point 69 of docs/reste-a-faire.md): the common tasks in the user's language (lib/i18n.ts HELP),
// with what is simulated said where it applies, and a link to the screen where a task starts only for a user who has
// that screen (lib/context.ts screens).

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));
// next/link wants the app router mounted; a plain <a> keeps the href the page gives it.
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children) }));

setupDb();

async function render(who: Person, lang: Lang): Promise<string> {
  actAs(who);
  setLangCookie(lang);
  return renderToStaticMarkup((await HelpPage()) as ReactElement);
}

/** Text of the HTML, entities decoded, tags removed. */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('Help page', () => {
  it('has the same topics, in the same order, in French and in English, each with steps', () => {
    expect(HELP.en.topics.map((x) => x.id)).toEqual(HELP.fr.topics.map((x) => x.id));
    for (const lang of ['fr', 'en'] as const) {
      for (const x of HELP[lang].topics) {
        expect(x.title.trim()).not.toBe('');
        expect(x.steps.length).toBeGreaterThan(0);
        expect(!!x.simulated).toBe(!!HELP.fr.topics.find((y) => y.id === x.id)!.simulated);
      }
    }
    // The journeys asked for (docs/reste-a-faire.md, point 69).
    expect(HELP.fr.topics.map((x) => x.id)).toEqual(['simulation', 'create', 'working', 'restore', 'approval', 'decide', 'vigie', 'compare', 'confidentiality', 'search']);
  });

  it.each(['fr', 'en'] as const)('renders in %s: title, contents linked to each section, simulated parts marked', async (lang) => {
    const html = await render('owner', lang);
    const t = DICT[lang];
    expect(html).toContain(`<h2`);
    expect(text(html)).toContain(t.help_title);
    for (const x of HELP[lang].topics) {
      expect(html).toContain(`href="#${x.id}"`);
      expect(html).toContain(`id="${x.id}"`);
      expect(text(html)).toContain(x.title);
      for (const s of x.steps) expect(text(html)).toContain(s);
    }
    // Vigie's decision is the simulated part of its journey, said there.
    const vigie = html.slice(html.indexOf('id="vigie"'), html.indexOf('id="compare"'));
    expect(text(vigie)).toContain(HELP[lang].simulatedLabel);
    expect(text(vigie)).toContain(HELP[lang].topics.find((x) => x.id === 'vigie')!.simulated!);
    // Nothing of the other language.
    const other = HELP[lang === 'fr' ? 'en' : 'fr'];
    expect(text(html)).not.toContain(other.topics[1].title);
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
      const values = new Set(Object.values(DICT[lang]));
      const all = HELP[lang].topics.flatMap((x) => [x.intro, ...x.steps, ...(x.notes ?? []), x.simulated ?? '']).flatMap((s) => quoted(s, lang));
      // Not a label: the comment Codex gives a restored version.
      const missing = all.filter((q) => !values.has(q) && !/^(Restaurée depuis|Restored from) A\.1$/.test(q));
      expect(missing).toEqual([]);
      expect(all.length).toBeGreaterThan(15);
    }
  });
});
