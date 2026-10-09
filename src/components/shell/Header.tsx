'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { Seg } from '@/components/ui/Seg';
import { setLang } from '@/lib/actions';
import { useApp } from './AppProvider';
import { activeScreen } from './Sidebar';
import styles from './Header.module.css';

const TITLE = { home: 'sc_home', explorer: 'sc_explorer', document: 'sc_document', search: 'sc_search', workflow: 'sc_workflow', retention: 'sc_retention', admin: 'sc_admin' } as const;

export type Notif = {
  /** Running workflows whose current step is assigned to the simulated user. */
  pending: { id: string; docId: string; docTitle: string; letter: string; stepName: string; dueF: string; href: string }[];
  recent: { id: number; when: string; user: string; actionLabel: string; ref: string; href: string }[];
};

export function Header({ notif }: { notif: Notif }) {
  const { t, lang } = useApp();
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const sc = activeScreen(pathname);
  const urlQ = sc === 'search' ? params.get('q') ?? '' : '';
  const [q, setQ] = useState(urlQ);
  const [notifOpen, setNotifOpen] = useState(false);
  const [, start] = useTransition();
  const popRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow the search screen's query so both fields show the same text, as in the design.
  const [prevUrlQ, setPrevUrlQ] = useState(urlQ);
  if (urlQ !== prevUrlQ) { setPrevUrlQ(urlQ); if (urlQ !== q.trim()) setQ(urlQ); }

  useEffect(() => {
    if (!notifOpen) return;
    const onDown = (e: MouseEvent) => { if (popRef.current && !popRef.current.contains(e.target as Node)) setNotifOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNotifOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [notifOpen]);

  const go = (value: string, replace: boolean) => {
    const onSearch = window.location.pathname === '/recherche';
    if (replace && !onSearch) return; // the user left the search screen before the debounce fired
    const next = new URLSearchParams(onSearch ? window.location.search : '');
    if (value.trim()) next.set('q', value.trim()); else next.delete('q');
    const qs = next.toString();
    const url = `/recherche${qs ? `?${qs}` : ''}`;
    if (replace) router.replace(url, { scroll: false }); else router.push(url);
  };
  // On the search screen the header field drives the results live, like the design's shared query.
  const onType = (value: string) => {
    setQ(value);
    if (sc !== 'search') return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go(value, true), 250);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <header className={styles.header}>
      <h5 className={styles.title}>{t[TITLE[sc]]}</h5>
      <div className={styles.search}>
        <Icon name="search" size={15} style={{ position: 'absolute', left: 10, top: 10, opacity: 0.6 }} />
        <input
          className="input"
          value={q}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { if (timer.current) clearTimeout(timer.current); go(q, sc === 'search'); } }}
          placeholder={t.search_ph}
          style={{ paddingLeft: 32, minHeight: 34 }}
          aria-label={t.search_ph}
        />
      </div>
      <div className={styles.right}>
        <Seg
          name="lang"
          ariaLabel="Langue / Language"
          value={lang}
          optStyle={{ padding: '5px 10px', fontSize: 12 }}
          options={[{ key: 'fr', label: 'FR' }, { key: 'en', label: 'EN' }]}
          onPick={(k) => start(() => setLang(k))}
        />
        <div style={{ position: 'relative' }} ref={popRef}>
          <button type="button" className="btn btn-secondary btn-icon" aria-label={t.notif} aria-expanded={notifOpen} onClick={() => setNotifOpen((v) => !v)} style={{ position: 'relative', width: 34, height: 34 }}>
            <Icon name="bell" />
            {notif.pending.length > 0 && <span className={styles.dot} />}
          </button>
          {notifOpen && (
            <div className="popover" style={{ right: 0, top: 42 }} role="dialog" aria-label={t.notif}>
              <h6 className="sec-title">{t.notif_pending}</h6>
              {notif.pending.length === 0 && <div className="text-muted" style={{ fontSize: 12.5 }}>{t.notif_empty}</div>}
              {notif.pending.map((p) => (
                <Link key={p.id} href={p.href} className={`link-plain ${styles.notifRow}`} onClick={() => setNotifOpen(false)}>
                  <Icon name="check" size={15} style={{ flex: 'none', color: 'var(--color-accent)', marginTop: 2 }} />
                  <span style={{ minWidth: 0 }}>
                    <span className="ellipsis" style={{ display: 'block', color: 'var(--color-text)' }}>{p.docTitle}</span>
                    <span className="text-muted sub">{p.docId}{p.letter ? ` · ${t.revision} ${p.letter}` : ''} · {t.step} : {p.stepName} · {t.due} {p.dueF}</span>
                  </span>
                </Link>
              ))}
              <h6 className="sec-title" style={{ marginTop: 4 }}>{t.notif_recent}</h6>
              {notif.recent.length === 0 && <div className="text-muted" style={{ fontSize: 12.5 }}>{t.notif_empty}</div>}
              {notif.recent.map((a) => (
                <div key={a.id} className="feed" style={{ fontSize: 12 }}>
                  <span className="text-muted feed-when">{a.when}</span>
                  <span style={{ minWidth: 0 }}>{a.user} <span className="text-muted">· {a.actionLabel} · </span><Link href={a.href} className="link-plain" onClick={() => setNotifOpen(false)}>{a.ref}</Link></span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
