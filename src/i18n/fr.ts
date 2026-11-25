// French translations of the English source strings (src/i18n/index.ts). One entry per source; a source identical in
// French is listed in SAME_IN_FRENCH instead. Checked by tests/unit/i18n-sources.test.ts: every literal passed to
// `tr()` (or to `t()` in the charte's components Codex uses) has its entry, and every entry is used.

export const FR: Record<string, string> = {
  // Shell: sidebar
  'Main menu': 'Menu principal',
  'Close menu': 'Fermer le menu',
  'Group DMS': 'GED Groupe',
  Home: 'Accueil',
  Browse: 'Explorateur',
  Search: 'Recherche',
  Departments: 'Départements',
  Approvals: 'Validations',
  'Archiving & retention': 'Archivage & rétention',
  Help: 'Aide',
  'To do': 'À traiter',
  'Linked app': 'Application liée',
  'Design notes': 'Notes de conception',
  'Sign out': 'Se déconnecter',
  'Simulate a user': 'Simuler un utilisateur',
  // Shell: page search (⌘K)
  'Go to a page…': 'Aller à une page…',
  'No page matches': 'Aucune page ne correspond',
  // Shell: page headers (Norma 2.0: one per screen) and the bell
  Dashboard: 'Tableau de bord',
  'Document browser': 'Explorateur documentaire',
  'Document record': 'Fiche document',
  'Advanced search': 'Recherche avancée',
  'Department page': 'Page du département',
  'Approval workflows': 'Circuits de validation',
  'Search documents, references, keywords…': 'Rechercher un document, une référence, un mot-clé…',
  'Nothing to do for now.': 'Rien à traiter pour le moment.',
  'Recent activity': 'Activité récente',
  'Nothing new.': 'Rien de nouveau.',
  // Language over display (Norma 2.0, PrefsStack; group « Dark / light display » → « Affichage »)
  Language: 'Langue',
  'Dark / light display': 'Affichage',
  'Dark display': 'Affichage sombre',
  'Light display': 'Affichage clair',
  // Side panel and charte components
  Close: 'Fermer',
  'Skip to main content': 'Aller au contenu',
  // Record dialogs: a document searched as you type (DocPicker)
  'Search by ID or title…': 'Rechercher par identifiant ou titre…',
  'The documents could not be read; try again.': 'Les documents n’ont pas pu être lus ; réessayez.',
  'Only the first {n} matches are shown: narrow the search.': 'Seuls les {n} premiers résultats sont affichés : précisez la recherche.',
};

/** Sources whose French is the same word: checked as such, never given an entry. */
export const SAME_IN_FRENCH: readonly string[] = ['Actions', 'Administration', 'Menu', 'Notifications'];
