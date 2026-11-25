'use client';

import type { ReactNode } from 'react';
import { AppShell, MobileTopBar } from '@norma/charte/ds/AppShell';
import { ToolLogo } from '@norma/charte/ds/ToolLogo';
import type { Screen } from '@/lib/context';
import { Bell } from './Bell';
import { Prefs } from './Prefs';
import { Sidebar } from './Sidebar';

/**
 * The common shell of the suite (Norma 2.0, norma/charte/COQUE.md § 1 and § 8): the skip link, the sidebar and the
 * column of the screen, which starts with the top bar shown at 1 024 px or less (menu button, Codex's logo and name, bell,
 * language over display; logo of Norma 2.3, COQUE.md § 8 bis). No header bar above the screens: each screen renders its own header (components/shell/PageHeader.tsx).
 */
export function Shell({ sidebar, children }: { sidebar: { screens: Record<Screen, boolean>; user: { name: string; initials: string }; roleTitle: string; keystoneUrl: string; signOut?: boolean }; children: ReactNode }) {
  return (
    <AppShell
      className="codex-shell"
      sidebar={<Sidebar {...sidebar} />}
      topbar={<MobileTopBar name="Codex" logo={<ToolLogo code="codex" size={20} />} tools={<Bell />} prefs={<Prefs />} />}
    >
      {children}
    </AppShell>
  );
}
