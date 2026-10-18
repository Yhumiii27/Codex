'use client';

import { useTransition, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/components/shell/AppProvider';
import type { DialogSpec } from '@/components/dialogs/types';
import type { ActionResult } from '@/lib/actions';
import { failureText } from '@/lib/errors';
import { Icon, type IconName } from './Icon';

/** A button that opens one of the app dialogs. `deniedTitle` disables it (permission missing). */
export function DialogButton({ spec, className = 'btn btn-secondary', icon, iconSw, children, style, deniedTitle, ariaLabel }: {
  spec: DialogSpec; className?: string; icon?: IconName; iconSw?: number; children?: ReactNode; style?: CSSProperties; deniedTitle?: string; ariaLabel?: string;
}) {
  const { open } = useApp();
  return (
    <button type="button" className={className} style={style} aria-label={ariaLabel} aria-disabled={deniedTitle ? true : undefined} title={deniedTitle} onClick={() => { if (!deniedTitle) open(spec); }}>
      {icon && <Icon name={icon} size={14} sw={iconSw} />}{children}
    </button>
  );
}

/**
 * Table row that navigates on click (and optionally a different target on double click). The keyboard path is a real
 * link inside the row (its title cell): clicks on that link are left to it.
 */
export function ClickRow({ href, onSelect, children, style, className }: { href: string; onSelect?: string; children: ReactNode; style?: CSSProperties; className?: string }) {
  const router = useRouter();
  const fromLink = (e: MouseEvent) => !!(e.target as HTMLElement).closest('a');
  return (
    <tr
      className={className}
      style={{ cursor: 'pointer', ...style }}
      onClick={(e) => { if (!fromLink(e)) router.push(onSelect ?? href, { scroll: false }); }}
      onDoubleClick={onSelect ? () => router.push(href) : undefined}
    >
      {children}
    </tr>
  );
}

/** Calls a server action from a button, toasting errors. */
export function ActionButton({ action, className = 'btn btn-secondary', children, style, disabled, title, confirm, ariaLabel, after }: {
  action: () => Promise<ActionResult>; className?: string; children: ReactNode; style?: CSSProperties; disabled?: boolean; title?: string; confirm?: string; ariaLabel?: string;
  /** Where to stay after success (keeps the current selection in the URL). */
  after?: string;
}) {
  const { t, toast } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={className}
      style={style}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled || pending}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          try {
            const r = await action();
            if (!r.ok) { toast(r.error, true); router.refresh(); }
            else { if (r.href ?? after) router.replace((r.href ?? after)!, { scroll: false }); if (r.message) toast(r.message); if (r.warning) toast(r.warning, 'warn'); }
          } catch (err) {
            toast(failureText(t, err), true);
          }
        });
      }}
    >
      {children}
    </button>
  );
}

/**
 * Copies the address of the page (the document's record) to the clipboard. Its accessible name and tooltip say so
 * (« Copier le lien du document »): it shares nothing by itself; a controlled sharing with an outside party waits for M07
 * (point 94 of docs/reste-a-faire.md). Same look as the mock-up's button.
 */
export function ShareButton() {
  const { t, toast } = useApp();
  return (
    <button
      type="button"
      className="btn btn-secondary btn-icon"
      aria-label={t.copy_link}
      title={t.copy_link}
      onClick={async () => {
        try { await navigator.clipboard.writeText(window.location.href); toast(t.link_copied); } catch { toast(window.location.href); }
      }}
    >
      <Icon name="more" sw={2.6} />
    </button>
  );
}
