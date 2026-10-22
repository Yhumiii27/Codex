// Strings of the error screens (src/app/error.tsx, global-error.tsx, lib/errors.ts), part of the dictionaries of
// lib/i18n.ts. Apart so that global-error.tsx, which renders without the shell and so without the user's dictionary,
// takes both languages from here without bringing the whole of lib/i18n.ts into the browser.

export const ERROR_FR = {
  error: 'Une erreur est survenue',
  error_ref: 'Réf. {ref}',
  error_hint: 'Réessayez. Si l’erreur persiste, transmettez cette référence à l’administrateur : elle permet de retrouver l’erreur dans le journal technique du serveur.',
  error_browser: 'L’erreur s’est produite dans le navigateur. Réessayez ou rechargez la page.',
  retry: 'Réessayer',
  back_home: 'Retour à l’accueil',
  empty_title: 'La base de Codex est vide',
  empty_body: 'Codex est relié à un serveur PostgreSQL (DATABASE_URL) dont le schéma codex ne contient encore aucune donnée, et aucun remplissage n’a été demandé : rien n’a été écrit.',
  empty_minimal: 'Pour une mise en service : CODEX_SEED=minimal charge le référentiel (registre des types, fonctions, matrice des droits, organisation provisoire) et un administrateur initial.',
  empty_demo: 'Pour une démonstration (bêta) : CODEX_SEED=demo, ou CODEX_SEED_DEMO=1.',
  empty_restart: 'Posez l’une de ces variables dans l’environnement du serveur, puis redémarrez Codex (docs/exploitation.md, § 10).',
  empty_retry: 'Recharger',
};

export const ERROR_EN: Record<keyof typeof ERROR_FR, string> = {
  error: 'Something went wrong',
  error_ref: 'Ref. {ref}',
  error_hint: 'Try again. If the error persists, send this reference to the administrator: it locates the error in the server’s technical log.',
  error_browser: 'The error occurred in the browser. Try again or reload the page.',
  retry: 'Try again',
  back_home: 'Back to home',
  empty_title: 'Codex’s database is empty',
  empty_body: 'Codex is connected to a PostgreSQL server (DATABASE_URL) whose schema codex holds no data yet, and no seeding was asked for: nothing was written.',
  empty_minimal: 'To put it into service: CODEX_SEED=minimal loads the reference data (register of types, functions, permission matrix, provisional organisation) and an initial administrator.',
  empty_demo: 'For a demonstration (beta): CODEX_SEED=demo, or CODEX_SEED_DEMO=1.',
  empty_restart: 'Set one of these variables in the server’s environment, then restart Codex (docs/exploitation.md, § 10).',
  empty_retry: 'Reload',
};
