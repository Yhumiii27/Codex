import Link from 'next/link';
import { PageHeader } from '@/components/shell/PageHeader';
import { Icon } from './Icon';

export function Forbidden({ text, back }: { text: string; back: string }) {
  return (
    <>
      {/* The refusal names the page (its only <h1>), in the common header with the language and the display. */}
      <PageHeader title={<><Icon name="lock" size={20} style={{ color: 'var(--color-accent)', marginRight: 8, verticalAlign: '-2px' }} />{text}</>} />
      <div className="screen">
        <Link href="/" className="btn btn-secondary">{back}</Link>
      </div>
    </>
  );
}
