import 'server-only';
import type { Metadata } from 'next';
import { getCtx } from './context';
import type { TKey } from './i18n';

// Page titles (WCAG 2.4.2), in the user's language: « {screen} — Codex ». Each screen exports generateMetadata from
// these; the record names its document (src/app/documents/[id]/page.tsx), only when the user may read it (D-14).

/** « {label} — Codex », whatever the parent segments set (title.absolute). */
export async function titled(label: string): Promise<Metadata> {
  const { t } = await getCtx();
  return { title: { absolute: `${label} — ${t.title_suffix}` } };
}

/** Title of a screen named by a key of the dictionary (sc_explorer, nav_search…). */
export async function screenTitle(key: TKey): Promise<Metadata> {
  const { t } = await getCtx();
  return titled(t[key]);
}
