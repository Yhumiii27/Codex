'use client';

import Link from 'next/link';
import { useEffect, useMemo } from 'react';
import { useApp } from '@/components/shell/AppProvider';
import { Icon } from '@/components/ui/Icon';
import { PageHeader } from '@/components/shell/PageHeader';
import { clientRefFor, sendClientReport } from '@/lib/client-error-report';
import { errorRef } from '@/lib/errors';

/**
 * Last-resort screen for an unexpected error of a screen; the shell stays in place (an error of the root layout itself
 * goes to global-error.tsx). Never the error's message: the reference the technical log carries (lib/errors.ts), which
 * Next.js gives the browser for a server error. `retry` fetches the screen again from the server and renders it anew
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md).
 */
export default function ErrorScreen({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { t } = useApp();
  // A server error carries its reference; one of the browser gets its own, reported to the technical log (lib/client-errors.ts).
  const serverRef = errorRef(error);
  const clientRef = useMemo(() => (serverRef ? null : clientRefFor(error)), [error, serverRef]);
  useEffect(() => { if (clientRef) sendClientReport(error, clientRef); }, [error, clientRef]);
  const ref = serverRef ?? clientRef;
  // The browser's console only: the server already wrote its own entry (lib/log.ts logRequestError, traceAction).
  useEffect(() => { console.error(error); }, [error]);
  return (
    <>
    <PageHeader title={<><Icon name="info" size={20} style={{ color: 'var(--color-accent)', marginRight: 8, verticalAlign: '-2px' }} />{t.error}</>} />
    <div className="screen" role="alert">
      <div style={{ maxWidth: 560 }}>
        <p className="text-muted" style={{ margin: '0 0 6px', fontSize: 12.5 }}>{ref ? t.error_hint : t.error_browser}</p>
        {ref && <p style={{ margin: '0 0 14px', fontSize: 12.5 }}><code className="tabnum" style={{ userSelect: 'all' }}>{t.error_ref.replace('{ref}', ref)}</code></p>}
        <div style={{ display: 'flex', gap: 8, marginTop: ref ? 0 : 8 }}>
          <button type="button" className="btn btn-secondary" onClick={() => retry()}>{t.retry}</button>
          <Link href="/" className="btn btn-secondary">{t.back_home}</Link>
        </div>
      </div>
    </div>
    </>
  );
}
