import 'server-only';
import type { Metadata } from 'next';
import { getCtx } from './context';

// Page titles (WCAG 2.4.2), in the user's language: « {screen} — Codex ». Each screen exports generateMetadata from
// these; the record names its document (src/app/documents/[id]/page.tsx), only when the user may read it (D-14).

/** « {label} — Codex », whatever the parent segments set (title.absolute). */
export async function titled(label: string): Promise<Metadata> {
  const { tr } = await getCtx();
  return { title: { absolute: `${label} — ${tr('Codex')}` } };
}

/** Title of a screen named by its English source string (`msg('Search')`). */
export async function screenTitle(source: string): Promise<Metadata> {
  const { tr } = await getCtx();
  return titled(tr(source));
}
