import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { getCtx } from '@/lib/context';
import { PageHeader } from '@/components/shell/PageHeader';

/** A document ID that matches no document, current or former (page.tsx calls notFound(): HTTP 404). */
export default async function DocumentNotFound() {
  const { t } = await getCtx();
  return (
    <>
      <PageHeader title={<><Icon name="search" size={20} style={{ color: 'var(--color-accent)', marginRight: 8, verticalAlign: '-2px' }} />{t.not_found}</>} />
      <div className="screen">
        <Link href="/" className="btn btn-secondary">{t.back_home}</Link>
      </div>
    </>
  );
}
