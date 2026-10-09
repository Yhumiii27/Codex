// Organisation, people, projects and functions of the demo — provisional until the org chart is provided.
// People and projects follow Keystone's prototype data so both apps tell the same story.

type Pair = [string, string];

export const DEPARTMENTS: [code: string, fr: string, en: string][] = [
  ['DIR', 'Direction générale', 'Executive management'],
  ['COM', 'Commercial', 'Sales'],
  ['PRJ', 'Projets & contrôle', 'Projects & controls'],
  ['ING', 'Ingénierie', 'Engineering'],
  ['MEP', 'Lots techniques (MEP)', 'MEP'],
  ['CHA', 'Opérations chantier', 'Site operations'],
  ['QUA', 'Qualité', 'Quality'],
  ['HSE', 'HSE', 'HSE'],
  ['ACH', 'Achats & stock', 'Procurement & stock'],
  ['RHU', 'Ressources humaines', 'Human resources'],
  ['FIN', 'Finance & administration', 'Finance & administration'],
  ['JUR', 'Juridique', 'Legal'],
  ['DSI', 'Systèmes d’information', 'Information systems'],
  ['CMN', 'Communication', 'Communication'],
  ['RDI', 'Recherche & innovation', 'Research & innovation'],
];

export const SITES: [key: string, label: string][] = [
  ['lyon', 'Lyon — siège et atelier'],
  ['le_havre', 'Le Havre — magasin'],
  ['marseille', 'Marseille — magasin'],
];

/** Holders of an approval function (HOLDERS) have a role that may approve (seed.ts checks it). */
export const USERS: { id: string; name: string; role: string; dept?: string; site?: string; title?: Pair; system?: boolean }[] = [
  { id: 'cbardet', name: 'Claire Bardet', role: 'gestionnaire', dept: 'HSE', site: 'lyon', title: ['Responsable HSE & gestion documentaire', 'HSE & records manager'] },
  { id: 'gcomte', name: 'Gabriel Comte', role: 'validateur', dept: 'QUA', site: 'lyon', title: ['Responsable qualité', 'Quality manager'] },
  { id: 'hcosta', name: 'Hélène Costa', role: 'validateur', dept: 'DIR', site: 'lyon', title: ['Directrice générale', 'Managing director'] },
  { id: 'mlefebvre', name: 'Marie Lefebvre', role: 'validateur', dept: 'PRJ', site: 'lyon', title: ['Directrice de portefeuille', 'Portfolio director'] },
  { id: 'raubert', name: 'Romain Aubert', role: 'validateur', dept: 'PRJ', site: 'le_havre', title: ['Chef de projet', 'Project manager'] },
  { id: 'sperrin', name: 'Sophie Perrin', role: 'validateur', dept: 'PRJ', site: 'lyon', title: ['Cheffe de projet', 'Project manager'] },
  { id: 'cmoreau', name: 'Cédric Moreau', role: 'validateur', dept: 'PRJ', site: 'lyon', title: ['Chef de projet', 'Project manager'] },
  { id: 'mkerviel', name: 'Marion Kerviel', role: 'validateur', dept: 'ING', site: 'lyon', title: ['Responsable ingénierie', 'Head of engineering'] },
  { id: 'agirard', name: 'Antoine Girard', role: 'validateur', dept: 'ING', site: 'lyon', title: ['Référent ingénierie', 'Engineering lead'] },
  { id: 'jwagner', name: 'Julien Wagner', role: 'collaborateur', dept: 'ING', site: 'lyon', title: ['Ingénieur structure', 'Structural engineer'] },
  { id: 'shaddad', name: 'Samir Haddad', role: 'collaborateur', dept: 'ING', site: 'lyon', title: ['Ingénieur électricité', 'Electrical engineer'] },
  { id: 'cmorvan', name: 'Camille Morvan', role: 'collaborateur', dept: 'ING', site: 'lyon', title: ['Automaticienne', 'Controls engineer'] },
  { id: 'pnogues', name: 'Pauline Noguès', role: 'validateur', dept: 'MEP', site: 'lyon', title: ['Responsable MEP', 'MEP lead'] },
  { id: 'oblanc', name: 'Olivier Blanc', role: 'validateur', dept: 'CHA', site: 'le_havre', title: ['Responsable opérations chantier', 'Site operations manager'] },
  { id: 'lfabre', name: 'Lucas Fabre', role: 'validateur', dept: 'CHA', site: 'le_havre', title: ['Responsable de chantier', 'Site manager'] },
  { id: 'hsauvage', name: 'Hélène Sauvage', role: 'validateur', dept: 'QUA', site: 'lyon', title: ['Technicienne QA/QC', 'QA / QC technician'] },
  { id: 'fbertrand', name: 'Fabien Bertrand', role: 'validateur', dept: 'ACH', site: 'marseille', title: ['Achats & stock', 'Procurement & stock'] },
  { id: 'lmarchand', name: 'Léa Marchand', role: 'collaborateur', dept: 'PRJ', site: 'lyon', title: ['Contrôleuse de gestion', 'Cost controller'] },
  { id: 'nbenali', name: 'Nadia Benali', role: 'validateur', dept: 'RHU', site: 'lyon', title: ['Responsable RH', 'HR manager'] },
  { id: 'tweil', name: 'Thomas Weil', role: 'validateur', dept: 'FIN', site: 'lyon', title: ['Responsable financier', 'Finance manager'] },
  { id: 'irahmani', name: 'Inès Rahmani', role: 'validateur', dept: 'JUR', site: 'lyon', title: ['Juriste', 'Legal counsel'] },
  { id: 'mdelorme', name: 'Marc Delorme', role: 'validateur', dept: 'DSI', site: 'lyon', title: ['Responsable SI', 'IT manager'] },
  { id: 'lmartin', name: 'Lucie Martin', role: 'validateur', dept: 'CMN', site: 'lyon', title: ['Chargée de communication', 'Communication officer'] },
  { id: 'yait', name: 'Yasmine Aït-Saïd', role: 'validateur', dept: 'RDI', site: 'lyon', title: ['Responsable R&D', 'Head of R&D'] },
  { id: 'jholt', name: 'James Holt', role: 'auditeur', dept: 'QUA', title: ['Auditeur interne', 'Internal auditor'] },
  { id: 'codex', name: 'Codex', role: 'system', system: true },
  { id: 'keystone', name: 'Keystone', role: 'system', system: true },
  { id: 'vigie', name: 'Vigie', role: 'system', system: true },
];

export const FUNCTIONS: [key: string, fr: string, en: string, scope: 'global' | 'department' | 'project' | 'research'][] = [
  ['resp_departement', 'Responsable du département', 'Head of department', 'department'],
  ['resp_qualite', 'Responsable qualité', 'Quality manager', 'global'],
  ['resp_hse', 'Responsable HSE', 'HSE manager', 'global'],
  ['direction', 'Direction', 'Executive management', 'global'],
  ['chef_projet', 'Chef de projet', 'Project manager', 'project'],
  ['referent_ingenierie', 'Référent ingénierie', 'Engineering lead', 'project'],
  ['resp_chantier', 'Responsable de chantier', 'Site manager', 'project'],
  ['validation_client', 'Validation client', 'Client approval', 'project'],
  ['resp_achats', 'Responsable achats', 'Procurement manager', 'global'],
  ['resp_rh', 'Responsable RH', 'HR manager', 'global'],
  ['resp_finance', 'Responsable financier', 'Finance manager', 'global'],
  ['resp_juridique', 'Responsable juridique', 'Legal manager', 'global'],
  ['resp_si', 'Responsable SI', 'IT manager', 'global'],
  ['resp_communication', 'Responsable communication', 'Communication manager', 'global'],
  ['resp_recherche', 'Responsable recherche', 'Head of research', 'global'],
  ['resp_programme', 'Responsable de programme', 'Programme manager', 'research'],
];

/** [function, scope value or null, user]. Project and programme managers also answer for their own scope by default. */
export const HOLDERS: [string, string | null, string][] = [
  ['resp_departement', 'DIR', 'hcosta'], ['resp_departement', 'COM', 'hcosta'], ['resp_departement', 'PRJ', 'mlefebvre'],
  ['resp_departement', 'ING', 'mkerviel'], ['resp_departement', 'MEP', 'pnogues'], ['resp_departement', 'CHA', 'oblanc'],
  ['resp_departement', 'QUA', 'gcomte'], ['resp_departement', 'HSE', 'cbardet'], ['resp_departement', 'ACH', 'fbertrand'],
  ['resp_departement', 'RHU', 'nbenali'], ['resp_departement', 'FIN', 'tweil'], ['resp_departement', 'JUR', 'irahmani'],
  ['resp_departement', 'DSI', 'mdelorme'], ['resp_departement', 'CMN', 'lmartin'], ['resp_departement', 'RDI', 'yait'],
  ['resp_departement', null, 'hcosta'],
  ['resp_qualite', null, 'gcomte'], ['resp_qualite', null, 'hsauvage'],
  ['resp_hse', null, 'cbardet'], ['resp_hse', null, 'oblanc'],
  ['direction', null, 'hcosta'], ['direction', null, 'mlefebvre'],
  ['referent_ingenierie', 'HLT-026', 'agirard'], ['referent_ingenierie', null, 'mkerviel'],
  ['resp_chantier', 'HLT-026', 'lfabre'], ['resp_chantier', null, 'oblanc'],
  ['chef_projet', null, 'mlefebvre'], ['validation_client', null, 'mlefebvre'],
  ['resp_achats', null, 'fbertrand'], ['resp_achats', null, 'mlefebvre'],
  ['resp_rh', null, 'nbenali'], ['resp_rh', null, 'hcosta'],
  ['resp_finance', null, 'tweil'], ['resp_finance', null, 'hcosta'],
  ['resp_juridique', null, 'irahmani'], ['resp_juridique', null, 'hcosta'],
  ['resp_si', null, 'mdelorme'], ['resp_si', null, 'hcosta'],
  ['resp_communication', null, 'lmartin'], ['resp_communication', null, 'hcosta'],
  ['resp_recherche', null, 'yait'], ['resp_recherche', null, 'hcosta'],
  ['resp_programme', null, 'yait'],
];

export const PROJECTS: { code: string; name: string; client: string; stage: string; manager: string; site: string; tiers: string; synced: string }[] = [
  { code: 'HLT-026', name: 'Harbor Line Terminal Expansion', client: 'Autorité portuaire du Havre', stage: 'Chantier', manager: 'raubert', site: 'Le Havre — quai 4', tiers: 'Nordvolt (variateurs) · Levage Ouest (grues)', synced: '2026-10-07 08:40' },
  { code: 'NDC-031', name: 'Northgate Data Center Retrofit', client: 'Infrastructure BU', stage: 'Etudes', manager: 'sperrin', site: 'Northgate', tiers: 'ThermoCool (groupes froids)', synced: '2026-10-07 08:40' },
  { code: 'RCF-019', name: 'Clinique Pasteur Lyon — aménagement', client: 'Health trust', stage: 'Mise Service & SAT', manager: 'cmoreau', site: 'Lyon — clinique Pasteur', tiers: 'Elec Rhône (CFO/CFA)', synced: '2026-10-06 17:15' },
];

export const PROGRAMS: { code: string; name: string; manager: string }[] = [
  { code: 'R2601', name: 'Capteurs connectés pour équipements portuaires', manager: 'yait' },
  { code: 'R2602', name: 'Bétons bas carbone pour fondations', manager: 'yait' },
];

export const ROLE_KEYS = ['lecteur', 'contributeur', 'gestionnaire', 'validateur', 'auditeur', 'administrateur'] as const;
export const PERM_KEYS = ['read', 'upload', 'edit', 'approve', 'publish', 'archive', 'destroy', 'admin'] as const;
export const MATRIX = [
  [1,0,0,0,0,0,0,0],
  [1,1,1,0,0,0,0,0],
  [1,1,1,1,1,1,0,1], // records manager: approve granted (Claire Bardet holds approval steps); administers Codex
  [1,1,1,1,1,0,0,0], // approvers also write the documents of their scope
  [1,0,0,0,0,0,0,0],
  [1,1,1,1,1,1,1,1],
];

export const SAVED: { label: Pair; q: string; facets: Record<string, string[]> }[] = [
  { label: ['Procédures en vigueur', 'Procedures in force'], q: '', facets: { type: ['PRO'], status: ['in_force'] } },
  { label: ['Documents du projet HLT-026', 'HLT-026 project documents'], q: '', facets: { project: ['HLT-026'] } },
  { label: ['Documents externes à renouveler', 'External documents to renew'], q: '', facets: { origin: ['externe'] } },
];
