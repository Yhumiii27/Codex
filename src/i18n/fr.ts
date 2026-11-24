// French translations of the English source strings (src/i18n/index.ts). One entry per source; a source identical in
// French is listed in SAME_IN_FRENCH instead. Checked by tests/unit/i18n-sources.test.ts: every literal passed to
// `tr()` (or to `t()` in the charte's components Codex uses) has its entry, and every entry is used.

export const FR: Record<string, string> = {
  // Shell: sidebar
  'Main navigation': 'Navigation principale',
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
  // Shell: header
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
  // Dark / light display (Norma 1.1.0: group « Dark / light display » → « Affichage »)
  'Dark / light display': 'Affichage',
  'Dark display': 'Affichage sombre',
  'Light display': 'Affichage clair',
  // Side panel and charte components
  Close: 'Fermer',
  'Skip to content': 'Aller au contenu',
};

/** Sources whose French is the same word: checked as such, never given an entry. */
export const SAME_IN_FRENCH: readonly string[] = ['Administration', 'Notifications'];
