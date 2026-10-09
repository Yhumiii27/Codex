'use client';

import { useEffect } from 'react';

/** Last-resort screen for an unexpected server or render error; the shell stays in place. */
export default function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="screen" style={{ padding: 'var(--space-8)' }}>
      <h5 style={{ margin: '0 0 6px' }}>Une erreur est survenue · Something went wrong</h5>
      <p className="text-muted" style={{ margin: '0 0 14px', fontSize: 12.5 }}>{error.digest ? `Réf. ${error.digest}` : error.message}</p>
      <button type="button" className="btn btn-secondary" onClick={reset}>Réessayer · Retry</button>
    </div>
  );
}
