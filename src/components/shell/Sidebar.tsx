'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useApp } from './AppProvider';
import type { Screen } from '@/lib/context';
import styles from './Sidebar.module.css';

const ITEMS: { key: Screen; href: string; icon: IconName }[] = [
  { key: 'home', href: '/', icon: 'home' },
  { key: 'explorer', href: '/explorateur', icon: 'folder' },
  { key: 'search', href: '/recherche', icon: 'search' },
  { key: 'departments', href: '/departements', icon: 'building' },
  { key: 'workflow', href: '/validations', icon: 'check' },
  { key: 'retention', href: '/archivage', icon: 'archive' },
  { key: 'admin', href: '/administration', icon: 'shield' },
];

export function activeScreen(pathname: string): Screen | 'document' {
  if (pathname.startsWith('/documents/')) return 'document';
  return ITEMS.find((i) => i.href !== '/' && pathname.startsWith(i.href))?.key ?? 'home';
}

export function Sidebar({ screens, user, roleTitle, keystoneUrl }: {
  screens: Record<Screen, boolean>;
  user: { name: string; initials: string };
  roleTitle: string;
  keystoneUrl: string;
}) {
  const { t, open, todo } = useApp();
  // Items of « À traiter » (AppProvider), shown on Accueil, whose list holds them all: the design puts the badge on
  // Validations, when the list only held approval steps.
  const badge = todo.length;
  const pathname = usePathname();
  const sc = activeScreen(pathname);
  return (
    <nav className={`nav ${styles.nav}`}>
      <div className={styles.brandRow}>
        <div className={styles.logo}><Icon name="doc" size={15} /></div>
        <div>
          <div className={`nav-brand ${styles.brand}`}>Codex</div>
          <div className="text-muted" style={{ fontSize: 11 }}>{t.brand_sub}</div>
        </div>
      </div>
      <div className={styles.items}>
        {ITEMS.filter((it) => screens[it.key]).map((it) => {
          const current = sc === it.key || (sc === 'document' && it.key === 'explorer');
          return (
            <Link key={it.key} href={it.href} aria-current={current ? 'page' : undefined} className={styles.item} style={{ borderLeftColor: current ? 'var(--color-accent)' : 'transparent' }}>
              <Icon name={it.icon} />
              <span style={{ flex: 1 }}>{t[`nav_${it.key}`]}</span>
              {it.key === 'home' && badge > 0 && <span className="tag tag-accent" style={{ padding: '1px 7px', fontSize: 10 }} title={t.todo}>{badge}</span>}
            </Link>
          );
        })}
      </div>
      <div className={styles.bottom}>
        <div style={{ padding: '0 8px' }}>
          <div className={`text-muted ${styles.overline}`}>{t.linked_app}</div>
          <a href={keystoneUrl} target="_blank" rel="noreferrer" className={styles.linked}>
            <span className={styles.linkedMark}>K</span>
            <span style={{ flex: 1 }}>Keystone</span>
            <Icon name="external" size={12} sw={1.8} style={{ opacity: 0.6 }} />
          </a>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => open({ kind: 'notes' })} style={{ justifyContent: 'flex-start', fontSize: 12, padding: '6px 8px' }}>
          <Icon name="info" size={14} />{t.notes}
        </button>
        <button type="button" className={`plain-btn ${styles.user}`} onClick={() => open({ kind: 'user' })} title={t.sim_title}>
          <div className={styles.avatar}>{user.initials}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13 }}>{user.name}</div>
            <div className="text-muted ellipsis" style={{ fontSize: 11 }}>{roleTitle}</div>
          </div>
        </button>
      </div>
    </nav>
  );
}
