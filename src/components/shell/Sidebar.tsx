'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Icon, type IconName } from '@/components/ui/Icon';
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
  ['registry', 'registry'], ['functions', 'functions_tab'], ['roles', 'ad_roles'], ['org', 'organisation'],
  ['vocab', 'tab_vocab'], ['templates', 'templates_qms'], ['audit', 'ad_audit'],
] as const;

type Hit = { id: string; href: string; icon: IconName; label: string; section: string };

/** Case- and accent-insensitive form of a label, for the page search. */
const fold = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function activeScreen(pathname: string): Screen | 'document' | 'help' {
  if (pathname.startsWith('/documents/')) return 'document';
  if (pathname === '/aide' || pathname.startsWith('/aide/')) return 'help';
  return ITEMS.find((i) => i.href !== '/' && pathname.startsWith(i.href))?.key ?? 'home';
}

export function Sidebar({ screens, user, roleTitle, keystoneUrl, signOut = false }: {
  screens: Record<Screen, boolean>;
  user: { name: string; initials: string };
  roleTitle: string;
  keystoneUrl: string;
  /** Signed in through Clavis (CODEX_AUTH=clavis): the person is not simulated, the button signs out. */
  signOut?: boolean;
}) {
  const { t, tr, open, todo, data } = useApp();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K: the page search (Norma § 7), from anywhere in Codex.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Every page the person may open: the screens, Help, the tabs of Administration and the department pages.
  const pages = useMemo<Hit[]>(() => {
    const out: Hit[] = ITEMS.filter((it) => screens[it.key]).map((it) => ({ id: it.key, href: it.href, icon: it.icon, label: tr(it.label), section: '' }));
    out.push({ id: 'help', href: '/aide', icon: 'help', label: tr('Help'), section: '' });
    if (screens.admin) {
      for (const [tab, key] of ADMIN_TABS) {
        out.push({ id: `admin-${tab}`, href: `/administration${tab === 'registry' ? '' : `?tab=${tab}`}`, icon: 'shield', label: t[key], section: tr('Administration') });
      }
    }
    if (screens.departments) {
      for (const d of data.departments.filter((x) => x.active)) {
        out.push({ id: `dept-${d.key}`, href: `/departements/${encodeURIComponent(d.key)}`, icon: 'building', label: d.label, section: tr('Departments') });
      }
    }
    return out;
  }, [screens, t, tr, data.departments]);
  const query = fold(q.trim());
  const hits = query ? pages.filter((p) => fold(p.label).includes(query) || fold(p.section).includes(query)).slice(0, 12) : [];
  const at = Math.min(cursor, Math.max(hits.length - 1, 0));
  const leave = () => { setQ(''); setCursor(0); };
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') leave();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(Math.min(at + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(Math.max(at - 1, 0)); }
    else if (e.key === 'Enter' && hits[at]) { e.preventDefault(); router.push(hits[at].href); leave(); }
  };
  // Items of « À traiter » (AppProvider), shown on Accueil, whose list holds them all: the design puts the badge on
  // Validations, when the list only held approval steps.
  const badge = todo.length;
  const pathname = usePathname();
  const sc = activeScreen(pathname);
  return (
    <nav className={`nav ${styles.nav}`} aria-label={tr('Main navigation')}>
      <div className={styles.brandRow}>
        <div className={styles.logo}><Icon name="doc" size={15} /></div>
        <div>
          <div className={`nav-brand ${styles.brand}`}>Codex</div>
          <div className="text-muted" style={{ fontSize: 11 }}>{tr('Group DMS')}</div>
        </div>
      </div>
      <div className={styles.search} role="search">
        <Icon name="search" size={13} className={styles.searchIcon} />
        <input
          ref={searchRef}
          className={`input ${styles.searchInput}`}
          value={q}
          onChange={(e) => { setQ(e.target.value); setCursor(0); }}
          onKeyDown={onSearchKey}
          placeholder={tr('Go to a page…')}
          aria-label={tr('Go to a page…')}
          autoComplete="off"
        />
        <kbd className={styles.kbd} aria-hidden="true">⌘K</kbd>
      </div>
      {query ? (
        <ul className={styles.hits} aria-label={tr('Go to a page…')}>
          {hits.map((h, i) => (
            <li key={h.id}>
              <Link href={h.href} onClick={leave} className={styles.item} style={{ borderLeftColor: i === at ? 'var(--color-accent)' : 'transparent' }}>
                <Icon name={h.icon} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="ellipsis" style={{ display: 'block' }}>{h.label}</span>
                  {h.section && <span className="text-muted sub">{h.section}</span>}
                </span>
              </Link>
            </li>
          ))}
          {!hits.length && <li className="text-muted sub" style={{ padding: '6px 10px' }} role="status">{tr('No page matches')}</li>}
        </ul>
      ) : (
      <div className={styles.items}>
        {ITEMS.filter((it) => screens[it.key]).map((it) => {
          const current = sc === it.key || (sc === 'document' && it.key === 'explorer');
          return (
            <Link key={it.key} href={it.href} aria-current={current ? 'page' : undefined} className={styles.item} style={{ borderLeftColor: current ? 'var(--color-accent)' : 'transparent' }}>
              <Icon name={it.icon} />
              <span style={{ flex: 1 }}>{tr(it.label)}</span>
              {it.key === 'home' && badge > 0 && <span className="tag tag-accent" style={{ padding: '1px 7px', fontSize: 10 }} title={tr('To do')}>{badge}</span>}
            </Link>
          );
        })}
      </div>
      )}
      <div className={styles.bottom}>
        <div style={{ padding: '0 8px' }}>
          <div className={`text-muted ${styles.overline}`}>{tr('Linked app')}</div>
          <a href={keystoneUrl} target="_blank" rel="noreferrer" className={styles.linked}>
            <span className={styles.linkedMark}>K</span>
            <span style={{ flex: 1 }}>Keystone</span>
            <Icon name="external" size={12} sw={1.8} style={{ opacity: 0.6 }} />
          </a>
        </div>
        {/* Help (/aide): what to do, step by step; the design notes: what the model is. */}
        <div className={styles.helpRow}>
          <Link href="/aide" className={`btn btn-ghost ${styles.help}`} aria-current={sc === 'help' ? 'page' : undefined}>
            <Icon name="help" size={14} />{tr('Help')}
          </Link>
          <button type="button" className="btn btn-ghost" onClick={() => open({ kind: 'notes' })} style={{ justifyContent: 'flex-start', fontSize: 12, padding: '6px 8px' }}>
            <Icon name="info" size={14} />{tr('Design notes')}
          </button>
        </div>
        {signOut ? (
          <form method="post" action="/auth/deconnexion">
            <button type="submit" className={`plain-btn ${styles.user}`} title={tr('Sign out')} aria-label={`${user.name} — ${tr('Sign out')}`}>
              <div className={styles.avatar}>{user.initials}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13 }}>{user.name}</div>
                <div className="text-muted ellipsis" style={{ fontSize: 11 }}>{roleTitle} · {tr('Sign out')}</div>
              </div>
            </button>
          </form>
        ) : (
          <button type="button" className={`plain-btn ${styles.user}`} onClick={() => open({ kind: 'user' })} title={tr('Simulate a user')}>
            <div className={styles.avatar}>{user.initials}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13 }}>{user.name}</div>
              <div className="text-muted ellipsis" style={{ fontSize: 11 }}>{roleTitle}</div>
            </div>
          </button>
        )}
      </div>
    </nav>
  );
}
