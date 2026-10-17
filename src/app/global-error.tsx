'use client';

import { Inter } from 'next/font/google';
import { useEffect } from 'react';
import { errorRef } from '@/lib/errors';
import { ERROR_EN as en, ERROR_FR as fr } from '@/lib/i18n-errors';
import './nocturne.css';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

/**
 * An error of the root layout itself (src/app/layout.tsx: the database out of reach, a failed migration), which error.tsx
 * does not cover. It replaces the whole document: its own <html> and <body>, Nocturne and Inter imported here, no shell
 * and no AppProvider, so no language either (the layout that reads it failed): French and English side by side. Never
 * the error's message: the reference the technical log carries (lib/errors.ts). `retry` renders the layout again.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const ref = errorRef(error);
  useEffect(() => { console.error(error); }, [error]);
  const both = (a: string, b: string) => (a === b ? a : `${a} · ${b}`);
  return (
    <html lang="fr" className={inter.variable}>
      <body>
        <title>{both(fr.error, en.error)}</title>
        <main role="alert" style={{ height: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--space-8)', fontSize: 13 }}>
          <div style={{ maxWidth: 560 }}>
            <h5 style={{ margin: '0 0 10px' }}>{both(fr.error, en.error)}</h5>
            <p className="text-muted" style={{ margin: '0 0 4px', fontSize: 12.5 }} lang="fr">{ref ? fr.error_hint : fr.error_browser}</p>
            <p className="text-muted" style={{ margin: '0 0 12px', fontSize: 12.5 }} lang="en">{ref ? en.error_hint : en.error_browser}</p>
            {ref && <p style={{ margin: '0 0 14px', fontSize: 12.5 }}><code style={{ userSelect: 'all' }}>{fr.error_ref.replace('{ref}', ref)}</code></p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-secondary" onClick={() => retry()}>{both(fr.retry, en.retry)}</button>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full load, not the client router: the root layout it would keep is the one that failed. */}
              <a href="/" className="btn btn-secondary">{both(fr.back_home, en.back_home)}</a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
