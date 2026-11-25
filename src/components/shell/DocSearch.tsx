'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { searchUrlWith } from '@/lib/search';
import { useApp } from './AppProvider';

/**
 * Document search of the page header (Norma 2.0, COQUE.md § 3: the tool's global search, `search` of PageHeader): Enter
 * opens the search screen with the text; on the search screen itself it drives the results live, as its own field does.
 */
export function DocSearch() {
  const { tr } = useApp();
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const onSearchScreen = pathname === '/recherche';
  const urlQ = onSearchScreen ? params.get('q') ?? '' : '';
  const [q, setQ] = useState(urlQ);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow the search screen's query so both fields show the same text.
  const [prevUrlQ, setPrevUrlQ] = useState(urlQ);
  if (urlQ !== prevUrlQ) { setPrevUrlQ(urlQ); if (urlQ !== q.trim()) setQ(urlQ); }

  // Another text starts the results again from their first page, as the screen's own field does.
  const go = (value: string, replace: boolean) => {
    const onSearch = window.location.pathname === '/recherche';
    if (replace && !onSearch) return; // the user left the search screen before the debounce fired
    const url = searchUrlWith(onSearch ? window.location.search : '', { q: value.trim() });
    if (replace) router.replace(url, { scroll: false }); else router.push(url);
  };
  const onType = (value: string) => {
    setQ(value);
    if (!onSearchScreen) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go(value, true), 250);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <>
      <Icon name="search" size={14} className="coque-header-search-icon" />
      <input
        className="input"
        type="search"
        value={q}
        onChange={(e) => onType(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { if (timer.current) clearTimeout(timer.current); go(q, onSearchScreen); } }}
        placeholder={tr('Search documents, references, keywords…')}
        aria-label={tr('Search documents, references, keywords…')}
      />
    </>
  );
}
