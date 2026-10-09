'use client';

import { useOptimistic, useTransition, type CSSProperties, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

export type SegOption = { key: string; label: ReactNode; href?: string; count?: number | string };

/**
 * The design system's segmented control (`.seg` + `.seg-opt` on native radios).
 * Options with an `href` navigate (URL-driven screens); otherwise `onPick` is called.
 */
export function Seg({
  name, options, value, onPick, ariaLabel, style, optStyle, countStyle,
}: {
  name: string;
  options: SegOption[];
  value: string;
  onPick?: (key: string) => void;
  ariaLabel?: string;
  style?: CSSProperties;
  optStyle?: CSSProperties;
  countStyle?: CSSProperties;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [current, setCurrent] = useOptimistic(value);
  return (
    <div className="seg" role="radiogroup" aria-label={ariaLabel} style={style}>
      {options.map((o) => (
        <label key={o.key} className="seg-opt" style={optStyle}>
          <input
            type="radio"
            name={name}
            checked={current === o.key}
            onChange={() => {
              start(() => {
                setCurrent(o.key);
                if (o.href) router.push(o.href, { scroll: false });
                onPick?.(o.key);
              });
            }}
          />
          {o.label}
          {o.count !== undefined && <span className="text-muted" style={countStyle ?? { fontSize: 11 }}>{o.count}</span>}
        </label>
      ))}
    </div>
  );
}
