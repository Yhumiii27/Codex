'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useApp } from './AppProvider';
import { TODO_ICON } from './todo';
import styles from './Bell.module.css';

/**
 * The bell of the page header and of the top bar (Norma 2.0, COQUE.md § 3: right before the language / display pair):
 * what waits for the user (« À traiter », the same list as the home and the sidebar badge) and the recent activity.
 */
export function Bell() {
  const { tr, todo: pending, recent } = useApp();
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className={styles.anchor} ref={popRef}>
      <button type="button" className="btn btn-secondary btn-icon coque-bell" aria-label={pending.length ? `${tr('Notifications')} (${pending.length})` : tr('Notifications')} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="bell" />
        {/* The count is in the button's name too (WCAG 2.5.3: the visible text is part of the name). */}
        {pending.length > 0 && <span className="coque-bell-badge" aria-hidden="true">{pending.length}</span>}
      </button>
      {open && (
        <div className={`popover ${styles.pop}`} role="dialog" aria-label={tr('Notifications')}>
          <h2 className="sec-title">{tr('To do')}</h2>
          {pending.length === 0 && <div className="text-muted" style={{ fontSize: 'var(--text-control)' }}>{tr('Nothing to do for now.')}</div>}
          {pending.length > 0 && (
            <div className={styles.pending}>
              {pending.map((p) => (
                <Link key={p.key} href={p.href} className={`link-plain ${styles.row}`} onClick={() => setOpen(false)}>
                  <Icon name={TODO_ICON[p.kind]} size={15} style={{ flex: 'none', color: 'var(--color-accent)', marginTop: 2 }} />
                  <span style={{ minWidth: 0 }}>
                    <span className="ellipsis" style={{ display: 'block', color: 'var(--color-text)' }}>{p.docTitle}</span>
                    <span className="text-muted sub">{p.detail}</span>
                    {p.note && <span className="sub" style={{ display: 'block', color: 'var(--color-text)', overflowWrap: 'anywhere', marginTop: 2 }}>{p.note}</span>}
                  </span>
                </Link>
              ))}
            </div>
          )}
          <h2 className="sec-title" style={{ marginTop: 4 }}>{tr('Recent activity')}</h2>
          {recent.length === 0 && <div className="text-muted" style={{ fontSize: 'var(--text-control)' }}>{tr('Nothing new.')}</div>}
          {recent.map((a) => (
            <div key={a.id} className="feed" style={{ fontSize: 'var(--text-small)' }}>
              <span className="text-muted feed-when">{a.when}</span>
              <span style={{ minWidth: 0 }}>{a.user} <span className="text-muted">· {a.actionLabel} · </span><Link href={a.href} className="link-plain" onClick={() => setOpen(false)}>{a.ref}</Link></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
