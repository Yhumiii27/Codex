// Interface strings by English source (Norma § 2): a screen writes `tr('Go to a page…')`, the English text itself; the
// French translation is looked up in fr.ts, French being the default language. Typed text (titles, names, notes) never
// goes through here. Variables are written `{name}` in the source and given in `vars`.
//
// Migration (CX-N01): the shell and the side panel speak this way; the screens still read the keyed dictionary of
// src/lib/i18n.ts (`t.key`) until they move over, one screen at a time (CLAUDE.md, « Conventions »).

import type { Lang } from '../lib/i18n';
import { FR } from './fr';

export type Vars = Record<string, string | number>;
export type Translate = (source: string, vars?: Vars) => string;

function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/**
 * A context after `#` tells apart two sources that read alike in English and differ in French (`'Approve'` the button,
 * `'Approve#permission'` the permission, « Valider »): never shown, the English text is what comes before it.
 */
const CONTEXT = /#[a-z][\w-]*$/;

/** The text of `source` in `lang`: the source itself in English, its French entry otherwise (the source when missing). */
export function translate(lang: Lang, source: string, vars?: Vars): string {
  const en = source.replace(CONTEXT, '');
  return fill(lang === 'en' ? en : FR[source] ?? en, vars);
}

/** A translator bound to one language (server components: `translatorFor(ctx.lang)`). */
export function translatorFor(lang: Lang): Translate {
  return (source, vars) => translate(lang, source, vars);
}

/** Marks an English source string kept in a table (a menu entry, an option) for the completeness test; returns it as is. */
export const msg = (source: string): string => source;
