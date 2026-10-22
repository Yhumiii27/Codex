import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { getCtx } from '@/lib/context';

/** A document ID that matches no document, current or former (page.tsx calls notFound(): HTTP 404). */
export default async function DocumentNotFound() {
  const { t } = await getCtx();
  return (
    <div className="screen" style={{ padding: 'var(--space-8)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <Icon name="search" size={16} style={{ color: 'var(--color-accent)', marginTop: 2 }} />
      <div>
        <p style={{ margin: '0 0 12px' }}>{t.not_found}</p>
        <Link href="/" className="btn btn-secondary">{t.back_home}</Link>
      </div>
    </div>
  );
}
