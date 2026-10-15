import Link from 'next/link';
import type { T } from '@/lib/i18n';
import { Icon } from './Icon';

/**
 * Previous and next pages of a list paged in its URL (`page`), and « Page 2 sur 5 » between them; nothing when the
 * list fits on one page. `href` gives the URL of a page, the list's other criteria kept.
 */
export function Pager({ t, page, pages, href }: { t: T; page: number; pages: number; href: (page: number) => string }) {
  if (pages <= 1) return null;
  const step = { fontSize: 12, padding: '4px 10px' };
  const link = (to: number, rel: 'prev' | 'next', label: string) =>
    to >= 1 && to <= pages
      ? <Link href={href(to)} rel={rel} className="btn btn-secondary" style={step} aria-label={label} title={label}>{rel === 'prev' ? <Icon name="chevronLeft" size={14} /> : <Icon name="chevronRight" size={14} />}</Link>
      : <span className="btn btn-secondary" style={{ ...step, opacity: 0.45, cursor: 'default' }} aria-disabled="true" aria-label={label}>{rel === 'prev' ? <Icon name="chevronLeft" size={14} /> : <Icon name="chevronRight" size={14} />}</span>;
  return (
    <nav aria-label={t.pages_nav} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {link(page - 1, 'prev', t.page_prev)}
      <span className="text-muted tabnum" style={{ fontSize: 12 }}>{t.page_of.replace('{n}', String(page)).replace('{m}', String(pages))}</span>
      {link(page + 1, 'next', t.page_next)}
    </nav>
  );
}
