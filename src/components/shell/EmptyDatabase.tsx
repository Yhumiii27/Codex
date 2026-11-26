import { msg, translate } from '@/i18n';

/**
 * The whole document while the database is empty (a PostgreSQL server left unseeded: src/db/index.ts seedIfEmpty), in
 * place of the shell, which needs a person to act as (lib/context.ts getCtx). Rendered by the root layout; no language
 * cookie can be read from a person yet, so French and English side by side, as global-error.tsx does. It names the
 * variables to set, never their values nor the server's address.
 */
export function EmptyDatabase() {
  const both = (source: string) => {
    const [a, b] = [translate('fr', source), translate('en', source)];
    return a === b ? a : `${a} · ${b}`;
  };
  return (
    <main id="contenu" role="main" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--space-8)', fontSize: 13 }}>
      <div style={{ maxWidth: 620 }}>
        <h1 style={{ margin: '0 0 12px', fontSize: 18 }}>{both(msg('Codex’s database is empty'))}</h1>
        {(['fr', 'en'] as const).map((lang) => (
          <section key={lang} lang={lang} style={{ margin: '0 0 14px' }}>
            <p style={{ margin: '0 0 6px' }}>{translate(lang, 'Codex is connected to a PostgreSQL server (DATABASE_URL) whose schema codex holds no data yet, and no seeding was asked for: nothing was written.')}</p>
            <ul style={{ margin: '0 0 6px', paddingLeft: 18 }}>
              <li>{translate(lang, 'To put it into service: CODEX_SEED=minimal loads the reference data (register of types, functions, permission matrix, provisional organisation) and an initial administrator.')}</li>
              <li>{translate(lang, 'For a demonstration (beta): CODEX_SEED=demo, or CODEX_SEED_DEMO=1.')}</li>
            </ul>
            <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>{translate(lang, 'Set one of these variables in the server’s environment, then restart Codex (docs/exploitation.md, § 10).')}</p>
          </section>
        ))}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full load: once filled, the shell is rendered again. */}
        <a href="/" className="btn btn-secondary">{both(msg('Reload'))}</a>
      </div>
    </main>
  );
}
