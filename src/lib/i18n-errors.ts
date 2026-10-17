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
};

export const ERROR_EN: Record<keyof typeof ERROR_FR, string> = {
  error: 'Something went wrong',
  error_ref: 'Ref. {ref}',
  error_hint: 'Try again. If the error persists, send this reference to the administrator: it locates the error in the server’s technical log.',
  error_browser: 'The error occurred in the browser. Try again or reload the page.',
  retry: 'Try again',
  back_home: 'Back to home',
};
