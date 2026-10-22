import { fold } from './search';

// Controlled vocabularies (point 59 of docs/reste-a-faire.md): source organisations and keywords. Pure rules, shared by
// the server (lib/vocab.ts, lib/actions.ts, lib/importer.ts) and the forms (src/components/dialogs/Dialogs.tsx).

/** The vocabularies Codex administers; sub-types stay in the register of types (point 61). */
export const VOCAB_KINDS = ['source_org', 'keyword'] as const;
export type VocabKind = (typeof VOCAB_KINDS)[number];

export const isVocabKind = (v: unknown): v is VocabKind => typeof v === 'string' && (VOCAB_KINDS as readonly string[]).includes(v);

/** Longest name of a term: an organisation as the import takes it, a keyword as the import takes it. */
export const VOCAB_MAX: Record<VocabKind, number> = { source_org: 300, keyword: 100 };

/**
 * Blanks a term may hold (tabulations, line ends, spaces, non-breaking space): collapsed into one space. The database
 * collapses the same ones (drizzle/0003_vocabulaires.sql), so both give the same key to a value.
 */
const BLANKS = /[\u0009-\u000d  ]+/g;

/** A term as written: its blanks collapsed, trimmed. */
export const cleanTerm = (s: string) => s.replace(BLANKS, ' ').replace(/^ +| +$/g, '');

/**
 * What two spellings of one term share: case, accents and blanks set aside (« SIEMENS  », « Siemens », « siémens »).
 * The database folds as codex_fold does (src/db/index.ts), which tests/integration/search-sql.test.ts holds to fold.
 */
export const vocabKey = (s: string) => cleanTerm(fold(cleanTerm(s)));

/** A term of a vocabulary as the rules read it: its name and the names it also stands for. */
export type TermLike = { name: string; aliases?: readonly string[] };

/** Keys a term answers to: its name's and its aliases'. */
export const termKeys = (x: TermLike): string[] => [...new Set([x.name, ...(x.aliases ?? [])].map(vocabKey))];

/** The term a value stands for (same key as its name or an alias), or undefined. */
export function findTerm<T extends TermLike>(terms: readonly T[], value: string): T | undefined {
  const k = vocabKey(value);
  if (!k) return undefined;
  return terms.find((x) => vocabKey(x.name) === k) ?? terms.find((x) => termKeys(x).includes(k));
}

/** Words of a key, for the likeness of two spellings (similarTerms). */
const words = (k: string) => k.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * Terms a new value may be another spelling of (« SIEMENS SAS » for « Siemens »): one's words begin the other's
 * (« siemens » / « siemens sas »), or one holds the other whole when it is at least 4 characters long. The form offers
 * them before a new term is added; at most `max`, the closest first (shortest difference of length).
 */
export function similarTerms<T extends TermLike>(terms: readonly T[], value: string, max = 3): T[] {
  const k = vocabKey(value);
  const w = words(k);
  if (!w.length) return [];
  const scored: { x: T; d: number }[] = [];
  for (const x of terms) {
    let best = Infinity;
    for (const key of termKeys(x)) {
      if (key === k) { best = -1; break; }
      const v = words(key);
      if (!v.length) continue;
      const [a, b] = v.length <= w.length ? [v, w] : [w, v];
      const prefix = a.every((y, i) => b[i] === y);
      const inside = Math.min(k.length, key.length) >= 4 && (k.includes(key) || key.includes(k));
      if (prefix || inside) best = Math.min(best, Math.abs(key.length - k.length));
    }
    if (best >= 0 && best < Infinity) scored.push({ x, d: best });
  }
  return scored.sort((p, q) => p.d - q.d || p.x.name.localeCompare(q.x.name)).slice(0, max).map((s) => s.x);
}

/** Why a name cannot be given to a term: empty, too long, or another term's already (`other`). */
export type TermIssue = 'vocab_name_required' | 'vocab_name_too_long' | 'vocab_name_taken';

/**
 * Checks a name for a term of `kind` among `terms` (`self`: the term being renamed, whose own spellings it may take
 * back). Null when it may be used.
 */
export function termNameIssue<T extends TermLike & { id: number }>(kind: VocabKind, terms: readonly T[], name: string, self?: number): TermIssue | null {
  const clean = cleanTerm(name);
  if (!clean) return 'vocab_name_required';
  if (clean.length > VOCAB_MAX[kind]) return 'vocab_name_too_long';
  const k = vocabKey(clean);
  if (terms.some((x) => x.id !== self && termKeys(x).includes(k))) return 'vocab_name_taken';
  return null;
}

/**
 * The value of a sub-type as stored: the type's own spelling when it folds to one of its labels (French or English),
 * otherwise the value cleaned. The list stays open (MET-17, O-05 point 9): a value outside it is kept, and offered to the
 * administrators of the register (Administration › Vocabulaires).
 */
export function canonicalSubtype(subtypes: readonly { fr: string; en: string }[], value: string | null): { value: string | null; listed: boolean } {
  if (value == null) return { value: null, listed: true };
  const clean = cleanTerm(value);
  if (!clean) return { value: null, listed: true };
  const k = vocabKey(clean);
  for (const st of subtypes) {
    if (vocabKey(st.fr) === k) return { value: st.fr, listed: true };
    if (vocabKey(st.en) === k) return { value: st.en, listed: true };
  }
  return { value: clean, listed: false };
}

/** Languages a document may be written in: French, English, or none said (point 59). */
export const DOC_LANGS = ['fr', 'en'] as const;

/** A language as stored: fr or en, whatever its case and blanks; undefined for any other value; null for none. */
export function docLang(v: string | null | undefined): 'fr' | 'en' | null | undefined {
  if (v == null) return null;
  const x = v.trim().toLowerCase();
  if (!x) return null;
  return (DOC_LANGS as readonly string[]).includes(x) ? (x as 'fr' | 'en') : undefined;
}
