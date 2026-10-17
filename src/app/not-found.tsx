import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { getCtx } from '@/lib/context';

/** An address that matches no screen (HTTP 404), inside the shell, in the user's language. */
export default async function NotFound() {
  const { t } = await getCtx();
  return (
    <div className="screen" style={{ padding: 'var(--space-8)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <Icon name="search" size={16} style={{ color: 'var(--color-accent)', marginTop: 2 }} />
      <div>
        <h5 style={{ margin: '0 0 6px' }}>{t.page_not_found}</h5>
        <p className="text-muted" style={{ margin: '0 0 14px', fontSize: 12.5 }}>{t.page_not_found_hint}</p>
        <Link href="/" className="btn btn-secondary">{t.back_home}</Link>
      </div>
    </div>
  );
}
