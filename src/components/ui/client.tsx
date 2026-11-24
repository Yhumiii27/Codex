'use client';

import { useTransition, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useHeaderMenu } from '@norma/charte/ds/HeaderActions';
import { useApp } from '@/components/shell/AppProvider';
import type { DialogSpec } from '@/components/dialogs/types';
import type { ActionResult } from '@/lib/actions';
import { failureText } from '@/lib/errors';
import { Icon, type IconName } from './Icon';

/**
 * Class of a page action: its own (a button of the header) or, inside the header's « Actions » menu (Norma 2.0,
 * COQUE.md § 3.3: HeaderMenuContext), a row of that menu.
 */
const MENU_ROW = 'codex-menu-row';

/** A button that opens one of the app dialogs. `deniedTitle` disables it (permission missing). */
export function DialogButton({ spec, className = 'btn btn-secondary', icon, iconSw, children, style, deniedTitle, ariaLabel }: {
  spec: DialogSpec; className?: string; icon?: IconName; iconSw?: number; children?: ReactNode; style?: CSSProperties; deniedTitle?: string; ariaLabel?: string;
}) {
  const { open } = useApp();
  const menu = useHeaderMenu();
  return (
    <button type="button" className={menu ? MENU_ROW : className} role={menu ? 'menuitem' : undefined} style={menu ? undefined : style} aria-label={ariaLabel} aria-disabled={deniedTitle ? true : undefined} title={deniedTitle} onClick={() => { if (!deniedTitle) { menu?.close(); open(spec); } }}>
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
  const menu = useHeaderMenu();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={menu ? MENU_ROW : className}
      role={menu ? 'menuitem' : undefined}
      style={menu ? undefined : style}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled || pending}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        menu?.close();
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
  const menu = useHeaderMenu();
  return (
    <button
      type="button"
      className={menu ? MENU_ROW : 'btn btn-secondary btn-icon'}
      role={menu ? 'menuitem' : undefined}
      aria-label={menu ? undefined : t.copy_link}
      title={t.copy_link}
      onClick={async () => {
        menu?.close();
        try { await navigator.clipboard.writeText(window.location.href); toast(t.link_copied); } catch { toast(window.location.href); }
      }}
    >
      <Icon name="more" sw={2.6} />
      {menu && t.copy_link}
    </button>
  );
}

/**
 * A page action that goes somewhere (a screen, a download, an export): a link drawn as a button, or a row of the header's
 * « Actions » menu. `native`: a plain <a> (a file or an export served by a route), else a Next.js <Link>. `denied`: shown
 * disabled with the reason as its tooltip (no target).
 */
export function ActionLink({ href, className = 'btn btn-secondary', icon, children, style, native, denied, scroll }: {
  href: string; className?: string; icon?: IconName; children: ReactNode; style?: CSSProperties; native?: boolean; denied?: string; scroll?: boolean;
}) {
  const menu = useHeaderMenu();
  const cls = menu ? MENU_ROW : className;
  const inner = <>{icon && <Icon name={icon} size={14} />}{children}</>;
  if (denied) return <button type="button" className={cls} role={menu ? 'menuitem' : undefined} style={menu ? undefined : style} aria-disabled title={denied}>{inner}</button>;
  return native
    ? <a href={href} className={cls} role={menu ? 'menuitem' : undefined} style={menu ? undefined : style} onClick={() => menu?.close()}>{inner}</a>
    : <Link href={href} className={cls} role={menu ? 'menuitem' : undefined} style={menu ? undefined : style} scroll={scroll} onClick={() => menu?.close()}>{inner}</Link>;
}
