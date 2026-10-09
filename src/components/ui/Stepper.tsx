import type { CSSProperties } from 'react';

export type StepState = 'done' | 'current' | 'todo';

/** Dot / ring / glow / connector colours of the design's progress steppers. */
function look(state: StepState, last: boolean, glow = 12, mutedPct = 55) {
  return {
    dot: {
      borderRadius: '50%', flex: 'none',
      background: state === 'done' ? 'var(--color-accent)' : 'transparent',
      border: `1.5px solid ${state === 'todo' ? 'var(--color-neutral-700)' : 'var(--color-accent)'}`,
      boxShadow: state === 'current' ? `0 0 ${glow}px color-mix(in srgb,var(--color-accent) 55%,transparent)` : 'none',
    } satisfies CSSProperties,
    line: { background: state === 'done' ? 'var(--color-accent)' : 'var(--color-neutral-800)', visibility: last ? 'hidden' : 'visible' } satisfies CSSProperties,
    name: state === 'todo' ? `color-mix(in srgb,var(--color-text) ${mutedPct}%,transparent)` : 'inherit',
  };
}

export type StepItem = { key: string | number; state: StepState; title: string; lines?: string[] };

/** Horizontal stepper (project stages, workflow steps). */
export function HStepper({ items, dot = 14, gap = 10, glow = 12, mutedPct = 55, titleSize = 13, minWidth = 150, wrap = true }: {
  items: StepItem[]; dot?: number; gap?: number; glow?: number; mutedPct?: number; titleSize?: number; minWidth?: number; wrap?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: wrap ? 'wrap' : 'nowrap', rowGap: 18 }}>
      {items.map((it, i) => {
        const l = look(it.state, i === items.length - 1, glow, mutedPct);
        return (
          <div key={it.key} style={{ flex: 1, minWidth, display: 'flex', flexDirection: 'column', gap }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ ...l.dot, width: dot, height: dot }} />
              <div style={{ flex: 1, height: 1, ...l.line }} />
            </div>
            <div style={{ paddingRight: titleSize >= 13 ? 16 : 6 }}>
              <div style={{ fontSize: titleSize, color: l.name }}>{it.title}</div>
              {it.lines?.map((x, j) => <div key={j} className="text-muted" style={{ fontSize: 11 }}>{x}</div>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Vertical stepper (approval tab of the document record). */
export function VStepper({ items }: { items: StepItem[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {items.map((it, i) => {
        const l = look(it.state, i === items.length - 1);
        return (
          <div key={it.key} style={{ display: 'flex', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 16, flex: 'none' }}>
              <div style={{ ...l.dot, width: 12, height: 12, marginTop: 3 }} />
              <div style={{ flex: 1, width: 1, minHeight: 22, ...l.line }} />
            </div>
            <div style={{ paddingBottom: 14, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: l.name }}>{it.title}</div>
              {it.lines?.map((x, j) => <div key={j} className="text-muted" style={{ fontSize: 11 }}>{x}</div>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
