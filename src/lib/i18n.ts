// The language of the interface and the coded values Codex shows (statuses, levels, roles, permissions). Their labels
// are English source strings translated by src/i18n (Norma § 2, CX-N01): src/i18n/labels.ts.

export type Lang = 'fr' | 'en';

/** Headline statuses of a document (lists, filters, facets). */
export const STATUS_KEYS = ['draft', 'in_review', 'approved', 'in_force', 'obsolete', 'archived'] as const;
export const TAGCLS: Record<string, string> = { draft: 'tag tag-neutral', in_review: 'tag tag-outline', approved: 'tag tag-outline', in_force: 'tag tag-accent', superseded: 'tag tag-neutral', cancelled: 'tag tag-neutral', obsolete: 'tag tag-neutral', archived: 'tag tag-neutral' };
/** Tag of a change request status (record › Demandes, Validations › Mes demandes Vigie). */
export const ECR_TAGCLS: Record<string, string> = { submitted: 'tag tag-outline', accepted: 'tag tag-accent', rejected: 'tag tag-neutral', implemented: 'tag tag-accent' };
export const CONF_LEVELS = ['public', 'restreint', 'interne', 'confidentiel', 'tres_confidentiel'] as const;
export const ORIGINS = ['interne', 'externe'] as const;
export const ATTACHMENTS = ['none', 'project', 'research', 'capex'] as const;
/** Who sees a saved search (saved_searches.scope). */
export const SEARCH_SCOPES = ['personal', 'department', 'group'] as const;
/** Lifecycle stages of a Keystone project (Keystone's own labels), offered as project phases. */
export const PROJECT_PHASES = ['Initiative', 'APS', 'APD', 'Etudes', 'Approvisionnements', 'Fabrication & Assemblage', 'FAT', 'Expédition', 'Chantier', 'Mise Service & SAT', 'Garantie', 'Clos'] as const;
export type ProjectPhase = (typeof PROJECT_PHASES)[number];
/**
 * English labels of the phases. PROVISIONAL: written by Codex, to align with Keystone's own English labels once its
 * API is known (O-03); the stored value stays Keystone's French label, which is the key.
 */
export const PROJECT_PHASES_EN: Record<ProjectPhase, string> = {
  Initiative: 'Initiative', APS: 'Preliminary design (APS)', APD: 'Detailed design (APD)', Etudes: 'Engineering', Approvisionnements: 'Procurement',
  'Fabrication & Assemblage': 'Manufacturing & assembly', FAT: 'FAT', Expédition: 'Shipping', Chantier: 'Site works', 'Mise Service & SAT': 'Commissioning & SAT',
  Garantie: 'Warranty', Clos: 'Closed',
};
/** Index of a phase in PROJECT_PHASES, -1 for a value Keystone sent that Codex does not know. */
export const phaseIndex = (v: string | null | undefined): number => (v ? (PROJECT_PHASES as readonly string[]).indexOf(v) : -1);
/** A phase in the reader's language; an unknown value is shown as it is. */
export function phaseLabel(v: string | null | undefined, lang: Lang): string {
  if (!v) return '';
  const i = phaseIndex(v);
  return i < 0 || lang === 'fr' ? v : PROJECT_PHASES_EN[PROJECT_PHASES[i]];
}
/**
 * What a type's retention rests on, in the reader's language: in English, its English wording, else the French one
 * followed by « (FR) » (the register's texts await their legal review, O-07: none is translated by Codex).
 */
export function retentionBasisL(x: { retentionBasis: string; retentionBasisEn: string }, lang: Lang): string {
  if (lang === 'fr' || x.retentionBasisEn.trim()) return lang === 'fr' ? x.retentionBasis : x.retentionBasisEn;
  return x.retentionBasis ? `${x.retentionBasis} (FR)` : '';
}
export const SIM_ROLES = ['collaborateur', 'validateur', 'auditeur', 'gestionnaire'] as const;
export type SimRole = (typeof SIM_ROLES)[number];
/** Row of the permission matrix that governs each simulated role. */
export const MATRIX_ROLE: Record<SimRole, string> = { collaborateur: 'contributeur', validateur: 'validateur', auditeur: 'auditeur', gestionnaire: 'gestionnaire' };
export const MATRIX_ROLES = ['lecteur', 'contributeur', 'gestionnaire', 'validateur', 'auditeur', 'administrateur'] as const;
export const PERMS = ['read', 'upload', 'edit', 'approve', 'publish', 'archive', 'destroy', 'admin'] as const;
export type Perm = (typeof PERMS)[number];
/** Permissions Codex checks somewhere; the others are shown in the matrix but have no action yet. */
export const ENFORCED_PERMS: readonly Perm[] = ['read', 'upload', 'edit', 'approve', 'publish', 'archive', 'admin'];
/** Rows of the matrix that a simulated role reads (the others have no simulated equivalent yet). */
export const SIMULATED_MATRIX_ROLES: readonly string[] = Object.values(MATRIX_ROLE);
