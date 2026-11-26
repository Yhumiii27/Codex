'use client';

import { useEffect, useMemo } from 'react';
import { interClassName } from '@/fonts/inter';
import { clientRefFor, sendClientReport } from '@/lib/client-error-report';
import { errorRef } from '@/lib/errors';
import { msg, translate } from '@/i18n';
import './nocturne.css';
import './globals.css';

/**
 * An error of the root layout itself (src/app/layout.tsx: the database out of reach, a failed migration), which error.tsx
 * does not cover. It replaces the whole document: its own <html> and <body>, Nocturne and Inter imported here, no shell
 * and no AppProvider, so no language either (the layout that reads it failed): French and English side by side. Never
 * the error's message: the reference the technical log carries (lib/errors.ts). `retry` renders the layout again.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  // A server error carries its reference; one of the browser gets its own, reported to the technical log (lib/client-errors.ts).
  const serverRef = errorRef(error);
  const clientRef = useMemo(() => (serverRef ? null : clientRefFor(error)), [error, serverRef]);
  useEffect(() => { if (clientRef) sendClientReport(error, clientRef); }, [error, clientRef]);
  const ref = serverRef ?? clientRef;
  useEffect(() => { console.error(error); }, [error]);
  const both = (source: string) => {
    const [a, b] = [translate('fr', source), translate('en', source)];
    return a === b ? a : `${a} · ${b}`;
  };
  return (
    <html lang="fr" className={interClassName}>
      <body>
        <title>{both(msg('Something went wrong'))}</title>
        <main role="alert" style={{ height: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--space-8)', fontSize: 13 }}>
          <div style={{ maxWidth: 560 }}>
            <h5 style={{ margin: '0 0 10px' }}>{both(msg('Something went wrong'))}</h5>
            <p className="text-muted" style={{ margin: '0 0 4px', fontSize: 12.5 }} lang="fr">{translate('fr', ref ? 'Try again. If the error persists, send this reference to the administrator: it locates the error in the server’s technical log.' : 'The error occurred in the browser. Try again or reload the page.')}</p>
            <p className="text-muted" style={{ margin: '0 0 12px', fontSize: 12.5 }} lang="en">{translate('en', ref ? 'Try again. If the error persists, send this reference to the administrator: it locates the error in the server’s technical log.' : 'The error occurred in the browser. Try again or reload the page.')}</p>
            {ref && <p style={{ margin: '0 0 14px', fontSize: 12.5 }}><code style={{ userSelect: 'all' }}>{translate('fr', 'Ref. {ref}', { ref })}</code></p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-secondary" onClick={() => retry()}>{both(msg('Try again'))}</button>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full load, not the client router: the root layout it would keep is the one that failed. */}
              <a href="/" className="btn btn-secondary">{both(msg('Back to home'))}</a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
