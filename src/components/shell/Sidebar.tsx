'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { NavEntry, NavList, PageSearch, Sidebar as Side, type PageHit } from '@norma/charte/ds/Sidebar';
import { useCoque } from '@norma/charte/ds/AppShell';
import { ToolLogo } from '@norma/charte/ds/ToolLogo';
import { ICONS, Icon, type IconName } from '@/components/ui/Icon';
import { msg } from '@/i18n';
import { useApp } from './AppProvider';
import type { Screen } from '@/lib/context';
import styles from './Sidebar.module.css';

/** Screens of the sidebar; `label` is the English source string (src/i18n). */
const ITEMS: { key: Screen; href: string; icon: IconName; label: string }[] = [
  { key: 'home', href: '/', icon: 'home', label: msg('Home') },
  { key: 'explorer', href: '/explorateur', icon: 'folder', label: msg('Browse') },
  { key: 'search', href: '/recherche', icon: 'search', label: msg('Search') },
  { key: 'departments', href: '/departements', icon: 'building', label: msg('Departments') },
  { key: 'workflow', href: '/validations', icon: 'check', label: msg('Approvals') },
  { key: 'retention', href: '/archivage', icon: 'archive', label: msg('Archiving & retention') },
  { key: 'admin', href: '/administration', icon: 'shield', label: msg('Administration') },
];

/** Tabs of Administration offered by the page search (the hand-over tab depends on the person: left to the page). */
const ADMIN_TABS = [
  ['registry', msg('Type register')], ['functions', msg('Functions & workflows')], ['roles', msg('Roles & permissions')], ['org', msg('Organisation')],
  ['vocab', msg('Vocabularies')], ['templates', msg('Templates (QMS)')], ['audit', msg('Audit log')],
] as const;

export function activeScreen(pathname: string): Screen | 'document' | 'help' {
  if (pathname.startsWith('/documents/')) return 'document';
  if (pathname === '/aide' || pathname.startsWith('/aide/')) return 'help';
  return ITEMS.find((i) => i.href !== '/' && pathname.startsWith(i.href))?.key ?? 'home';
}

/**
 * The sidebar of the common shell (Norma 2.0, norma/charte/COQUE.md § 2): brand, page search (⌘K), the screens the role
 * may open, then at the bottom the linked app, the help and the design notes above the person (simulated, or signed in
 * through Clavis). Neither the language nor the display here: they are in each page header.
 */
export function Sidebar({ screens, user, roleTitle, keystoneUrl, signOut = false }: {
  screens: Record<Screen, boolean>;
  user: { name: string; initials: string };
  roleTitle: string;
  keystoneUrl: string;
  /** Signed in through Clavis (CODEX_AUTH=clavis): the person is not simulated, the button signs out. */
  signOut?: boolean;
}) {
  const { tr, open, todo, data } = useApp();
  const { closeNav } = useCoque();

  // Every page the person may open: the screens, Help, the tabs of Administration and the department pages.
  const pages = useMemo<PageHit[]>(() => {
    const out: PageHit[] = ITEMS.filter((it) => screens[it.key]).map((it) => ({ href: it.href, icon: ICONS[it.icon], label: tr(it.label) }));
    out.push({ href: '/aide', icon: ICONS.help, label: tr('Help') });
    if (screens.admin) {
      for (const [tab, key] of ADMIN_TABS) {
        out.push({ href: `/administration${tab === 'registry' ? '' : `?tab=${tab}`}`, icon: ICONS.shield, label: tr(key), section: tr('Administration') });
      }
    }
    if (screens.departments) {
      for (const d of data.departments.filter((x) => x.active)) {
        out.push({ href: `/departements/${encodeURIComponent(d.key)}`, icon: ICONS.building, label: d.label, section: tr('Departments') });
      }
    }
    return out;
  }, [screens, tr, data.departments]);
  // Items of « À traiter » (AppProvider), listed whole on Accueil: the badge sits on its entry.
  const badge = todo.length;
  const sc = activeScreen(usePathname());

  const person = (
    <>
      <span className="coque-avatar">{user.initials}</span>
      <span className="coque-who">
        <span className="coque-who-name">{user.name}</span>
        <span className="coque-who-role ellipsis">{signOut ? `${roleTitle} · ${tr('Sign out')}` : roleTitle}</span>
      </span>
    </>
  );

  return (
    <Side
      name="Codex"
      logo={<ToolLogo code="codex" />}
      footer={
        <>
          <div className={styles.linkedBlock}>
            <div className={styles.overline}>{tr('Linked app')}</div>
            <a href={keystoneUrl} target="_blank" rel="noreferrer" className={`coque-entry ${styles.linked}`}>
              <span className={styles.linkedMark} aria-hidden="true">K</span>
              <span className="coque-entry-label">Keystone</span>
              <Icon name="external" size={12} sw={1.8} />
            </a>
          </div>
          {/* Help (/aide): what to do, step by step; the design notes: what the model is. */}
          <div className="coque-nav">
            <Link href="/aide" className="coque-entry" aria-current={sc === 'help' ? 'page' : undefined} onClick={() => closeNav()}>
              <Icon name="help" className="coque-entry-icon" /><span className="coque-entry-label">{tr('Help')}</span>
            </Link>
            <button type="button" className="coque-entry" onClick={() => { closeNav(); open({ kind: 'notes' }); }}>
              <Icon name="info" className="coque-entry-icon" /><span className="coque-entry-label">{tr('Design notes')}</span>
            </button>
          </div>
          {signOut ? (
            <form method="post" action="/auth/deconnexion">
              <button type="submit" className="coque-user" title={tr('Sign out')} aria-label={`${user.name} — ${tr('Sign out')}`}>{person}</button>
            </form>
          ) : (
            <button type="button" className="coque-user" onClick={() => { closeNav(); open({ kind: 'user' }); }} title={tr('Simulate a user')}>{person}</button>
          )}
        </>
      }
    >
      <PageSearch pages={pages}>
        <NavList>
          {ITEMS.filter((it) => screens[it.key]).map((it) => (
            <NavEntry
              key={it.key}
              href={it.href}
              icon={ICONS[it.icon]}
              label={tr(it.label)}
              active={sc === it.key || (sc === 'document' && it.key === 'explorer')}
              badge={it.key === 'home' && badge > 0 ? badge : undefined}
            />
          ))}
        </NavList>
      </PageSearch>
    </Side>
  );
}
