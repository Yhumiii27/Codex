import Link from 'next/link';
import { Icon } from './Icon';

export function Forbidden({ text, back }: { text: string; back: string }) {
  return (
    <div className="screen" style={{ padding: 'var(--space-8)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <Icon name="lock" size={16} style={{ color: 'var(--color-accent)', marginTop: 2 }} />
      <div>
        <p style={{ margin: '0 0 12px' }}>{text}</p>
        <Link href="/" className="btn btn-secondary">{back}</Link>
      </div>
    </div>
  );
}
