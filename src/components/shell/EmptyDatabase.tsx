import { ERROR_EN as en, ERROR_FR as fr } from '@/lib/i18n-errors';

/**
 * The whole document while the database is empty (a PostgreSQL server left unseeded: src/db/index.ts seedIfEmpty), in
 * place of the shell, which needs a person to act as (lib/context.ts getCtx). Rendered by the root layout; no language
 * cookie can be read from a person yet, so French and English side by side, as global-error.tsx does. It names the
 * variables to set, never their values nor the server's address.
 */
export function EmptyDatabase() {
  const both = (a: string, b: string) => (a === b ? a : `${a} · ${b}`);
  return (
    <main id="contenu" role="main" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--space-8)', fontSize: 13 }}>
      <div style={{ maxWidth: 620 }}>
        <h1 style={{ margin: '0 0 12px', fontSize: 18 }}>{both(fr.empty_title, en.empty_title)}</h1>
        {([fr, en] as const).map((d, i) => (
          <section key={i} lang={i ? 'en' : 'fr'} style={{ margin: '0 0 14px' }}>
            <p style={{ margin: '0 0 6px' }}>{d.empty_body}</p>
            <ul style={{ margin: '0 0 6px', paddingLeft: 18 }}>
              <li>{d.empty_minimal}</li>
              <li>{d.empty_demo}</li>
            </ul>
            <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>{d.empty_restart}</p>
          </section>
        ))}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full load: once filled, the shell is rendered again. */}
        <a href="/" className="btn btn-secondary">{both(fr.empty_retry, en.empty_retry)}</a>
      </div>
    </main>
  );
}
