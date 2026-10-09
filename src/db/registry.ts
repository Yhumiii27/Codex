// Register of document types: merge of the GED deck taxonomy (45 types) and the Keystone register (28 codes).
// Generated from the merge workflow (docs/modele-cible.md §2); edit through Administration › Registre once seeded.

import type { Attachment, Conf, Disposition, Origin, RetentionTrigger } from './schema';

export type RegistryFamily = { key: string; label_fr: string; label_en: string; group: 'DI' | 'DE' | 'DP' | 'DR' };
export type RegistryType = {
  code: string; label_fr: string; label_en: string; family: string; origins: Origin[]; attachments: Attachment[];
  subtypes: { fr: string; en: string }[]; circuit: string[];
  retention: { years: number | null; trigger: RetentionTrigger; disposition: Disposition; basis: string };
  confAllowed: Conf[]; confDefault: Conf; iso?: string; clientDeliverable?: boolean; source: 'deck' | 'keystone' | 'both';
};

export const FAMILIES: RegistryFamily[] = [
 {
  "key": "gouvernance_management",
  "label_fr": "Gouvernance & Management",
  "label_en": "Governance & Management",
  "group": "DI"
 },
 {
  "key": "qualite_qhse",
  "label_fr": "Qualité / QHSE",
  "label_en": "Quality / QHSE",
  "group": "DI"
 },
 {
  "key": "operations",
  "label_fr": "Opérations",
  "label_en": "Operations",
  "group": "DI"
 },
 {
  "key": "fonctions_support",
  "label_fr": "Fonctions support",
  "label_en": "Support functions",
  "group": "DI"
 },
 {
  "key": "reglementaire_normatif",
  "label_fr": "Réglementaire & Normatif",
  "label_en": "Regulatory & Standards",
  "group": "DE"
 },
 {
  "key": "contrats_juridique",
  "label_fr": "Contrats & Juridique",
  "label_en": "Contracts & Legal",
  "group": "DE"
 },
 {
  "key": "fournisseurs_fabricants",
  "label_fr": "Fournisseurs / Fabricants",
  "label_en": "Suppliers / Manufacturers",
  "group": "DE"
 },
 {
  "key": "clients_partenaires",
  "label_fr": "Clients / Partenaires",
  "label_en": "Clients / Partners",
  "group": "DE"
 },
 {
  "key": "evaluations_tierces",
  "label_fr": "Évaluations tierces",
  "label_en": "Third-party assessments",
  "group": "DE"
 },
 {
  "key": "gouvernance_projet",
  "label_fr": "Gouvernance projet",
  "label_en": "Project governance",
  "group": "DP"
 },
 {
  "key": "planification_controle",
  "label_fr": "Planification & Contrôle",
  "label_en": "Planning & Control",
  "group": "DP"
 },
 {
  "key": "ingenierie_conception",
  "label_fr": "Ingénierie & Conception",
  "label_en": "Engineering & Design",
  "group": "DP"
 },
 {
  "key": "achats_contrats",
  "label_fr": "Achats & Contrats",
  "label_en": "Procurement & Contracts",
  "group": "DP"
 },
 {
  "key": "execution_chantier",
  "label_fr": "Exécution & Chantier",
  "label_en": "Execution & Site",
  "group": "DP"
 },
 {
  "key": "handover_cloture",
  "label_fr": "Handover & Clôture",
  "label_en": "Handover & Close-out",
  "group": "DP"
 },
 {
  "key": "gouvernance_recherche",
  "label_fr": "Gouvernance de la recherche",
  "label_en": "Research governance",
  "group": "DR"
 },
 {
  "key": "revue_connaissances",
  "label_fr": "Revue de connaissances",
  "label_en": "Knowledge review",
  "group": "DR"
 },
 {
  "key": "conception_etude",
  "label_fr": "Conception d’étude",
  "label_en": "Study design",
  "group": "DR"
 },
 {
  "key": "donnees_experiences",
  "label_fr": "Données & Expériences",
  "label_en": "Data & Experiments",
  "group": "DR"
 },
 {
  "key": "analyse_modelisation",
  "label_fr": "Analyse & Modélisation",
  "label_en": "Analysis & Modelling",
  "group": "DR"
 },
 {
  "key": "pi_savoir_confidentiel",
  "label_fr": "PI & Savoir confidentiel",
  "label_en": "IP & Confidential know-how",
  "group": "DR"
 },
 {
  "key": "resultats_diffusion",
  "label_fr": "Résultats & Diffusion",
  "label_en": "Results & Dissemination",
  "group": "DR"
 },
 {
  "key": "collaboration_externe",
  "label_fr": "Collaboration externe",
  "label_en": "External collaboration",
  "group": "DR"
 }
];

export const TYPES: RegistryType[] = [
 {
  "code": "POL",
  "label_fr": "Politique",
  "label_en": "Policy",
  "family": "gouvernance_management",
  "origins": [
   "interne"
  ],
  "attachments": [
   "none"
  ],
  "subtypes": [
   {
    "fr": "Politique groupe",
    "en": "Group policy"
   },
   {
    "fr": "Politique départementale",
    "en": "Department policy"
   },
   {
    "fr": "Politique sécurité",
    "en": "Safety policy"
   }
  ],
  "circuit": [
   "resp_departement",
   "resp_qualite",
   "direction"
  ],
  "retention": {
   "years": 10,
   "trigger": "superseded",
   "disposition": "archive",
   "basis": "Usage gouvernance : version remplacée conservée 10 ans puis versement aux archives historiques (ISO 9001 §5.2, §7.5.3)"
  },
  "confAllowed": [
   "public",
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "interne",
  "iso": "5.2 Politique",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "PRO",
  "label_fr": "Procédure",
  "label_en": "Procedure",
  "family": "gouvernance_management",
  "origins": [
   "interne"
  ],
  "attachments": [
   "none",
   "project"
  ],
  "subtypes": [
   {
    "fr": "Procédure standard",
    "en": "Standard procedure"
   },
   {
    "fr": "SOP",
    "en": "SOP"
   },
   {
    "fr": "Instruction de travail",
    "en": "Work instruction"
   }
  ],
  "circuit": [
   "resp_qualite",
   "direction"
  ],
  "retention": {
   "years": 3,
   "trigger": "superseded",
   "disposition": "review",
   "basis": "Valeur Keystone : remplacé + 3 ans (cycle de certification ISO 9001, §7.5.3 durée fixée par l'organisme)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "interne",
  "iso": "7.5 Informations documentées",
  "clientDeliverable": false,
  "source": "both"
 },
 {
  "code": "GOV",
  "label_fr": "Enregistrement de gouvernance",
  "label_en": "Governance record",
  "family": "gouvernance_management",
  "origins": [
   "interne"
  ],
  "attachments": [
   "none"
  ],
  "subtypes": [
   {
    "fr": "PV de comité",
    "en": "Committee minutes"
   },
   {
    "fr": "Journal de décisions",
    "en": "Decision log"
   },
   {
    "fr": "Plan d’actions",
    "en": "Action plan"
   }
  ],
  "circuit": [
   "direction"
  ],
  "retention": {
   "years": null,
   "trigger": "permanent",
   "disposition": "permanent",
   "basis": "Usage : PV d'instances et journaux de décisions conservés à titre permanent (cf. registres C. com. R225-22, R225-106)"
  },
  "confAllowed": [
   "interne",
   "confidentiel",
   "tres_confidentiel"
  ],
  "confDefault": "confidentiel",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "MIN",
  "label_fr": "Compte rendu de réunion",
  "label_en": "Meeting minutes",
  "family": "gouvernance_management",
  "origins": [
   "interne",
   "externe"
  ],
  "attachments": [
   "none",
   "project"
  ],
  "subtypes": [
   {
    "fr": "PV de réunion",
    "en": "Meeting minutes"
   },
   {
    "fr": "Note de réunion",
    "en": "Meeting note"
   }
  ],
  "circuit": [
   "chef_projet"
  ],
  "retention": {
   "years": 5,
   "trigger": "creation",
   "disposition": "destroy",
   "basis": "Valeur Keystone : 5 ans (prescription commerciale, C. com. L110-4)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel",
   "tres_confidentiel"
  ],
  "confDefault": "interne",
  "iso": "8.2.1 Communication avec les clients",
  "clientDeliverable": true,
  "source": "keystone"
 },
 {
  "code": "FRM",
  "label_fr": "Formulaire / modèle",
  "label_en": "Form / template",
  "family": "gouvernance_management",
  "origins": [
   "interne"
  ],
  "attachments": [
   "none"
  ],
  "subtypes": [
   {
    "fr": "Formulaire",
    "en": "Form"
   },
   {
    "fr": "Modèle de document",
    "en": "Document template"
   }
  ],
  "circuit": [
   "resp_qualite"
  ],
  "retention": {
   "years": 3,
   "trigger": "superseded",
   "disposition": "destroy",
   "basis": "Valeur Keystone : remplacé + 3 ans (ISO 9001 §7.5.3) ; les formulaires remplis relèvent de REC"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "interne",
  "iso": "7.5 Informations documentées",
  "clientDeliverable": false,
  "source": "keystone"
 },
 {
  "code": "AUD",
  "label_fr": "Rapport d’audit interne",
  "label_en": "Internal audit report",
  "family": "qualite_qhse",
  "origins": [
   "interne"
  ],
  "attachments": [
   "none",
   "project"
  ],
  "subtypes": [
   {
    "fr": "Rapport d’audit interne",
    "en": "Internal audit report"
   }
  ],
  "circuit": [
   "resp_qualite",
   "direction"
  ],
  "retention": {
   "years": 10,
   "trigger": "creation",
   "disposition": "destroy",
   "basis": "Valeur Keystone : 10 ans (ISO 9001 §9.2.2 et §7.5.3, durée fixée par l'organisme)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "confidentiel",
  "iso": "9.2 Audit interne",
  "clientDeliverable": false,
  "source": "both"
 },
 {
  "code": "NCR",
  "label_fr": "Rapport de non-conformité",
  "label_en": "Non-conformity report",
  "family": "qualite_qhse",
  "origins": [
   "interne"
  ],
  "attachments": [
   "none",
   "project"
  ],
  "subtypes": [
   {
    "fr": "Fiche de non-conformité",
    "en": "Non-conformity form"
   }
  ],
  "circuit": [
   "resp_qualite"
  ],
  "retention": {
   "years": 10,
   "trigger": "creation",
   "disposition": "destroy",
   "basis": "Valeur Keystone : 10 ans (ISO 9001 §10.2.2 ; responsabilité du fait des produits, C. civ. 1245-15)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "interne",
  "iso": "10.2 Non-conformité et action corrective",
  "clientDeliverable": false,
  "source": "both"
 },
 {
  "code": "REC",
  "label_fr": "Enregistrement qualité",
  "label_en": "Quality record",
  "family": "qualite_qhse",
  "origins": [
   "interne"
  ],
  "attachments": [
   "none",
   "project"
  ],
  "subtypes": [
   {
    "fr": "Checklist d’inspection",
    "en": "Inspection checklist"
   },
   {
    "fr": "Enregistrement de contrôle",
    "en": "Inspection record"
   },
   {
    "fr": "Contrôle de réception",
    "en": "Incoming inspection"
   }
  ],
  "circuit": [
   "resp_qualite"
  ],
  "retention": {
   "years": 10,
   "trigger": "creation",
   "disposition": "destroy",
   "basis": "Valeur Keystone : 10 ans (ISO 9001 §7.5.3 ; C. civ. 1245-15 et 1792-4-1)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "interne",
  "iso": "7.5.3 Maîtrise des informations documentées",
  "clientDeliverable": false,
  "source": "both"
 },
 {
  "code": "RSQ",
  "label_fr": "Sécurité & Risques",
  "label_en": "Safety & Risk",
  "family": "qualite_qhse",
  "origins": [
   "interne"
  ],
  "attachments": [
   "none",
   "project"
  ],
  "subtypes": [
   {
    "fr": "Analyse de risques",
    "en": "Risk assessment"
   },
   {
    "fr": "Rapport d’incident",
    "en": "Incident report"
   },
   {
    "fr": "Plan CAPA",
    "en": "CAPA plan"
   }
  ],
  "circuit": [
   "resp_hse",
   "direction"
  ],
  "retention": {
   "years": 40,
   "trigger": "creation",
   "disposition": "destroy",
   "basis": "C. trav. L4121-3-1 et R4121-4 : DUERP et versions successives conservés 40 ans ; usage étendu aux incidents et CAPA"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel",
   "tres_confidentiel"
  ],
  "confDefault": "interne",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "MOP",
  "label_fr": "Maîtrise opérationnelle",
  "label_en": "Operational control",
  "family": "operations",
  "origins": [
   "interne"
  ],
  "attachments": [
   "none"
  ],
  "subtypes": [
   {
    "fr": "Procédure d’exploitation",
    "en": "Operating procedure"
   },
   {
    "fr": "Passation de consignes",
    "en": "Shift handover"
   },
   {
    "fr": "Guide de dépannage",
    "en": "Troubleshooting guide"
   }
  ],
  "circuit": [
   "resp_departement",
   "resp_hse"
  ],
  "retention": {
   "years": 5,
   "trigger": "superseded",
   "disposition": "destroy",
   "basis": "ISO 9001 §8.5.1 et §7.5.3 (durée fixée par l'organisme) ; usage : remplacé + 5 ans (C. com. L110-4)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "interne",
  "iso": "8.1 Planification et maîtrise opérationnelles",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "MNT",
  "label_fr": "Maintenance & Actifs",
  "label_en": "Maintenance & Assets",
  "family": "operations",
  "origins": [
   "interne",
   "externe"
  ],
  "attachments": [
   "none"
  ],
  "subtypes": [
   {
    "fr": "Instruction de maintenance",
    "en": "Maintenance instruction"
   },
   {
    "fr": "Journal de maintenance",
    "en": "Maintenance log"
   },
   {
    "fr": "Certificat d’étalonnage",
    "en": "Calibration certificate"
   },
   {
    "fr": "Registre d’actifs",
    "en": "Asset register"
   }
  ],
  "circuit": [
   "resp_departement"
  ],
  "retention": {
   "years": null,
   "trigger": "asset_life",
   "disposition": "review",
   "basis": "Durée de vie de l'équipement (ISO 9001 §7.1.5 étalonnage) ; vérifications réglementaires 5 ans min. (C. trav. D4711-3)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "interne",
  "iso": "7.1.3 Infrastructure",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "RHF",
  "label_fr": "RH & Formation",
  "label_en": "HR & Training",
  "family": "fonctions_support",
  "origins": [
   "interne"
  ],
  "attachments": [
   "none"
  ],
  "subtypes": [
   {
    "fr": "Fiche de poste",
    "en": "Job description"
   },
   {
    "fr": "Matrice de compétences",
    "en": "Skills matrix"
   },
   {
    "fr": "Support de formation",
    "en": "Training material"
   },
   {
    "fr": "Feuille de présence",
    "en": "Attendance sheet"
   }
  ],
  "circuit": [
   "resp_departement",
   "resp_rh"
  ],
  "retention": {
   "years": 5,
   "trigger": "employee_departure",
   "disposition": "destroy",
   "basis": "C. trav. R1221-26 (registre du personnel : 5 ans après départ) ; prescription 5 ans (C. civ. 2224, C. trav. L1134-5)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel",
   "tres_confidentiel"
  ],
  "confDefault": "confidentiel",
  "iso": "7.2 Compétences",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "FIN",
  "label_fr": "Finance & Administration",
  "label_en": "Finance & Administration",
  "family": "fonctions_support",
  "origins": [
   "interne"
  ],
  "attachments": [
   "none"
  ],
  "subtypes": [
   {
    "fr": "Budget",
    "en": "Budget"
   },
   {
    "fr": "Demande d’achat",
    "en": "Purchase requisition"
   },
   {
    "fr": "Procédure de dépenses",
    "en": "Expense procedure"
   },
   {
    "fr": "Fiche de contrôle d’actifs",
    "en": "Asset control sheet"
   }
  ],
  "circuit": [
   "resp_departement",
   "resp_finance"
  ],
  "retention": {
   "years": 10,
   "trigger": "fiscal_year_end",
   "disposition": "destroy",
   "basis": "C. com. L123-22 (10 ans à compter de la clôture de l'exercice) ; LPF L102 B (6 ans)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel",
   "tres_confidentiel"
  ],
  "confDefault": "confidentiel",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "SSI",
  "label_fr": "IT & Sécurité de l’information",
  "label_en": "IT & Information security",
  "family": "fonctions_support",
  "origins": [
   "interne"
  ],
  "attachments": [
   "none"
  ],
  "subtypes": [
   {
    "fr": "Procédure d’accès",
    "en": "Access procedure"
   },
   {
    "fr": "Procédure de sauvegarde",
    "en": "Backup procedure"
   },
   {
    "fr": "PRA/PCA",
    "en": "DRP/BCP"
   },
   {
    "fr": "Standard système",
    "en": "System standard"
   }
  ],
  "circuit": [
   "resp_si",
   "direction"
  ],
  "retention": {
   "years": 3,
   "trigger": "superseded",
   "disposition": "destroy",
   "basis": "ISO/IEC 27001 §7.5 et ISO 9001 §7.5.3 (durée fixée par l'organisme) ; usage remplacé + 3 ans, aligné sur PRO"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel",
   "tres_confidentiel"
  ],
  "confDefault": "confidentiel",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "REG",
  "label_fr": "Réglementation",
  "label_en": "Regulation",
  "family": "reglementaire_normatif",
  "origins": [
   "externe"
  ],
  "attachments": [
   "none"
  ],
  "subtypes": [
   {
    "fr": "Loi",
    "en": "Law"
   },
   {
    "fr": "Décret",
    "en": "Decree"
   },
   {
    "fr": "Circulaire",
    "en": "Circular"
   },
   {
    "fr": "Guide officiel",
    "en": "Official guide"
   }
  ],
  "circuit": [
   "resp_juridique"
  ],
  "retention": {
   "years": 10,
   "trigger": "superseded",
   "disposition": "destroy",
   "basis": "Usage : preuve de la règlementation applicable lors de la conception, couvre la décennale (C. civ. 1792-4-1)"
  },
  "confAllowed": [
   "public",
   "restreint",
   "interne"
  ],
  "confDefault": "public",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "AUT",
  "label_fr": "Permis / Certification",
  "label_en": "Permit / Certification",
  "family": "reglementaire_normatif",
  "origins": [
   "externe"
  ],
  "attachments": [
   "none",
   "project"
  ],
  "subtypes": [
   {
    "fr": "Permis",
    "en": "Permit"
   },
   {
    "fr": "Licence",
    "en": "Licence"
   },
   {
    "fr": "Certificat",
    "en": "Certificate"
   },
   {
    "fr": "Notification d’approbation",
    "en": "Approval notice"
   }
  ],
  "circuit": [
   "resp_departement"
  ],
  "retention": {
   "years": 10,
   "trigger": "expiry",
   "disposition": "review",
   "basis": "Usage : fin de validité + 10 ans ; ICPE : revue avant destruction (C. env. L152-1, prescription 30 ans)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "interne",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "NRM",
  "label_fr": "Norme / Référentiel",
  "label_en": "Standard / Framework",
  "family": "reglementaire_normatif",
  "origins": [
   "externe"
  ],
  "attachments": [
   "none",
   "project"
  ],
  "subtypes": [
   {
    "fr": "Norme ISO",
    "en": "ISO standard"
   },
   {
    "fr": "Norme métier",
    "en": "Industry standard"
   },
   {
    "fr": "Standard client",
    "en": "Client standard"
   }
  ],
  "circuit": [
   "resp_qualite"
  ],
  "retention": {
   "years": 10,
   "trigger": "superseded",
   "disposition": "destroy",
   "basis": "Usage : preuve de la norme applicable lors de la conception, couvre la décennale (C. civ. 1792-4-1)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "interne",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "CTR",
  "label_fr": "Contrat / avenant",
  "label_en": "Contract / amendment",
  "family": "contrats_juridique",
  "origins": [
   "interne",
   "externe"
  ],
  "attachments": [
   "none",
   "project"
  ],
  "subtypes": [
   {
    "fr": "NDA",
    "en": "NDA"
   },
   {
    "fr": "Contrat-cadre",
    "en": "Framework agreement"
   },
   {
    "fr": "Contrat fournisseur",
    "en": "Supplier contract"
   },
   {
    "fr": "Avenant",
    "en": "Amendment"
   },
   {
    "fr": "Contrat client",
    "en": "Client contract"
   }
  ],
  "circuit": [
   "direction"
  ],
  "retention": {
   "years": 10,
   "trigger": "contract_end",
   "disposition": "review",
   "basis": "Valeur Keystone : fin du contrat + 10 ans (C. com. L110-4 et L123-22 ; C. civ. 1792-4-3)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel",
   "tres_confidentiel"
  ],
  "confDefault": "confidentiel",
  "iso": "8.2 Exigences relatives aux produits et services",
  "clientDeliverable": false,
  "source": "both"
 },
 {
  "code": "JUR",
  "label_fr": "Acte juridique",
  "label_en": "Legal instrument",
  "family": "contrats_juridique",
  "origins": [
   "interne",
   "externe"
  ],
  "attachments": [
   "none",
   "project"
  ],
  "subtypes": [
   {
    "fr": "Conditions générales",
    "en": "General terms and conditions"
   },
   {
    "fr": "Avis juridique",
    "en": "Legal opinion"
   },
   {
    "fr": "Notification de réclamation",
    "en": "Claim notice"
   }
  ],
  "circuit": [
   "resp_juridique",
   "direction"
  ],
  "retention": {
   "years": 10,
   "trigger": "creation",
   "disposition": "review",
   "basis": "Prescription commerciale 5 ans (C. com. L110-4) et décennale (C. civ. 1792-4-3) ; usage 10 ans, revue avant destruction"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel",
   "tres_confidentiel"
  ],
  "confDefault": "confidentiel",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "DTF",
  "label_fr": "Documentation technique",
  "label_en": "Technical documentation",
  "family": "fournisseurs_fabricants",
  "origins": [
   "externe"
  ],
  "attachments": [
   "none",
   "project"
  ],
  "subtypes": [
   {
    "fr": "Datasheet",
    "en": "Datasheet"
   },
   {
    "fr": "Manuel utilisateur",
    "en": "User manual"
   },
   {
    "fr": "Guide d’installation",
    "en": "Installation guide"
   },
   {
    "fr": "Manuel de maintenance",
    "en": "Maintenance manual"
   },
   {
    "fr": "Fiche de données de sécurité",
    "en": "Safety data sheet"
   }
  ],
  "circuit": [
   "resp_departement"
  ],
  "retention": {
   "years": null,
   "trigger": "asset_life",
   "disposition": "review",
   "basis": "Durée de vie de l'équipement (exploitation, maintenance) ; fiches de données de sécurité : REACH art. 36 (10 ans)"
  },
  "confAllowed": [
   "public",
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "restreint",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "DQF",
  "label_fr": "Documentation qualité",
  "label_en": "Quality documentation",
  "family": "fournisseurs_fabricants",
  "origins": [
   "externe"
  ],
  "attachments": [
   "none",
   "project"
  ],
  "subtypes": [
   {
    "fr": "Certificat d’essai",
    "en": "Test certificate"
   },
   {
    "fr": "Rapport d’inspection",
    "en": "Inspection report"
   }
  ],
  "circuit": [
   "resp_qualite"
  ],
  "retention": {
   "years": 10,
   "trigger": "project_end",
   "disposition": "review",
   "basis": "Traçabilité produit : 10 ans après réception (C. civ. 1245-15 et 1792-4-1) ; aligné sur CER et COC"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "restreint",
  "iso": "8.4 Maîtrise des prestataires externes",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "CER",
  "label_fr": "Certificat matière",
  "label_en": "Material certificate",
  "family": "fournisseurs_fabricants",
  "origins": [
   "externe"
  ],
  "attachments": [
   "none",
   "project"
  ],
  "subtypes": [],
  "circuit": [
   "resp_qualite"
  ],
  "retention": {
   "years": 10,
   "trigger": "project_end",
   "disposition": "review",
   "basis": "Valeur Keystone : 10 ans, comptés depuis la réception (Dir. 2014/68/UE ; C. civ. 1245-15)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "interne",
  "iso": "8.4.3 Informations à l’attention des prestataires externes",
  "clientDeliverable": false,
  "source": "keystone"
 },
 {
  "code": "COC",
  "label_fr": "Certificat de conformité",
  "label_en": "Certificate of conformity",
  "family": "fournisseurs_fabricants",
  "origins": [
   "externe"
  ],
  "attachments": [
   "none",
   "project"
  ],
  "subtypes": [
   {
    "fr": "Certificat de conformité",
    "en": "Certificate of conformity"
   },
   {
    "fr": "Déclaration CE de conformité",
    "en": "EC declaration of conformity"
   }
  ],
  "circuit": [
   "resp_qualite"
  ],
  "retention": {
   "years": 10,
   "trigger": "project_end",
   "disposition": "review",
   "basis": "Valeur Keystone : 10 ans après mise sur le marché ou réception (Dir. 2006/42/CE ann. VII, Dir. 2014/68/UE)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "restreint",
  "iso": "8.6 Libération des produits et services",
  "clientDeliverable": true,
  "source": "keystone"
 },
 {
  "code": "LET",
  "label_fr": "Courrier / correspondance",
  "label_en": "Correspondence",
  "family": "clients_partenaires",
  "origins": [
   "interne",
   "externe"
  ],
  "attachments": [
   "none",
   "project"
  ],
  "subtypes": [
   {
    "fr": "Courrier officiel",
    "en": "Official letter"
   },
   {
    "fr": "Bordereau de transmission",
    "en": "Transmittal"
   },
   {
    "fr": "Email formalisé",
    "en": "Formal email"
   }
  ],
  "circuit": [],
  "retention": {
   "years": 5,
   "trigger": "creation",
   "disposition": "destroy",
   "basis": "Valeur Keystone : 5 ans (prescription commerciale, C. com. L110-4)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel",
   "tres_confidentiel"
  ],
  "confDefault": "interne",
  "iso": "8.2.1 Communication avec les clients",
  "clientDeliverable": false,
  "source": "both"
 },
 {
  "code": "COM",
  "label_fr": "Échange commercial",
  "label_en": "Commercial exchange",
  "family": "clients_partenaires",
  "origins": [
   "interne",
   "externe"
  ],
  "attachments": [
   "none",
   "project"
  ],
  "subtypes": [
   {
    "fr": "RFQ",
    "en": "RFQ"
   },
   {
    "fr": "Offre",
    "en": "Offer"
   },
   {
    "fr": "Bon de commande",
    "en": "Purchase order"
   },
   {
    "fr": "Facture",
    "en": "Invoice"
   },
   {
    "fr": "Bon de livraison",
    "en": "Delivery note"
   }
  ],
  "circuit": [
   "resp_departement"
  ],
  "retention": {
   "years": 10,
   "trigger": "fiscal_year_end",
   "disposition": "destroy",
   "basis": "C. com. L123-22 (pièces justificatives : 10 ans après clôture) ; LPF L102 B (6 ans)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel",
   "tres_confidentiel"
  ],
  "confDefault": "confidentiel",
  "iso": "8.2 Exigences relatives aux produits et services",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "EVA",
  "label_fr": "Rapport externe",
  "label_en": "External report",
  "family": "evaluations_tierces",
  "origins": [
   "externe"
  ],
  "attachments": [
   "none",
   "project"
  ],
  "subtypes": [
   {
    "fr": "Rapport d’audit",
    "en": "Audit report"
   },
   {
    "fr": "Rapport laboratoire",
    "en": "Laboratory report"
   },
   {
    "fr": "Expertise",
    "en": "Expert report"
   },
   {
    "fr": "Rapport d’enquête",
    "en": "Investigation report"
   }
  ],
  "circuit": [
   "resp_departement",
   "resp_qualite"
  ],
  "retention": {
   "years": 10,
   "trigger": "creation",
   "disposition": "review",
   "basis": "Usage aligné sur AUD et REC : 10 ans (ISO 9001 §7.5.3) ; revue avant destruction (litiges, expertises)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel",
   "tres_confidentiel"
  ],
  "confDefault": "confidentiel",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "DEF",
  "label_fr": "Définition du projet",
  "label_en": "Project definition",
  "family": "gouvernance_projet",
  "origins": [
   "interne"
  ],
  "attachments": [
   "project"
  ],
  "subtypes": [
   {
    "fr": "Charte projet",
    "en": "Project charter"
   },
   {
    "fr": "Business case",
    "en": "Business case"
   },
   {
    "fr": "PID (document d’initialisation de projet)",
    "en": "PID (project initiation document)"
   },
   {
    "fr": "Plan d’exécution",
    "en": "Execution plan"
   }
  ],
  "circuit": [
   "direction"
  ],
  "retention": {
   "years": 10,
   "trigger": "project_end",
   "disposition": "review",
   "basis": "Dossier projet : 10 ans après réception ou clôture (C. civ. 1792-4-3 ; C. com. L110-4)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel",
   "tres_confidentiel"
  ],
  "confDefault": "confidentiel",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "PIL",
  "label_fr": "Pilotage & Décisions",
  "label_en": "Steering & Decisions",
  "family": "gouvernance_projet",
  "origins": [
   "interne"
  ],
  "attachments": [
   "project"
  ],
  "subtypes": [
   {
    "fr": "Dossier comité de pilotage",
    "en": "Steering committee pack"
   },
   {
    "fr": "Journal de décisions",
    "en": "Decision log"
   },
   {
    "fr": "RAID log",
    "en": "RAID log"
   }
  ],
  "circuit": [
   "chef_projet"
  ],
  "retention": {
   "years": 10,
   "trigger": "project_end",
   "disposition": "review",
   "basis": "Dossier projet : 10 ans après réception ou clôture (C. civ. 1792-4-3 ; C. com. L110-4)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "confidentiel",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "PLN",
  "label_fr": "Planning & Coûts",
  "label_en": "Schedule & Costs",
  "family": "planification_controle",
  "origins": [
   "interne"
  ],
  "attachments": [
   "project"
  ],
  "subtypes": [
   {
    "fr": "Planning de référence",
    "en": "Baseline schedule"
   },
   {
    "fr": "Plan jalons",
    "en": "Milestone plan"
   },
   {
    "fr": "Budget initial",
    "en": "Initial budget"
   },
   {
    "fr": "Rapport de coûts",
    "en": "Cost report"
   }
  ],
  "circuit": [
   "chef_projet",
   "resp_finance"
  ],
  "retention": {
   "years": 10,
   "trigger": "project_end",
   "disposition": "review",
   "basis": "Dossier projet : 10 ans après clôture (réclamations, C. civ. 1792-4-3 ; coûts, C. com. L123-22)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel",
   "tres_confidentiel"
  ],
  "confDefault": "confidentiel",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "AVT",
  "label_fr": "Reporting d’avancement",
  "label_en": "Progress reporting",
  "family": "planification_controle",
  "origins": [
   "interne"
  ],
  "attachments": [
   "project"
  ],
  "subtypes": [
   {
    "fr": "Rapport hebdomadaire",
    "en": "Weekly report"
   },
   {
    "fr": "Rapport mensuel",
    "en": "Monthly report"
   },
   {
    "fr": "Tableau de bord KPI",
    "en": "KPI dashboard"
   }
  ],
  "circuit": [
   "chef_projet"
  ],
  "retention": {
   "years": 5,
   "trigger": "project_end",
   "disposition": "destroy",
   "basis": "Usage : prescription 5 ans après clôture (C. com. L110-4) ; la synthèse est reprise dans CLO"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "interne",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "EXG",
  "label_fr": "Exigences",
  "label_en": "Requirements",
  "family": "ingenierie_conception",
  "origins": [
   "interne",
   "externe"
  ],
  "attachments": [
   "project"
  ],
  "subtypes": [
   {
    "fr": "Besoin métier",
    "en": "Business requirement"
   },
   {
    "fr": "Spécification technique",
    "en": "Technical specification"
   }
  ],
  "circuit": [
   "referent_ingenierie",
   "chef_projet",
   "validation_client"
  ],
  "retention": {
   "years": null,
   "trigger": "asset_life",
   "disposition": "review",
   "basis": "Données d'entrée de conception : durée de vie de l'ouvrage (ISO 9001 §8.3.3) ; a minima décennale (C. civ. 1792-4-1)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "restreint",
  "iso": "8.3 Conception et développement",
  "clientDeliverable": true,
  "source": "deck"
 },
 {
  "code": "FDS",
  "label_fr": "Spécification fonctionnelle",
  "label_en": "Functional specification",
  "family": "ingenierie_conception",
  "origins": [
   "interne"
  ],
  "attachments": [
   "project"
  ],
  "subtypes": [
   {
    "fr": "Spécification fonctionnelle",
    "en": "Functional specification"
   }
  ],
  "circuit": [
   "referent_ingenierie",
   "validation_client"
  ],
  "retention": {
   "years": null,
   "trigger": "asset_life",
   "disposition": "review",
   "basis": "Valeur Keystone : durée de vie de l'installation (ISO 9001 §8.3) ; a minima 10 ans après réception (C. civ. 1792-4-1)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "restreint",
  "iso": "8.3 Conception et développement",
  "clientDeliverable": true,
  "source": "keystone"
 },
 {
  "code": "HMI",
  "label_fr": "Spécification IHM",
  "label_en": "HMI specification",
  "family": "ingenierie_conception",
  "origins": [
   "interne"
  ],
  "attachments": [
   "project"
  ],
  "subtypes": [],
  "circuit": [
   "referent_ingenierie",
   "validation_client"
  ],
  "retention": {
   "years": null,
   "trigger": "asset_life",
   "disposition": "review",
   "basis": "Valeur Keystone : durée de vie de l'installation (ISO 9001 §8.3) ; a minima 10 ans après réception (C. civ. 1792-4-1)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "restreint",
  "iso": "8.3 Conception et développement",
  "clientDeliverable": true,
  "source": "keystone"
 },
 {
  "code": "VAR",
  "label_fr": "Table de variables automate",
  "label_en": "PLC variable table",
  "family": "ingenierie_conception",
  "origins": [
   "interne"
  ],
  "attachments": [
   "project"
  ],
  "subtypes": [],
  "circuit": [
   "referent_ingenierie"
  ],
  "retention": {
   "years": null,
   "trigger": "asset_life",
   "disposition": "review",
   "basis": "Valeur Keystone : durée de vie de l'installation (ISO 9001 §8.3) ; a minima 10 ans après réception (C. civ. 1792-4-1)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "interne",
  "iso": "8.3 Conception et développement",
  "clientDeliverable": false,
  "source": "keystone"
 },
 {
  "code": "LDC",
  "label_fr": "Livrables de conception",
  "label_en": "Design deliverables",
  "family": "ingenierie_conception",
  "origins": [
   "interne",
   "externe"
  ],
  "attachments": [
   "project"
  ],
  "subtypes": [
   {
    "fr": "Plans",
    "en": "Drawings"
   },
   {
    "fr": "Note de calcul",
    "en": "Calculation note"
   },
   {
    "fr": "Rapport de revue de conception",
    "en": "Design review report"
   }
  ],
  "circuit": [
   "referent_ingenierie",
   "chef_projet"
  ],
  "retention": {
   "years": null,
   "trigger": "asset_life",
   "disposition": "review",
   "basis": "Durée de vie de l'ouvrage (ISO 9001 §8.3.5) ; a minima décennale (C. civ. 1792-4-1)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "restreint",
  "iso": "8.3 Conception et développement",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "PID",
  "label_fr": "P&ID (schéma de tuyauterie et d’instrumentation)",
  "label_en": "P&ID (piping and instrumentation diagram)",
  "family": "ingenierie_conception",
  "origins": [
   "interne",
   "externe"
  ],
  "attachments": [
   "project"
  ],
  "subtypes": [],
  "circuit": [
   "referent_ingenierie",
   "chef_projet"
  ],
  "retention": {
   "years": null,
   "trigger": "asset_life",
   "disposition": "review",
   "basis": "Valeur Keystone : durée de vie de l'installation (ISO 9001 §8.3) ; a minima 10 ans après réception (C. civ. 1792-4-1)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "restreint",
  "iso": "8.3 Conception et développement",
  "clientDeliverable": true,
  "source": "keystone"
 },
 {
  "code": "PFD",
  "label_fr": "Schéma de procédé (PFD)",
  "label_en": "Process flow diagram (PFD)",
  "family": "ingenierie_conception",
  "origins": [
   "interne",
   "externe"
  ],
  "attachments": [
   "project"
  ],
  "subtypes": [],
  "circuit": [
   "referent_ingenierie",
   "chef_projet"
  ],
  "retention": {
   "years": null,
   "trigger": "asset_life",
   "disposition": "review",
   "basis": "Valeur Keystone : durée de vie de l'installation (ISO 9001 §8.3) ; a minima 10 ans après réception (C. civ. 1792-4-1)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel",
   "tres_confidentiel"
  ],
  "confDefault": "interne",
  "iso": "8.3 Conception et développement",
  "clientDeliverable": false,
  "source": "keystone"
 },
 {
  "code": "SCH",
  "label_fr": "Schémas électriques",
  "label_en": "Electrical schematics",
  "family": "ingenierie_conception",
  "origins": [
   "interne",
   "externe"
  ],
  "attachments": [
   "project"
  ],
  "subtypes": [],
  "circuit": [
   "referent_ingenierie",
   "chef_projet"
  ],
  "retention": {
   "years": null,
   "trigger": "asset_life",
   "disposition": "review",
   "basis": "Valeur Keystone : durée de vie de l'installation (ISO 9001 §8.3) ; a minima 10 ans après réception (C. civ. 1792-4-1)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "restreint",
  "iso": "8.3 Conception et développement",
  "clientDeliverable": true,
  "source": "keystone"
 },
 {
  "code": "GA",
  "label_fr": "Plan d’ensemble",
  "label_en": "General arrangement",
  "family": "ingenierie_conception",
  "origins": [
   "interne",
   "externe"
  ],
  "attachments": [
   "project"
  ],
  "subtypes": [],
  "circuit": [
   "referent_ingenierie",
   "chef_projet"
  ],
  "retention": {
   "years": null,
   "trigger": "asset_life",
   "disposition": "review",
   "basis": "Valeur Keystone : durée de vie de l'installation (ISO 9001 §8.3) ; a minima 10 ans après réception (C. civ. 1792-4-1)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "restreint",
  "iso": "8.3 Conception et développement",
  "clientDeliverable": true,
  "source": "keystone"
 },
 {
  "code": "LST",
  "label_fr": "Liste technique",
  "label_en": "Technical list",
  "family": "ingenierie_conception",
  "origins": [
   "interne",
   "externe"
  ],
  "attachments": [
   "project"
  ],
  "subtypes": [
   {
    "fr": "Liste d’instruments",
    "en": "Instrument list"
   },
   {
    "fr": "Liste de moteurs",
    "en": "Motor list"
   },
   {
    "fr": "Liste d’entrées/sorties",
    "en": "I/O list"
   },
   {
    "fr": "Liste de câbles",
    "en": "Cable list"
   },
   {
    "fr": "Liste de pièces de rechange",
    "en": "Spare parts list"
   }
  ],
  "circuit": [
   "referent_ingenierie"
  ],
  "retention": {
   "years": null,
   "trigger": "asset_life",
   "disposition": "review",
   "basis": "Valeur Keystone : durée de vie de l'installation (ISO 9001 §8.3) ; a minima 10 ans après réception (C. civ. 1792-4-1)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "interne",
  "iso": "8.3 Conception et développement",
  "clientDeliverable": false,
  "source": "keystone"
 },
 {
  "code": "BOM",
  "label_fr": "Nomenclature",
  "label_en": "Bill of materials",
  "family": "ingenierie_conception",
  "origins": [
   "interne",
   "externe"
  ],
  "attachments": [
   "project"
  ],
  "subtypes": [
   {
    "fr": "Nomenclature mécanique",
    "en": "Mechanical BOM"
   },
   {
    "fr": "Nomenclature électrique",
    "en": "Electrical BOM"
   }
  ],
  "circuit": [
   "referent_ingenierie"
  ],
  "retention": {
   "years": null,
   "trigger": "asset_life",
   "disposition": "review",
   "basis": "Valeur Keystone : durée de vie de l'installation (ISO 9001 §8.3) ; a minima 10 ans après réception (C. civ. 1792-4-1)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "interne",
  "iso": "8.3 Conception et développement",
  "clientDeliverable": false,
  "source": "keystone"
 },
 {
  "code": "CSL",
  "label_fr": "Consultation",
  "label_en": "Tendering",
  "family": "achats_contrats",
  "origins": [
   "interne"
  ],
  "attachments": [
   "project"
  ],
  "subtypes": [
   {
    "fr": "RFP",
    "en": "RFP"
   },
   {
    "fr": "Évaluation d’offres",
    "en": "Bid evaluation"
   },
   {
    "fr": "Recommandation fournisseur",
    "en": "Supplier recommendation"
   }
  ],
  "circuit": [
   "resp_achats",
   "chef_projet"
  ],
  "retention": {
   "years": 5,
   "trigger": "project_end",
   "disposition": "destroy",
   "basis": "Prescription commerciale 5 ans (C. com. L110-4) ; ISO 9001 §8.4.1 (évaluation et sélection des prestataires)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel",
   "tres_confidentiel"
  ],
  "confDefault": "confidentiel",
  "iso": "8.4 Maîtrise des prestataires externes",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "RFQ",
  "label_fr": "Demande de prix / devis fournisseur",
  "label_en": "Request for quotation / supplier quotation",
  "family": "achats_contrats",
  "origins": [
   "interne",
   "externe"
  ],
  "attachments": [
   "none",
   "project"
  ],
  "subtypes": [
   {
    "fr": "Demande de prix (RFQ)",
    "en": "Request for quotation"
   },
   {
    "fr": "Devis fournisseur",
    "en": "Supplier quotation"
   }
  ],
  "circuit": [],
  "retention": {
   "years": 3,
   "trigger": "creation",
   "disposition": "destroy",
   "basis": "Valeur Keystone : 3 ans ; le devis retenu est conservé avec la commande (PO)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "confidentiel",
  "iso": "8.4 Maîtrise des prestataires externes",
  "clientDeliverable": false,
  "source": "keystone"
 },
 {
  "code": "PO",
  "label_fr": "Commande d’achat",
  "label_en": "Purchase order",
  "family": "achats_contrats",
  "origins": [
   "interne"
  ],
  "attachments": [
   "none",
   "project"
  ],
  "subtypes": [],
  "circuit": [
   "chef_projet"
  ],
  "retention": {
   "years": 10,
   "trigger": "fiscal_year_end",
   "disposition": "destroy",
   "basis": "Valeur Keystone : 10 ans (C. com. L123-22, à compter de la clôture de l'exercice)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "confidentiel",
  "iso": "8.4 Maîtrise des prestataires externes",
  "clientDeliverable": false,
  "source": "keystone"
 },
 {
  "code": "ADC",
  "label_fr": "Administration contractuelle",
  "label_en": "Contract administration",
  "family": "achats_contrats",
  "origins": [
   "interne"
  ],
  "attachments": [
   "project"
  ],
  "subtypes": [
   {
    "fr": "Demande d’achat",
    "en": "Purchase requisition"
   },
   {
    "fr": "Ordre de changement",
    "en": "Change order"
   },
   {
    "fr": "Dossier fournisseur",
    "en": "Supplier file"
   }
  ],
  "circuit": [
   "chef_projet",
   "resp_achats"
  ],
  "retention": {
   "years": 10,
   "trigger": "contract_end",
   "disposition": "review",
   "basis": "Avenants et ordres de changement suivent le contrat : fin + 10 ans (aligné sur CTR ; C. com. L110-4, L123-22)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "confidentiel",
  "iso": "8.4 Maîtrise des prestataires externes",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "EXE",
  "label_fr": "Exécution terrain",
  "label_en": "Field execution",
  "family": "execution_chantier",
  "origins": [
   "interne"
  ],
  "attachments": [
   "project"
  ],
  "subtypes": [
   {
    "fr": "Méthode",
    "en": "Method statement"
   },
   {
    "fr": "Dossier de travaux",
    "en": "Work package"
   },
   {
    "fr": "Instruction chantier",
    "en": "Site instruction"
   },
   {
    "fr": "Fiche d’installation",
    "en": "Installation sheet"
   }
  ],
  "circuit": [
   "resp_chantier",
   "resp_hse"
  ],
  "retention": {
   "years": 10,
   "trigger": "project_end",
   "disposition": "review",
   "basis": "Garantie décennale : 10 ans après réception (C. civ. 1792 et 1792-4-1)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "restreint",
  "iso": "8.5.1 Maîtrise de la production et de la prestation de service",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "MES",
  "label_fr": "Essais & Mise en service",
  "label_en": "Testing & Commissioning",
  "family": "execution_chantier",
  "origins": [
   "interne"
  ],
  "attachments": [
   "project"
  ],
  "subtypes": [
   {
    "fr": "Plan de test",
    "en": "Test plan"
   },
   {
    "fr": "ITP",
    "en": "ITP"
   },
   {
    "fr": "Procédure de commissioning",
    "en": "Commissioning procedure"
   }
  ],
  "circuit": [
   "referent_ingenierie",
   "resp_qualite",
   "validation_client"
  ],
  "retention": {
   "years": 10,
   "trigger": "project_end",
   "disposition": "review",
   "basis": "Garantie décennale : 10 ans après réception (C. civ. 1792-4-1) ; ISO 9001 §8.6 ; aligné sur RPT"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "restreint",
  "iso": "8.6 Libération des produits et services",
  "clientDeliverable": true,
  "source": "deck"
 },
 {
  "code": "RPT",
  "label_fr": "Rapport d’essai et de contrôle",
  "label_en": "Test & inspection report",
  "family": "execution_chantier",
  "origins": [
   "interne"
  ],
  "attachments": [
   "project"
  ],
  "subtypes": [
   {
    "fr": "Enregistrement d’essai",
    "en": "Test record"
   },
   {
    "fr": "Rapport FAT",
    "en": "FAT report"
   },
   {
    "fr": "Rapport SAT",
    "en": "SAT report"
   }
  ],
  "circuit": [
   "resp_qualite",
   "chef_projet"
  ],
  "retention": {
   "years": 10,
   "trigger": "project_end",
   "disposition": "review",
   "basis": "Valeur Keystone : 10 ans, comptés depuis la réception (C. civ. 1792-4-1 ; ISO 9001 §8.6)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "restreint",
  "iso": "8.6 Libération des produits et services",
  "clientDeliverable": true,
  "source": "keystone"
 },
 {
  "code": "PER",
  "label_fr": "Permis de travail",
  "label_en": "Work permit",
  "family": "execution_chantier",
  "origins": [
   "interne"
  ],
  "attachments": [
   "project"
  ],
  "subtypes": [
   {
    "fr": "Permis de levage",
    "en": "Lifting permit"
   },
   {
    "fr": "Permis de travail électrique",
    "en": "Electrical work permit"
   }
  ],
  "circuit": [
   "resp_hse"
  ],
  "retention": {
   "years": 5,
   "trigger": "project_end",
   "disposition": "destroy",
   "basis": "Valeur Keystone : projet + 5 ans (prescription de droit commun, C. civ. 2224)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "restreint",
  "iso": "8.5.1 Maîtrise de la production et de la prestation de service",
  "clientDeliverable": false,
  "source": "keystone"
 },
 {
  "code": "HSE",
  "label_fr": "Plan HSE",
  "label_en": "HSE plan",
  "family": "execution_chantier",
  "origins": [
   "interne"
  ],
  "attachments": [
   "none",
   "project"
  ],
  "subtypes": [
   {
    "fr": "Plan de prévention",
    "en": "Prevention plan"
   }
  ],
  "circuit": [
   "chef_projet",
   "validation_client"
  ],
  "retention": {
   "years": 5,
   "trigger": "project_end",
   "disposition": "destroy",
   "basis": "Valeur Keystone : projet + 5 ans (plan de prévention C. trav. R4512-6 s. ; prescription C. civ. 2224)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "restreint",
  "iso": "8.5.1 Maîtrise de la production et de la prestation de service",
  "clientDeliverable": true,
  "source": "keystone"
 },
 {
  "code": "PHO",
  "label_fr": "Photos de chantier",
  "label_en": "Site photos",
  "family": "execution_chantier",
  "origins": [
   "interne"
  ],
  "attachments": [
   "project"
  ],
  "subtypes": [],
  "circuit": [],
  "retention": {
   "years": 5,
   "trigger": "project_end",
   "disposition": "destroy",
   "basis": "Valeur Keystone : projet + 5 ans (preuve d'exécution ; prescription C. civ. 2224)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "interne",
  "iso": "8.5.1 Maîtrise de la production et de la prestation de service",
  "clientDeliverable": false,
  "source": "keystone"
 },
 {
  "code": "VIS",
  "label_fr": "Rapport de visite",
  "label_en": "Visit report",
  "family": "execution_chantier",
  "origins": [
   "interne"
  ],
  "attachments": [
   "none",
   "project"
  ],
  "subtypes": [
   {
    "fr": "Visite de chantier",
    "en": "Site visit"
   },
   {
    "fr": "Visite d’usine fournisseur",
    "en": "Supplier factory visit"
   }
  ],
  "circuit": [
   "chef_projet"
  ],
  "retention": {
   "years": 5,
   "trigger": "creation",
   "disposition": "destroy",
   "basis": "Valeur Keystone : 5 ans (prescription commerciale, C. com. L110-4)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "interne",
  "iso": "8.5.1 Maîtrise de la production et de la prestation de service",
  "clientDeliverable": false,
  "source": "keystone"
 },
 {
  "code": "REM",
  "label_fr": "Remise / Handover",
  "label_en": "Handover",
  "family": "handover_cloture",
  "origins": [
   "interne"
  ],
  "attachments": [
   "project"
  ],
  "subtypes": [
   {
    "fr": "Punch list",
    "en": "Punch list"
   },
   {
    "fr": "Dossier de transfert",
    "en": "Transfer file"
   }
  ],
  "circuit": [
   "chef_projet",
   "validation_client"
  ],
  "retention": {
   "years": 10,
   "trigger": "project_end",
   "disposition": "review",
   "basis": "Réserves et dossier de transfert : 10 ans après réception (C. civ. 1792-4-1 ; parfait achèvement C. civ. 1792-6)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "restreint",
  "clientDeliverable": true,
  "source": "deck"
 },
 {
  "code": "PV",
  "label_fr": "Procès-verbal de réception (PV)",
  "label_en": "Acceptance minutes (PV)",
  "family": "handover_cloture",
  "origins": [
   "interne"
  ],
  "attachments": [
   "project"
  ],
  "subtypes": [
   {
    "fr": "Certificat de réception",
    "en": "Acceptance certificate"
   }
  ],
  "circuit": [
   "chef_projet",
   "validation_client"
  ],
  "retention": {
   "years": 10,
   "trigger": "creation",
   "disposition": "review",
   "basis": "Valeur Keystone : 10 ans à compter du PV de réception, point de départ de la décennale (C. civ. 1792-4-1)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "restreint",
  "iso": "8.6 Libération des produits et services",
  "clientDeliverable": true,
  "source": "keystone"
 },
 {
  "code": "MAN",
  "label_fr": "Manuel / dossier as-built",
  "label_en": "Manual / as-built",
  "family": "handover_cloture",
  "origins": [
   "interne"
  ],
  "attachments": [
   "project"
  ],
  "subtypes": [
   {
    "fr": "Dossier as-built",
    "en": "As-built file"
   },
   {
    "fr": "Manuel d’exploitation et de maintenance",
    "en": "O&M manual"
   }
  ],
  "circuit": [
   "referent_ingenierie",
   "chef_projet"
  ],
  "retention": {
   "years": null,
   "trigger": "asset_life",
   "disposition": "review",
   "basis": "Valeur Keystone : durée de vie de l'ouvrage (DOE, DIUO) ; a minima 10 ans après réception (C. civ. 1792-4-1)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "restreint",
  "iso": "8.5.1 Maîtrise de la production et de la prestation de service",
  "clientDeliverable": true,
  "source": "keystone"
 },
 {
  "code": "CLO",
  "label_fr": "Clôture",
  "label_en": "Close-out",
  "family": "handover_cloture",
  "origins": [
   "interne"
  ],
  "attachments": [
   "project"
  ],
  "subtypes": [
   {
    "fr": "Retour d’expérience",
    "en": "Lessons learned"
   },
   {
    "fr": "Rapport de clôture",
    "en": "Close-out report"
   },
   {
    "fr": "Index d’archivage",
    "en": "Archive index"
   }
  ],
  "circuit": [
   "chef_projet",
   "direction"
  ],
  "retention": {
   "years": 10,
   "trigger": "project_end",
   "disposition": "archive",
   "basis": "Usage : mémoire du projet (REX, index d'archivage), versement aux archives historiques après 10 ans"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "interne",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "PRP",
  "label_fr": "Proposition & Autorisation",
  "label_en": "Proposal & Authorisation",
  "family": "gouvernance_recherche",
  "origins": [
   "interne"
  ],
  "attachments": [
   "research"
  ],
  "subtypes": [
   {
    "fr": "Proposition de recherche",
    "en": "Research proposal"
   },
   {
    "fr": "Dossier éthique",
    "en": "Ethics file"
   },
   {
    "fr": "Demande de financement",
    "en": "Funding application"
   }
  ],
  "circuit": [
   "resp_recherche",
   "direction"
  ],
  "retention": {
   "years": 10,
   "trigger": "project_end",
   "disposition": "review",
   "basis": "Conventions de financement (ex. Horizon Europe : 5 ans après solde) ; justificatifs CIR (LPF L102 B) ; usage 10 ans"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel",
   "tres_confidentiel"
  ],
  "confDefault": "confidentiel",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "PGM",
  "label_fr": "Pilotage du programme",
  "label_en": "Programme steering",
  "family": "gouvernance_recherche",
  "origins": [
   "interne"
  ],
  "attachments": [
   "research"
  ],
  "subtypes": [
   {
    "fr": "Plan de recherche",
    "en": "Research plan"
   },
   {
    "fr": "Revue de jalons",
    "en": "Milestone review"
   },
   {
    "fr": "Compte rendu de réunion scientifique",
    "en": "Scientific meeting minutes"
   }
  ],
  "circuit": [
   "resp_programme",
   "resp_recherche"
  ],
  "retention": {
   "years": 10,
   "trigger": "project_end",
   "disposition": "archive",
   "basis": "Usage recherche : 10 ans après fin du programme puis versement aux archives historiques"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "confidentiel",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "BIB",
  "label_fr": "Revue bibliographique",
  "label_en": "Literature review",
  "family": "revue_connaissances",
  "origins": [
   "interne"
  ],
  "attachments": [
   "research"
  ],
  "subtypes": [
   {
    "fr": "Bibliographie",
    "en": "Bibliography"
   },
   {
    "fr": "Revue annotée",
    "en": "Annotated review"
   },
   {
    "fr": "État de l’art",
    "en": "State of the art"
   }
  ],
  "circuit": [
   "resp_programme"
  ],
  "retention": {
   "years": 6,
   "trigger": "project_end",
   "disposition": "destroy",
   "basis": "Justificatifs CIR (état de l'art) : LPF L102 B (6 ans)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "interne",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "ANT",
  "label_fr": "Antériorité & Benchmark",
  "label_en": "Prior art & Benchmark",
  "family": "revue_connaissances",
  "origins": [
   "interne"
  ],
  "attachments": [
   "research"
  ],
  "subtypes": [
   {
    "fr": "Revue brevets",
    "en": "Patent review"
   },
   {
    "fr": "Étude comparative",
    "en": "Comparative study"
   },
   {
    "fr": "Veille technologique",
    "en": "Technology watch"
   }
  ],
  "circuit": [
   "resp_programme"
  ],
  "retention": {
   "years": 10,
   "trigger": "project_end",
   "disposition": "review",
   "basis": "Usage : appui aux dépôts PI et à la liberté d'exploitation ; justificatifs CIR (LPF L102 B) ; 10 ans"
  },
  "confAllowed": [
   "interne",
   "confidentiel",
   "tres_confidentiel"
  ],
  "confDefault": "confidentiel",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "PRT",
  "label_fr": "Protocoles",
  "label_en": "Protocols",
  "family": "conception_etude",
  "origins": [
   "interne"
  ],
  "attachments": [
   "research"
  ],
  "subtypes": [
   {
    "fr": "Protocole expérimental",
    "en": "Experimental protocol"
   },
   {
    "fr": "Matrice d’essais",
    "en": "Test matrix"
   },
   {
    "fr": "Plan d’échantillonnage",
    "en": "Sampling plan"
   }
  ],
  "circuit": [
   "resp_programme"
  ],
  "retention": {
   "years": 15,
   "trigger": "project_end",
   "disposition": "review",
   "basis": "Usage intégrité scientifique : 10 à 15 ans ; nécessaires à l'interprétation des données brutes (aligné sur DBR)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel",
   "tres_confidentiel"
  ],
  "confDefault": "confidentiel",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "PGD",
  "label_fr": "Planification des données",
  "label_en": "Data planning",
  "family": "conception_etude",
  "origins": [
   "interne"
  ],
  "attachments": [
   "research"
  ],
  "subtypes": [
   {
    "fr": "Plan de gestion des données",
    "en": "Data management plan"
   },
   {
    "fr": "Dictionnaire de données",
    "en": "Data dictionary"
   },
   {
    "fr": "Schéma de codification",
    "en": "Coding scheme"
   }
  ],
  "circuit": [
   "resp_programme",
   "resp_si"
  ],
  "retention": {
   "years": 15,
   "trigger": "project_end",
   "disposition": "review",
   "basis": "Usage intégrité scientifique : 10 à 15 ans ; nécessaires à l'interprétation des données brutes (aligné sur DBR)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "interne",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "DBR",
  "label_fr": "Preuves brutes",
  "label_en": "Raw evidence",
  "family": "donnees_experiences",
  "origins": [
   "interne"
  ],
  "attachments": [
   "research"
  ],
  "subtypes": [
   {
    "fr": "Jeu de données brut",
    "en": "Raw dataset"
   },
   {
    "fr": "Cahier de laboratoire",
    "en": "Lab notebook"
   },
   {
    "fr": "Journal d’observation",
    "en": "Observation log"
   },
   {
    "fr": "Export instrument",
    "en": "Instrument export"
   }
  ],
  "circuit": [
   "resp_programme"
  ],
  "retention": {
   "years": 15,
   "trigger": "project_end",
   "disposition": "review",
   "basis": "Usage recherche : 10 à 15 ans (cahiers de laboratoire, données brutes) ; preuve d'antériorité (CPI L613-7)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel",
   "tres_confidentiel"
  ],
  "confDefault": "confidentiel",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "DPR",
  "label_fr": "Données préparées",
  "label_en": "Prepared data",
  "family": "donnees_experiences",
  "origins": [
   "interne"
  ],
  "attachments": [
   "research"
  ],
  "subtypes": [
   {
    "fr": "Jeu de données nettoyé",
    "en": "Cleaned dataset"
   },
   {
    "fr": "Dataset dérivé",
    "en": "Derived dataset"
   },
   {
    "fr": "Base d’images annotées",
    "en": "Annotated image set"
   }
  ],
  "circuit": [
   "resp_programme"
  ],
  "retention": {
   "years": 10,
   "trigger": "project_end",
   "disposition": "review",
   "basis": "Usage recherche : 10 ans (reproductibilité, intégrité scientifique)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel",
   "tres_confidentiel"
  ],
  "confDefault": "confidentiel",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "ANA",
  "label_fr": "Analyse quantitative",
  "label_en": "Quantitative analysis",
  "family": "analyse_modelisation",
  "origins": [
   "interne"
  ],
  "attachments": [
   "research"
  ],
  "subtypes": [
   {
    "fr": "Analyse statistique",
    "en": "Statistical analysis"
   },
   {
    "fr": "Classeur de calcul",
    "en": "Calculation workbook"
   },
   {
    "fr": "Étude de sensibilité",
    "en": "Sensitivity study"
   }
  ],
  "circuit": [
   "resp_programme"
  ],
  "retention": {
   "years": 10,
   "trigger": "project_end",
   "disposition": "review",
   "basis": "Usage recherche : 10 ans (reproductibilité ; justificatifs CIR, LPF L102 B)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel",
   "tres_confidentiel"
  ],
  "confDefault": "confidentiel",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "SIM",
  "label_fr": "Simulation & Modélisation",
  "label_en": "Simulation & Modelling",
  "family": "analyse_modelisation",
  "origins": [
   "interne"
  ],
  "attachments": [
   "research"
  ],
  "subtypes": [
   {
    "fr": "Fichier modèle",
    "en": "Model file"
   },
   {
    "fr": "Journal d’hypothèses",
    "en": "Assumptions log"
   },
   {
    "fr": "Rapport de validation",
    "en": "Validation report"
   }
  ],
  "circuit": [
   "resp_programme"
  ],
  "retention": {
   "years": 10,
   "trigger": "project_end",
   "disposition": "review",
   "basis": "Usage recherche : 10 ans (reproductibilité, traçabilité des hypothèses)"
  },
  "confAllowed": [
   "restreint",
   "interne",
   "confidentiel",
   "tres_confidentiel"
  ],
  "confDefault": "confidentiel",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "PIC",
  "label_fr": "Protection intellectuelle",
  "label_en": "Intellectual property protection",
  "family": "pi_savoir_confidentiel",
  "origins": [
   "interne"
  ],
  "attachments": [
   "research"
  ],
  "subtypes": [
   {
    "fr": "Déclaration d’invention",
    "en": "Invention disclosure"
   },
   {
    "fr": "Brouillon de brevet",
    "en": "Draft patent"
   },
   {
    "fr": "Note technique confidentielle",
    "en": "Confidential technical note"
   }
  ],
  "circuit": [
   "resp_recherche",
   "resp_juridique",
   "direction"
  ],
  "retention": {
   "years": 5,
   "trigger": "expiry",
   "disposition": "review",
   "basis": "Durée de protection : brevet 20 ans (CPI L611-2) + 5 ans (prescription contrefaçon, CPI L615-8) ; secret des affaires (C. com. L151-1)"
  },
  "confAllowed": [
   "confidentiel",
   "tres_confidentiel"
  ],
  "confDefault": "tres_confidentiel",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "PUB",
  "label_fr": "Publication",
  "label_en": "Publication",
  "family": "resultats_diffusion",
  "origins": [
   "interne"
  ],
  "attachments": [
   "research"
  ],
  "subtypes": [
   {
    "fr": "Résumé",
    "en": "Abstract"
   },
   {
    "fr": "Manuscrit",
    "en": "Manuscript"
   },
   {
    "fr": "Poster",
    "en": "Poster"
   },
   {
    "fr": "Article publié",
    "en": "Published article"
   },
   {
    "fr": "Présentation conférence",
    "en": "Conference presentation"
   }
  ],
  "circuit": [
   "resp_programme",
   "resp_recherche",
   "resp_communication"
  ],
  "retention": {
   "years": null,
   "trigger": "permanent",
   "disposition": "permanent",
   "basis": "Usage : patrimoine scientifique, conservation permanente (état de la technique, CPI L611-11)"
  },
  "confAllowed": [
   "public",
   "restreint",
   "interne",
   "confidentiel"
  ],
  "confDefault": "confidentiel",
  "clientDeliverable": false,
  "source": "deck"
 },
 {
  "code": "COL",
  "label_fr": "Collaboration",
  "label_en": "Collaboration",
  "family": "collaboration_externe",
  "origins": [
   "interne",
   "externe"
  ],
  "attachments": [
   "research"
  ],
  "subtypes": [
   {
    "fr": "Livrable de consortium",
    "en": "Consortium deliverable"
   },
   {
    "fr": "Commentaires relecteurs",
    "en": "Reviewer comments"
   },
   {
    "fr": "Accord de collaboration",
    "en": "Collaboration agreement"
   }
  ],
  "circuit": [
   "resp_programme",
   "resp_recherche"
  ],
  "retention": {
   "years": 10,
   "trigger": "contract_end",
   "disposition": "review",
   "basis": "Accords de collaboration : fin + 10 ans (aligné sur CTR, C. com. L110-4) ; Horizon Europe : 5 ans après solde"
  },
  "confAllowed": [
   "public",
   "restreint",
   "interne",
   "confidentiel",
   "tres_confidentiel"
  ],
  "confDefault": "restreint",
  "clientDeliverable": false,
  "source": "deck"
 }
];
