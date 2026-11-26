import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { translatorFor } from '@/i18n';
import { getCtx } from '@/lib/context';
import { PageHeader } from '@/components/shell/PageHeader';

/** An address that matches no screen (HTTP 404), inside the shell, in the user's language. */
export default async function NotFound() {
  const tr = translatorFor((await getCtx()).lang);
  return (
    <>
      <PageHeader title={<><Icon name="search" size={20} style={{ color: 'var(--color-accent)', marginRight: 8, verticalAlign: '-2px' }} />{tr('Page not found')}</>} subtitle={tr('This address matches no screen of Codex.')} />
      <div className="screen">
        <Link href="/" className="btn btn-secondary">{tr('Back to home')}</Link>
      </div>
    </>
  );
}
