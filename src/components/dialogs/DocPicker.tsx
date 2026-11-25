'use client';

import { useEffect, useState } from 'react';
import { useApp } from '@/components/shell/AppProvider';
import type { LinkRel } from '@/db/schema';
import type { DocCandidate } from '@/lib/links';
import { Select } from './Modal';

// The document a record's dialog proposes (a replacement, the other end of a link), searched as the user types
// (point 47 of docs/reste-a-faire.md): the record no longer hands its dialogs the list of every readable document; GET
// /api/documents/[id]/candidates answers the first CANDIDATES_SHOWN that match, by ID. The chosen one stays offered
// while the search changes.

const WAIT_MS = 200;

type Answer = { options: DocCandidate[]; more: boolean };

/** The documents offered for `docId`, for `q`; `null` while the first answer is awaited, `failed` when none came. */
function useCandidates(docId: string, purpose: 'link' | 'replacement', rel: LinkRel | undefined, q: string) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ for: purpose, q });
      if (rel) params.set('rel', rel);
      fetch(`/api/documents/${encodeURIComponent(docId)}/candidates?${params}`, { signal: abort.signal, credentials: 'same-origin' })
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status));
          setAnswer((await res.json()) as Answer);
          setFailed(false);
        })
        .catch(() => { if (!abort.signal.aborted) setFailed(true); });
    }, q ? WAIT_MS : 0);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [docId, purpose, rel, q]);
  return { answer, failed };
}

export function DocPicker({ id, docId, purpose, rel, name, value, onChange, empty, onOptions }: {
  /** The id of the list, which the Field's label names. */
  id: string;
  docId: string;
  purpose: 'link' | 'replacement';
  rel?: LinkRel;
  name?: string;
  value: string;
  onChange: (v: string) => void;
  empty: string;
  /** Told the documents shown, and whether a search is typed (the link dialog says when none can be linked at all). */
  onOptions?: (options: DocCandidate[], searching: boolean) => void;
}) {
  const { tr } = useApp();
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<DocCandidate | null>(null);
  const { answer, failed } = useCandidates(docId, purpose, rel, q);
  const found = answer?.options ?? [];
  useEffect(() => { if (answer) onOptions?.(answer.options, !!q.trim()); }, [answer, q, onOptions]);
  // The chosen document stays in the list (and stays chosen) while another search is typed, unless the kind of link no
  // longer accepts it: the parent then clears it.
  const options = chosen && chosen.key === value && !found.some((o) => o.key === value) ? [chosen, ...found] : found;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <input
        type="search" className="input" value={q} onChange={(e) => setQ(e.target.value)} maxLength={100}
        placeholder={tr('Search by ID or title…')} aria-label={tr('Search by ID or title…')} aria-controls={id}
      />
      <Select
        id={id} name={name} value={value} options={options} empty={empty} disabled={!answer && !failed}
        onChange={(v) => { setChosen(options.find((o) => o.key === v) ?? null); onChange(v); }}
      />
      <span className="text-muted" role="status" style={{ fontSize: 12 }}>
        {failed ? tr('The documents could not be read; try again.') : answer?.more ? tr('Only the first {n} matches are shown: narrow the search.').replace('{n}', String(answer.options.length)) : ''}
      </span>
    </div>
  );
}
