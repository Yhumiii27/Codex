'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

/** Family filter of the type register (URL-driven: /administration?family=…). */
export function FamilyFilter({ value, options, allLabel, ariaLabel }: {
  value: string; options: { key: string; label: string; count: number }[]; allLabel: string; ariaLabel: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <select
      className="input"
      aria-label={ariaLabel}
      value={value}
      disabled={pending}
      onChange={(e) => {
        const v = e.target.value;
        start(() => router.push(`/administration${v ? `?family=${encodeURIComponent(v)}` : ''}`, { scroll: false }));
      }}
      style={{ width: 'auto', minHeight: 32, fontSize: 12.5, padding: '4px 30px 4px 10px' }}
    >
      <option value="">{allLabel}</option>
      {options.map((o) => <option key={o.key} value={o.key}>{o.label} ({o.count})</option>)}
    </select>
  );
}
