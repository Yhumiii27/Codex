'use client';

import { useEffect, useOptimistic, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { useApp } from '@/components/shell/AppProvider';
import { searchUrlWith } from '@/lib/search';

/**
 * The large search field: updates the URL as you type (debounced), keeping the facets selected at that moment; the
 * results start again from their first page.
 */
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
    router.replace(searchUrlWith(window.location.search, { q: v.trim() }), { scroll: false });
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

/** Facet checkbox that toggles its value in the URL; a long value is cut, and read whole on hover. */
export function FacetCheck({ href, checked, label, count }: { href: string; checked: boolean; label: string; count: number }) {
  const router = useRouter();
  const [on, setOn] = useOptimistic(checked);
  const [, start] = useTransition();
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer', padding: '2px 0' }}>
      <input type="checkbox" checked={on} onChange={() => start(() => { setOn(!on); router.replace(href, { scroll: false }); })} style={{ margin: 0 }} />
      <span className="ellipsis" style={{ flex: 1 }} title={label}>{label}</span>
      <span className="text-muted" style={{ fontSize: 11 }}>{count}</span>
    </label>
  );
}

/**
 * Replaces some parameters of the current /recherche URL (null removes one), keeping the others (typed query,
 * facets…) but the page: other criteria or another order start from the first one.
 */
function useSearchParamsUpdate() {
  const router = useRouter();
  return (set: Record<string, string | null>) => {
    if (window.location.pathname !== '/recherche') return;
    router.replace(searchUrlWith(window.location.search, set), { scroll: false });
  };
}

/** Order of the results (URL `sort`). */
export function SortSelect({ value, options }: { value: string; options: { key: string; label: string }[] }) {
  const { t } = useApp();
  const update = useSearchParamsUpdate();
  const [pending, start] = useTransition();
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <span className="text-muted">{t.sort_by}</span>
      <select
        className="input"
        value={value}
        disabled={pending}
        onChange={(e) => { const v = e.target.value; start(() => update({ sort: v })); }}
        style={{ width: 'auto', minHeight: 30, fontSize: 12, padding: '3px 28px 3px 10px' }}
      >
        {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </label>
  );
}

/** A complete day of a plausible year: date inputs report every intermediate year while one is typed (0002, 0020…). */
const settled = (v: string) => v === '' || (/^\d{4}-\d{2}-\d{2}$/.test(v) && +v.slice(0, 4) >= 1900);

/**
 * Period on one date of the documents (URL `date`, `from`, `to`): applied as the bounds are typed (debounced), removed
 * when both are empty. Choosing another date moves the period onto it.
 */
export function PeriodFilter({ field, from, to, fields }: { field: string; from: string; to: string; fields: { key: string; label: string }[] }) {
  const { t } = useApp();
  const update = useSearchParamsUpdate();
  const [value, setValue] = useState({ field, from, to });
  const [prev, setPrev] = useState({ field, from, to });
  // The URL changed (Effacer, a saved search, this filter itself): follow what changed, keeping what is being typed.
  if (prev.field !== field || prev.from !== from || prev.to !== to) {
    setPrev({ field, from, to });
    setValue((v) => ({ field: prev.field !== field ? field : v.field, from: prev.from !== from ? from : v.from, to: prev.to !== to ? to : v.to }));
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const active = !!(from || to);
  const change = (v: typeof value, wait: number) => {
    setValue(v);
    if (timer.current) clearTimeout(timer.current);
    // Without bounds, the chosen date alone selects nothing: the URL keeps no period.
    if (!settled(v.from) || !settled(v.to) || (!v.from && !v.to && !active)) return;
    timer.current = setTimeout(() => update(v.from || v.to ? { date: v.field, from: v.from || null, to: v.to || null } : { date: null, from: null, to: null }), wait);
  };
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span className="text-muted" style={{ fontSize: 11 }}>{t.period}</span>
        {active && (
          <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '0 4px' }} title={t.period_clear} aria-label={t.period_clear} onClick={() => change({ ...value, from: '', to: '' }, 0)}>
            <Icon name="close" size={11} sw={2} />
          </button>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 8px', alignItems: 'center', fontSize: 12 }}>
        <span className="text-muted">{t.period_date}</span>
        <select className="input" aria-label={`${t.period} · ${t.period_date}`} value={value.field} onChange={(e) => change({ ...value, field: e.target.value }, 0)} style={{ minHeight: 28, fontSize: 12, padding: '2px 24px 2px 8px' }}>
          {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
        <span className="text-muted">{t.period_start}</span>
        <input className="input" type="date" aria-label={`${t.period} · ${t.period_start}`} value={value.from} max={value.to || undefined} onChange={(e) => change({ ...value, from: e.target.value }, 400)} style={{ minHeight: 28, fontSize: 12, padding: '2px 8px' }} />
        <span className="text-muted">{t.period_end}</span>
        <input className="input" type="date" aria-label={`${t.period} · ${t.period_end}`} value={value.to} min={value.from || undefined} onChange={(e) => change({ ...value, to: e.target.value }, 400)} style={{ minHeight: 28, fontSize: 12, padding: '2px 8px' }} />
      </div>
    </div>
  );
}
