'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useApp } from '@/components/shell/AppProvider';
import { Icon } from '@/components/ui/Icon';
import { errorRef } from '@/lib/errors';

/**
 * Last-resort screen for an unexpected error of a screen; the shell stays in place (an error of the root layout itself
 * goes to global-error.tsx). Never the error's message: the reference the technical log carries (lib/errors.ts), which
 * Next.js gives the browser for a server error. `retry` fetches the screen again from the server and renders it anew
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md).
 */
export default function ErrorScreen({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { t } = useApp();
  const ref = errorRef(error);
  // The browser's console only: the server already wrote its own entry (lib/log.ts logRequestError, traceAction).
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="screen" role="alert" style={{ padding: 'var(--space-8)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <Icon name="info" size={16} style={{ color: 'var(--color-accent)', marginTop: 2 }} />
      <div style={{ maxWidth: 560 }}>
        <h5 style={{ margin: '0 0 6px' }}>{t.error}</h5>
        <p className="text-muted" style={{ margin: '0 0 6px', fontSize: 12.5 }}>{ref ? t.error_hint : t.error_browser}</p>
        {ref && <p style={{ margin: '0 0 14px', fontSize: 12.5 }}><code className="tabnum" style={{ userSelect: 'all' }}>{t.error_ref.replace('{ref}', ref)}</code></p>}
        <div style={{ display: 'flex', gap: 8, marginTop: ref ? 0 : 8 }}>
          <button type="button" className="btn btn-secondary" onClick={() => retry()}>{t.retry}</button>
          <Link href="/" className="btn btn-secondary">{t.back_home}</Link>
        </div>
      </div>
    </div>
  );
}
