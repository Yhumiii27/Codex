import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { getCtx } from '@/lib/context';
import { PageHeader } from '@/components/shell/PageHeader';

/** An address that matches no screen (HTTP 404), inside the shell, in the user's language. */
export default async function NotFound() {
  const { t } = await getCtx();
  return (
    <>
      <PageHeader title={<><Icon name="search" size={20} style={{ color: 'var(--color-accent)', marginRight: 8, verticalAlign: '-2px' }} />{t.page_not_found}</>} subtitle={t.page_not_found_hint} />
      <div className="screen">
        <Link href="/" className="btn btn-secondary">{t.back_home}</Link>
      </div>
    </>
  );
}
