// Demo documents. Project documents follow Keystone's document index (HLT-026, NDC-031); IDs are computed by the
// seed with the TYPE-CONTEXTE-SEQ rule in this order. Letters: `inForce` is the revision in force (earlier letters
// are superseded); `working` is the revision being drafted or reviewed.

import type { Conf, LinkKind } from './schema';

export type DemoDoc = {
  key?: string;
  type: string; title: string; dept: string; owner: string;
  project?: string; program?: string; origin?: 'externe'; source?: string; extRef?: string; received?: string;
  conf?: Conf; kw?: string[]; subtype?: string; site?: string; lang?: string;
  inForce?: string; issued?: string;
  working?: { status: 'draft' | 'in_review'; n: number; done?: number; modifier?: string; changeRef?: string };
  modified: string; expires?: string; reviewDue?: string;
  phase?: string; wp?: string; discipline?: string; theme?: string; study?: string; ip?: string;
  state?: 'obsolete' | 'archived'; stateAt?: string; hold?: boolean; readers?: string[];
  /** For a template (FRM): the types it is meant for. */
  templateFor?: string[];
  /** Created from this template (its `key`): documents.template_id, and the comment of A.1 (lib/actions.ts createDocument). */
  fromTemplate?: string;
};

const HLT = 'HLT-026';

export const DEMO_DOCS: DemoDoc[] = [
  // ── HLT-026 Harbor Line Terminal Expansion ──
  { type: 'PFD', title: 'Schéma de procédé — terminal portuaire', dept: 'MEP', owner: 'pnogues', project: HLT, inForce: 'B', issued: '2026-04-10', modified: '2026-09-02', phase: 'Etudes', discipline: 'Procédé', kw: ['A1410'] },
  { key: 'pid-hlt', type: 'PID', title: 'P&ID — circuit hydraulique des grues', dept: 'MEP', owner: 'pnogues', project: HLT, inForce: 'D', issued: '2026-03-02', modified: '2026-09-26', conf: 'restreint', phase: 'Etudes', discipline: 'Procédé', kw: ['A1410', 'A1420', 'LT-101', 'XV-111'] },
  { type: 'LST', title: 'Liste des instruments', dept: 'MEP', owner: 'pnogues', project: HLT, inForce: 'D', issued: '2026-03-02', modified: '2026-09-26', subtype: 'Liste d’instruments', discipline: 'Procédé', kw: ['A1410', 'A1420'] },
  { type: 'GA', title: 'Plan d’ensemble — portique du quai 4', dept: 'ING', owner: 'jwagner', project: HLT, inForce: 'C', issued: '2026-02-20', modified: '2026-09-15', conf: 'restreint', discipline: 'Mécanique', kw: ['A1320'] },
  { type: 'BOM', title: 'Nomenclature mécanique', dept: 'ING', owner: 'jwagner', project: HLT, inForce: 'C', issued: '2026-03-18', modified: '2026-09-22', working: { status: 'in_review', n: 2, done: 1 }, discipline: 'Mécanique', kw: ['HST-MOT-160', 'CR-MOT-15K'] },
  { type: 'LST', title: 'Liste des moteurs', dept: 'ING', owner: 'jwagner', project: HLT, inForce: 'B', issued: '2026-05-12', modified: '2026-09-18', discipline: 'Mécanique' },
  { type: 'SCH', title: 'Schémas électriques — distribution 11 kV', dept: 'ING', owner: 'shaddad', project: HLT, inForce: 'A', issued: '2026-06-03', modified: '2026-09-24', conf: 'restreint', working: { status: 'draft', n: 2 }, discipline: 'Électricité' },
  { type: 'BOM', title: 'Nomenclature électrique', dept: 'ING', owner: 'shaddad', project: HLT, inForce: 'A', issued: '2026-06-03', modified: '2026-09-24', working: { status: 'draft', n: 1 }, discipline: 'Électricité' },
  { type: 'LST', title: 'Liste des entrées / sorties', dept: 'ING', owner: 'shaddad', project: HLT, inForce: 'A', issued: '2026-06-20', modified: '2026-09-20', working: { status: 'in_review', n: 3, done: 1 }, discipline: 'Électricité' },
  { type: 'LST', title: 'Liste des câbles', dept: 'ING', owner: 'shaddad', project: HLT, modified: '2026-09-25', working: { status: 'draft', n: 1 }, discipline: 'Électricité' },
  { key: 'fds-hlt', type: 'FDS', title: 'Spécification fonctionnelle de la commande des grues', dept: 'ING', owner: 'cmorvan', project: HLT, modified: '2026-09-19', conf: 'restreint', working: { status: 'in_review', n: 2, done: 1 }, discipline: 'Automatisme' },
  { type: 'VAR', title: 'Table de variables automate (export TIA)', dept: 'ING', owner: 'cmorvan', project: HLT, modified: '2026-09-24', working: { status: 'draft', n: 3 }, discipline: 'Automatisme' },
  { type: 'HMI', title: 'Spécification IHM — poste de conduite', dept: 'ING', owner: 'cmorvan', project: HLT, modified: '2026-09-23', conf: 'restreint', working: { status: 'draft', n: 1 }, discipline: 'Automatisme' },
  { type: 'RPT', title: 'Rapport d’alignement des rails de grue', dept: 'QUA', owner: 'gcomte', project: HLT, modified: '2026-09-28', conf: 'restreint', working: { status: 'in_review', n: 1, done: 1 }, phase: 'Chantier' },
  { key: 'man-hlt', type: 'MAN', title: 'Dossier tel que construit — fondations', dept: 'ING', owner: 'jwagner', project: HLT, inForce: 'A', issued: '2026-09-12', modified: '2026-09-12', conf: 'restreint', phase: 'Chantier' },
  { type: 'RPT', title: 'Rapport FAT — entraînement de levage', dept: 'ING', owner: 'cmorvan', project: HLT, modified: '2026-09-27', working: { status: 'draft', n: 2 }, phase: 'FAT' },
  { type: 'NCR', title: 'Implantation des tiges d’ancrage — poteau 7', dept: 'QUA', owner: 'gcomte', project: HLT, inForce: 'A', issued: '2026-09-18', modified: '2026-09-18', phase: 'Chantier' },
  { type: 'NCR', title: 'Épaisseur de peinture insuffisante — poutre G3', dept: 'QUA', owner: 'hsauvage', project: HLT, inForce: 'A', issued: '2026-09-24', modified: '2026-09-24', phase: 'Chantier' },
  { type: 'REC', title: 'Contrôle des soudures — poutres G1 à G4', dept: 'QUA', owner: 'hsauvage', project: HLT, inForce: 'A', issued: '2026-09-09', modified: '2026-09-09' },
  { type: 'RFQ', title: 'Devis Nordvolt — variateurs 200 kW', dept: 'ACH', owner: 'fbertrand', project: HLT, origin: 'externe', source: 'Nordvolt', extRef: 'NV-Q-2026-118', received: '2026-06-10', inForce: 'B', issued: '2026-06-12', modified: '2026-06-30', conf: 'restreint' },
  { type: 'PO', title: 'Commande Nordvolt — variateurs lot 2', dept: 'ACH', owner: 'fbertrand', project: HLT, inForce: 'A', issued: '2026-07-07', modified: '2026-07-07', conf: 'restreint' },
  { type: 'CER', title: 'Certificat matière 3.1 — poutres S355', dept: 'ACH', owner: 'fbertrand', project: HLT, origin: 'externe', source: 'Aciéries du Nord', extRef: 'AN-31-77412', received: '2026-08-21', inForce: 'A', issued: '2026-08-22', modified: '2026-08-22' },
  { type: 'COC', title: 'Certificat de conformité — cellules 11 kV', dept: 'ACH', owner: 'fbertrand', project: HLT, origin: 'externe', source: 'Nordvolt', extRef: 'NV-COC-5521', received: '2026-09-18', inForce: 'A', issued: '2026-09-19', modified: '2026-09-19', conf: 'restreint' },
  { key: 'per-hlt', type: 'PER', title: 'Permis de levage — quai 4', dept: 'CHA', owner: 'lfabre', project: HLT, modified: '2026-09-26', working: { status: 'in_review', n: 1, done: 1 }, expires: '2026-10-31', phase: 'Chantier' },
  { type: 'PER', title: 'Permis de travaux haute tension', dept: 'CHA', owner: 'lfabre', project: HLT, modified: '2026-09-27', working: { status: 'draft', n: 1 }, phase: 'Chantier' },
  { key: 'hse-hlt', type: 'HSE', title: 'Plan de prévention — port du Havre', dept: 'CHA', owner: 'lfabre', project: HLT, inForce: 'B', issued: '2026-04-02', modified: '2026-10-02', conf: 'restreint', reviewDue: '2026-12-15', working: { status: 'draft', n: 1, modifier: 'lfabre', changeRef: 'ECO-2026-002' } },
  { key: 'pv-hlt', type: 'PV', title: 'PV de réception des fondations', dept: 'CHA', owner: 'lfabre', project: HLT, inForce: 'A', issued: '2026-09-12', modified: '2026-09-12', conf: 'restreint', fromTemplate: 'frm-pv' },
  { key: 'ctr-hlt', type: 'CTR', title: 'Contrat principal — Harbor Line Terminal', dept: 'PRJ', owner: 'raubert', project: HLT, inForce: 'A', issued: '2026-01-14', modified: '2026-01-14', conf: 'confidentiel', expires: '2027-06-30', subtype: 'Contrat client' },
  { type: 'CTR', title: 'Avenant n°1 — lidar anticollision', dept: 'PRJ', owner: 'raubert', project: HLT, inForce: 'A', issued: '2026-07-08', modified: '2026-07-08', conf: 'confidentiel', hold: true },
  { type: 'LET', title: 'Courrier — accès restreint au quai 4', dept: 'PRJ', owner: 'raubert', project: HLT, inForce: 'A', issued: '2026-09-22', modified: '2026-09-22', conf: 'restreint' },
  { type: 'MIN', title: 'Compte rendu de réunion hebdomadaire n°23', dept: 'PRJ', owner: 'raubert', project: HLT, inForce: 'A', issued: '2026-09-25', modified: '2026-09-25', conf: 'restreint', fromTemplate: 'frm-min' },
  { type: 'PHO', title: 'Photos de chantier — fondations du poteau 7', dept: 'CHA', owner: 'lfabre', project: HLT, inForce: 'A', issued: '2026-09-18', modified: '2026-09-18' },
  { type: 'VIS', title: 'Rapport de visite — usine Nordvolt', dept: 'ACH', owner: 'fbertrand', project: HLT, inForce: 'A', issued: '2026-09-10', modified: '2026-09-10' },

  // ── NDC-031 Northgate Data Center Retrofit ──
  { key: 'pid-ndc', type: 'PID', title: 'P&ID — boucle de refroidissement', dept: 'MEP', owner: 'pnogues', project: 'NDC-031', inForce: 'B', issued: '2026-06-15', modified: '2026-09-04', conf: 'restreint', discipline: 'Procédé' },
  { type: 'NCR', title: 'Espacement des supports de chemins de câbles', dept: 'QUA', owner: 'gcomte', project: 'NDC-031', inForce: 'A', issued: '2026-09-16', modified: '2026-09-16' },

  // ── Documents of the departments ──
  { key: 'pro-doc', type: 'PRO', title: 'Procédure de maîtrise documentaire', dept: 'QUA', owner: 'gcomte', inForce: 'E', issued: '2022-02-03', modified: '2026-02-03', reviewDue: '2026-11-30', kw: ['GED', 'codification', 'révision'] },
  { type: 'PRO', title: 'Traitement des non-conformités', dept: 'QUA', owner: 'gcomte', inForce: 'C', issued: '2023-03-11', modified: '2026-03-11', reviewDue: '2026-09-30', kw: ['NC', 'CAPA'] },
  { key: 'pro-levage', type: 'PRO', title: 'Levage et manutention sur chantier', dept: 'HSE', owner: 'cbardet', inForce: 'B', issued: '2024-05-06', modified: '2026-10-01', working: { status: 'draft', n: 2 }, kw: ['levage', 'grue', 'élingage'] },
  { type: 'RSQ', title: 'Analyse de risques — atelier de Lyon', dept: 'HSE', owner: 'oblanc', site: 'lyon', modified: '2026-10-05', working: { status: 'in_review', n: 1, done: 1 }, kw: ['DUERP', 'atelier'], fromTemplate: 'frm-rsq' },
  { type: 'PRO', title: 'Procédure de stockage — magasin du Havre (ancienne)', dept: 'HSE', owner: 'cbardet', site: 'le_havre', inForce: 'C', issued: '2019-04-11', modified: '2026-03-01', state: 'obsolete', stateAt: '2026-03-01' },
  { key: 'frm-pv', type: 'FRM', title: 'Modèle — procès-verbal de réception de site', dept: 'QUA', owner: 'gcomte', inForce: 'B', issued: '2025-06-02', modified: '2026-06-02', templateFor: ['PV'] },
  { type: 'FRM', title: 'Modèle — procédure', dept: 'QUA', owner: 'gcomte', inForce: 'A', issued: '2025-01-10', modified: '2025-01-10', templateFor: ['PRO', 'MOP'] },
  { key: 'frm-rsq', type: 'FRM', title: 'Modèle — rapport d’incident', dept: 'HSE', owner: 'cbardet', inForce: 'C', issued: '2024-01-15', modified: '2026-01-15', templateFor: ['RSQ'] },
  { key: 'frm-min', type: 'FRM', title: 'Modèle — compte rendu de réunion', dept: 'QUA', owner: 'gcomte', inForce: 'A', issued: '2025-02-10', modified: '2025-02-10', templateFor: ['MIN'] },
  { type: 'AUD', title: 'Audit interne — processus ingénierie', dept: 'QUA', owner: 'gcomte', inForce: 'A', issued: '2026-05-20', modified: '2026-05-20' },
  { type: 'AUD', title: 'Audit interne — atelier de Lyon (2015)', dept: 'QUA', owner: 'gcomte', site: 'lyon', inForce: 'A', issued: '2015-11-12', modified: '2015-11-12', state: 'archived', stateAt: '2018-01-10' },
  { type: 'POL', title: 'Politique qualité, sécurité et environnement', dept: 'DIR', owner: 'hcosta', inForce: 'C', issued: '2021-01-15', modified: '2026-01-15', kw: ['QSE', 'politique'] },
  { type: 'RHF', title: 'Matrice de compétences — ingénierie', dept: 'RHU', owner: 'nbenali', inForce: 'A', issued: '2026-04-01', modified: '2026-04-01', conf: 'confidentiel' },
  { type: 'RHF', title: 'Fiche de poste — chef de projet', dept: 'RHU', owner: 'nbenali', inForce: 'B', issued: '2024-09-01', modified: '2026-02-12' },
  { type: 'FIN', title: 'Procédure de validation des dépenses', dept: 'FIN', owner: 'tweil', inForce: 'B', issued: '2024-01-08', modified: '2025-12-04' },
  { type: 'SSI', title: 'Plan de reprise d’activité (PRA)', dept: 'DSI', owner: 'mdelorme', inForce: 'A', issued: '2025-11-20', modified: '2025-11-20', conf: 'confidentiel' },
  { type: 'MNT', title: 'Certificats d’étalonnage — clés dynamométriques', dept: 'CHA', owner: 'oblanc', origin: 'externe', source: 'Étalonnage Rhône', extRef: 'ER-2025-0912', received: '2025-11-14', inForce: 'A', issued: '2025-11-15', modified: '2025-11-15', expires: '2026-11-15' },
  { type: 'MNT', title: 'Vérification générale périodique — pont roulant de l’atelier de Lyon', dept: 'CHA', owner: 'oblanc', site: 'lyon', origin: 'externe', source: 'Apave', extRef: 'APV-VGP-2025-3307', received: '2025-09-29', inForce: 'A', issued: '2025-09-30', modified: '2025-09-30', expires: '2026-09-30', kw: ['VGP', 'levage'] },
  { key: 'reg-levage', type: 'REG', title: 'Arrêté du 1er mars 2004 — vérification des appareils de levage', dept: 'HSE', owner: 'cbardet', origin: 'externe', source: 'Légifrance', extRef: 'NOR SOCT0410596A', received: '2024-02-01', inForce: 'A', issued: '2024-02-01', modified: '2024-02-01', conf: 'public' },
  { type: 'NRM', title: 'ISO 9001:2015 — Systèmes de management de la qualité', dept: 'QUA', owner: 'gcomte', origin: 'externe', source: 'AFNOR', extRef: 'NF EN ISO 9001:2015', received: '2015-10-01', inForce: 'A', issued: '2015-10-01', modified: '2015-10-01', conf: 'restreint' },
  { type: 'AUT', title: 'Autorisation d’exploitation — atelier de Lyon', dept: 'JUR', owner: 'irahmani', site: 'lyon', origin: 'externe', source: 'Préfecture du Rhône', extRef: 'AP-2021-0458', received: '2021-12-02', inForce: 'A', issued: '2021-12-02', modified: '2021-12-02', expires: '2026-12-01', conf: 'confidentiel' },
  { type: 'CTR', title: 'Contrat cadre transport 2026-2028', dept: 'JUR', owner: 'irahmani', modified: '2026-10-05', working: { status: 'draft', n: 3 }, conf: 'confidentiel', expires: '2028-12-31' },

  // ── Research ──
  { type: 'PRP', title: 'Proposition de recherche — capteurs connectés', dept: 'RDI', owner: 'yait', program: 'R2601', inForce: 'A', issued: '2026-01-20', modified: '2026-01-20', conf: 'confidentiel', theme: 'Instrumentation' },
  { type: 'PRT', title: 'Protocole d’essai — capteurs de vibration', dept: 'RDI', owner: 'jwagner', program: 'R2601', modified: '2026-10-03', working: { status: 'in_review', n: 2, done: 1 }, conf: 'confidentiel', theme: 'Instrumentation', study: 'E-26-01' },
  { type: 'DBR', title: 'Cahier de laboratoire — campagne de mesures n°1', dept: 'RDI', owner: 'yait', program: 'R2601', inForce: 'A', issued: '2026-06-30', modified: '2026-06-30', conf: 'confidentiel', study: 'E-26-01' },
  { type: 'PIC', title: 'Déclaration d’invention — capteur autonome', dept: 'RDI', owner: 'yait', program: 'R2601', inForce: 'A', issued: '2026-08-04', modified: '2026-08-04', conf: 'tres_confidentiel', readers: ['hcosta'], ip: 'Dépôt en préparation' },
  { type: 'BIB', title: 'État de l’art — bétons bas carbone', dept: 'RDI', owner: 'yait', program: 'R2602', inForce: 'A', issued: '2026-03-12', modified: '2026-03-12', theme: 'Matériaux' },
  { type: 'COL', title: 'Accord de collaboration — laboratoire partenaire', dept: 'RDI', owner: 'yait', program: 'R2602', origin: 'externe', source: 'INSA Lyon', extRef: 'INSA-CONV-2026-14', received: '2026-04-18', inForce: 'A', issued: '2026-04-20', modified: '2026-04-20', conf: 'confidentiel' },
];

/** Pieces Keystone expects on its projects, pointing to demo documents by key. */
export const EXPECTED: { project: string; label: [string, string]; type: string; doc?: string; later?: boolean }[] = [
  { project: HLT, label: ['Contrat principal', 'Main contract'], type: 'CTR', doc: 'ctr-hlt' },
  { project: HLT, label: ['Plan de prévention', 'Prevention plan'], type: 'HSE', doc: 'hse-hlt' },
  { project: HLT, label: ['Permis de levage', 'Lifting permit'], type: 'PER', doc: 'per-hlt' },
  { project: HLT, label: ['P&ID', 'P&ID'], type: 'PID', doc: 'pid-hlt' },
  { project: HLT, label: ['Spécification fonctionnelle', 'Functional specification'], type: 'FDS', doc: 'fds-hlt' },
  { project: HLT, label: ['PV de réception des fondations', 'Foundations acceptance minutes'], type: 'PV', doc: 'pv-hlt' },
  { project: HLT, label: ['Dossier tel que construit', 'As-built file'], type: 'MAN', doc: 'man-hlt' },
  { project: HLT, label: ['Attestation d’assurance chantier', 'Worksite insurance certificate'], type: 'JUR' },
  { project: HLT, label: ['PV de réception finale', 'Final acceptance minutes'], type: 'PV', later: true },
  { project: 'NDC-031', label: ['P&ID', 'P&ID'], type: 'PID', doc: 'pid-ndc' },
  { project: 'NDC-031', label: ['Spécification fonctionnelle', 'Functional specification'], type: 'FDS' },
  { project: 'NDC-031', label: ['Plan HSE', 'HSE plan'], type: 'HSE' },
];

export const EVENTS: { project: string; at: string; text: [string, string] }[] = [
  { project: HLT, at: '2026-10-07 08:40', text: ['Étape « Chantier » confirmée par Romain Aubert', 'Stage “Site” confirmed by Romain Aubert'] },
  { project: HLT, at: '2026-10-02 10:15', text: ['Lot « Levage » attribué à Levage Ouest', 'Lifting work package awarded to Levage Ouest'] },
  { project: HLT, at: '2026-09-26 16:05', text: ['Relance Keystone : attestation d’assurance chantier attendue', 'Keystone reminder: worksite insurance certificate expected'] },
  { project: HLT, at: '2026-09-12 11:30', text: ['Pièce « PV de réception des fondations » déposée', '“Foundations acceptance minutes” filed'] },
  { project: 'NDC-031', at: '2026-09-04 09:00', text: ['P&ID de la boucle de refroidissement en vigueur (rév. B)', 'Cooling loop P&ID in force (rev. B)'] },
];

/** Change requests mirrored from Vigie: [doc key, kind, requester, status, reason, modifier, eco, created]. */
export const CHANGES: { id: string; doc: string; kind: 'modification' | 'obsolescence'; requester: string; status: 'submitted' | 'implemented'; reason: string; description?: string; modifier?: string; eco?: string; created: string; decided?: string }[] = [
  { id: 'ECR-2026-001', doc: 'pro-doc', kind: 'modification', requester: 'jwagner', status: 'submitted', reason: 'Intégrer la codification TYPE-CONTEXTE-SEQ et les versions de travail', description: 'La procédure décrit encore les références D-#### et les indices x.y.', created: '2026-10-06 14:20:00' },
  { id: 'ECR-2026-002', doc: 'hse-hlt', kind: 'modification', requester: 'raubert', status: 'implemented', reason: 'Coactivité avec le grutier Levage Ouest à partir du 15 octobre', modifier: 'lfabre', eco: 'ECO-2026-002', created: '2026-09-29 09:10:00', decided: '2026-10-02 10:15:00' },
  { id: 'ECR-2026-003', doc: 'frm-min', kind: 'obsolescence', requester: 'gcomte', status: 'submitted', reason: 'Remplacé par le compte rendu généré dans Keystone', created: '2026-10-07 11:45:00' },
];

/** Links between demo documents (document_links): [source key, target key, kind, created by, day]. */
export const LINKS: [string, string, LinkKind, string, string][] = [
  ['pro-levage', 'reg-levage', 'see_also', 'cbardet', '2026-06-04'],
];

export const VCOMMENTS: [string, string][] = [
  ['Mise à jour après revue', 'Updated after review'],
  ['Corrections mineures', 'Minor corrections'],
  ['Intégration des commentaires', 'Comments incorporated'],
  ['Première version', 'First version'],
];
