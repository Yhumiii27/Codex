import type { Conf, Disposition, RetentionTrigger } from '@/db/schema';

// Records of the personnel file filed by Cursus (Cursus's request « lot 16 », REQUESTS.md, 10 November 2026; owner's
// approval of 26 November 2026; proposal D-32 of docs/decisions.md). A record is a piece received (an absence
// certificate, a training certificate, an expense receipt…), not a document to approve: it is filed already in force,
// without circuit nor later revision, and kept, read and destroyed by the application that filed it. Pure: read by the
// deposit (lib/importer.ts), the rights (lib/access.ts), the actions of the record screen (lib/actions.ts) and the routes
// of Cursus (src/app/api/documents/[id]/file, …/destroy).

/** The record type of the register (src/db/registry.ts): « Dossier du personnel — enregistrement », department RHU. */
export const RECORD_TYPE = 'DPE';
/** Types whose documents are records: filed by an application only, never drafted, revised nor approved in Codex. */
export const RECORD_TYPES: readonly string[] = [RECORD_TYPE];
/** Department of the personnel file (HR), the context of the records' IDs (DPE-RHU-0001). */
export const RECORD_DEPARTMENT = 'RHU';

/** System user of Cursus (created at its first deposit, lib/importer.ts): the owner of every record it files, never a person signed in. */
export const CURSUS_ACTOR = 'cursus';
/** Prefix of the source references Cursus files under (`cursus:piece/<id>`): its routes read and destroy those only. */
export const CURSUS_PREFIX = 'cursus:';

/**
 * Function whose holders read the « très confidentiel » records of Cursus in Codex: the people the HR department
 * designates (Administration › Fonctions & circuits). Nobody else does, records managers included (D-32).
 */
export const HR_RECORD_READER = 'lecteur_dossier_personnel';

/** Matricule of the person a record is about: Cursus's `EMP-…`, or `I…` (temporary worker) / `E…` (outside person on site). */
export const SUBJECT_MATRICULE_RE = /^(EMP-[0-9]{4,}|[IE][0-9]+)$/;

/** Why a record is destroyed by the application (POST /api/documents/{id}/destroy). */
export const DESTROY_REASONS = ['retrait', 'conservation', 'effacement'] as const;
export type DestroyReason = (typeof DESTROY_REASONS)[number];

export type RecordCategory = {
  /** Code Cursus sends (`category`); one per kind of piece of its table (pieces.objet). */
  code: string;
  label: { fr: string; en: string };
  conf: Conf;
  /** Retention, to be confirmed by the DPO: years after the trigger, then destroyed. `expiry`: the date Cursus computes (`expiresAt`). */
  retention: { years: number; trigger: RetentionTrigger; disposition: Disposition };
  /** The record may hold health data: its title stays neutral, its access the strictest. */
  health: boolean;
};

/**
 * Categories of the personnel file (Cursus's table of `docs/demandes/codex-lot16-documents.md`, durations of Cursus's
 * docs/RGPD.md § 5, all to be confirmed by the DPO). The sub-type of the record is the category's French label.
 */
export const RECORD_CATEGORIES: readonly RecordCategory[] = [
  { code: 'absence', label: { fr: 'Justificatif d’absence', en: 'Absence certificate' }, conf: 'tres_confidentiel', retention: { years: 5, trigger: 'employee_departure', disposition: 'destroy' }, health: true },
  { code: 'identity', label: { fr: 'Passeport ou visa', en: 'Passport or visa' }, conf: 'tres_confidentiel', retention: { years: 0, trigger: 'employee_departure', disposition: 'destroy' }, health: false },
  { code: 'vaccination', label: { fr: 'Carnet de vaccination', en: 'Vaccination record' }, conf: 'tres_confidentiel', retention: { years: 5, trigger: 'employee_departure', disposition: 'destroy' }, health: true },
  { code: 'training_certificate', label: { fr: 'Attestation de formation', en: 'Training certificate' }, conf: 'confidentiel', retention: { years: 5, trigger: 'employee_departure', disposition: 'destroy' }, health: false },
  { code: 'authorisation', label: { fr: 'Titre d’habilitation signé', en: 'Signed authorisation' }, conf: 'confidentiel', retention: { years: 5, trigger: 'employee_departure', disposition: 'destroy' }, health: false },
  { code: 'travel', label: { fr: 'Pièce de dossier de déplacement', en: 'Business travel document' }, conf: 'confidentiel', retention: { years: 5, trigger: 'employee_departure', disposition: 'destroy' }, health: false },
  { code: 'expense', label: { fr: 'Justificatif de note de frais', en: 'Expense receipt' }, conf: 'confidentiel', retention: { years: 0, trigger: 'expiry', disposition: 'destroy' }, health: false },
  { code: 'expense_health', label: { fr: 'Justificatif de note de frais (accès restreint)', en: 'Expense receipt (restricted)' }, conf: 'tres_confidentiel', retention: { years: 0, trigger: 'expiry', disposition: 'destroy' }, health: true },
  { code: 'personal_vehicle', label: { fr: 'Carte grise ou assurance du véhicule personnel', en: 'Personal vehicle registration or insurance' }, conf: 'confidentiel', retention: { years: 0, trigger: 'expiry', disposition: 'destroy' }, health: false },
  { code: 'opco', label: { fr: 'Pièce de dossier OPCO', en: 'OPCO file document' }, conf: 'confidentiel', retention: { years: 0, trigger: 'expiry', disposition: 'destroy' }, health: false },
  { code: 'interview_report', label: { fr: 'Compte rendu d’entretien signé', en: 'Signed interview report' }, conf: 'confidentiel', retention: { years: 5, trigger: 'employee_departure', disposition: 'destroy' }, health: false },
];

export function recordCategory(code: unknown): RecordCategory | null {
  return typeof code === 'string' ? RECORD_CATEGORIES.find((c) => c.code === code.trim()) ?? null : null;
}

export function isRecordType(typeCode: string | null | undefined): boolean {
  return !!typeCode && RECORD_TYPES.includes(typeCode);
}

/** A source reference of Cursus (`cursus:piece/<id>`): only those are read and destroyed through Cursus's routes. */
export function isCursusRef(ref: string | null | undefined): boolean {
  return !!ref && ref.startsWith(CURSUS_PREFIX);
}

/**
 * A record of Cursus no one outside its HR readers may see: highly confidential and owned by Cursus's account. The
 * records managers' « sees everything » does not reach it (D-32).
 */
export function isRestrictedRecord(d: { ownerId: string; conf: string }): boolean {
  return d.ownerId === CURSUS_ACTOR && d.conf === 'tres_confidentiel';
}
