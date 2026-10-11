'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

/** Department shown on /departements/[code]: choosing another one opens its page. */
export function DepartmentPicker({ value, options, ariaLabel }: { value: string; options: { key: string; label: string }[]; ariaLabel: string }) {
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
        start(() => router.push(`/departements/${encodeURIComponent(v)}`));
      }}
      style={{ width: 'auto', minHeight: 34, fontSize: 13, padding: '4px 30px 4px 10px' }}
    >
      {options.map((o) => <option key={o.key} value={o.key}>{o.key} · {o.label}</option>)}
    </select>
  );
}
