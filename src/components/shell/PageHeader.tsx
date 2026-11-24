import { Suspense, type ReactNode } from 'react';
import { PageHeader as Header, type PageHeaderProps } from '@norma/charte/ds/PageHeader';
import { Bell } from './Bell';
import { DocSearch } from './DocSearch';
import { Prefs } from './Prefs';

/**
 * The header of every screen (Norma 2.0, norma/charte/COQUE.md § 3), in its fixed order: breadcrumb and title (the page's
 * only <h1>, 26 px) · document search · the screen's actions (main one rightmost, « Actions » menu beyond three) · bell ·
 * language over display. Codex fills the common parts; each screen gives its title, breadcrumb, actions and toolbar.
 * Actions are client elements (DialogButton, ActionButton, ActionLink…) so that they can be counted and, in the menu,
 * render as rows.
 */
export function PageHeader(props: Omit<PageHeaderProps, 'prefs' | 'bell' | 'search' | 'help' | 'date'> & { children?: ReactNode }) {
  return (
    <Header
      {...props}
      // The search reads the URL (useSearchParams): a boundary keeps the rest of the page static where it may be.
      search={<Suspense fallback={null}><DocSearch /></Suspense>}
      bell={<Bell />}
      prefs={<Prefs />}
    />
  );
}
