'use client';

import { useEffect, useOptimistic, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { useApp } from '@/components/shell/AppProvider';

/** The large search field: updates the URL as you type (debounced), keeping the facets selected at that moment. */
export function SearchField({ q }: { q: string }) {
  const { t } = useApp();
  const router = useRouter();
  const [value, setValue] = useState(q);
  const [prevQ, setPrevQ] = useState(q);
  if (q !== prevQ) { setPrevQ(q); if (q !== value.trim()) setValue(q); }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const push = (v: string) => {
    if (window.location.pathname !== '/recherche') return;
    const p = new URLSearchParams(window.location.search);
    if (v.trim()) p.set('q', v.trim()); else p.delete('q');
    const qs = p.toString();
    router.replace(`/recherche${qs ? `?${qs}` : ''}`, { scroll: false });
  };
  return (
    <div style={{ position: 'relative', maxWidth: 720 }}>
      <Icon name="search" style={{ position: 'absolute', left: 12, top: 12, opacity: 0.6 }} />
      <input
        className="input"
        value={value}
        placeholder={t.search_ph}
        aria-label={t.search_ph}
        style={{ paddingLeft: 36, minHeight: 40, fontSize: 15 }}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => push(v), 250);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') { if (timer.current) clearTimeout(timer.current); push(value); } }}
      />
    </div>
  );
}

/** Facet checkbox that toggles its value in the URL. */
export function FacetCheck({ href, checked, label, count }: { href: string; checked: boolean; label: string; count: number }) {
  const router = useRouter();
  const [on, setOn] = useOptimistic(checked);
  const [, start] = useTransition();
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer', padding: '2px 0' }}>
      <input type="checkbox" checked={on} onChange={() => start(() => { setOn(!on); router.replace(href, { scroll: false }); })} style={{ margin: 0 }} />
      <span className="ellipsis" style={{ flex: 1 }}>{label}</span>
      <span className="text-muted" style={{ fontSize: 11 }}>{count}</span>
    </label>
  );
}
