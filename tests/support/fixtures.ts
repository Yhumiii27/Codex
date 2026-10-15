import type { Db } from '@/db';
import * as s from '@/db/schema';
import type { Attachment, Conf, Origin } from '@/db/schema';

// Minimal reference data for the integration tests, independent of the demo seed (src/db/seed*.ts) and of the
// provisional demo matrix type → circuit (O-06): each test reads clearly against these few people, types and functions.

/** Matrix rows (role_permissions) of the roles the tests simulate, keyed by matrix role (lib/i18n.ts, MATRIX_ROLE). */
export const MATRIX: Record<string, string[]> = {
  lecteur: ['read'],
  contributeur: ['read', 'upload', 'edit'],
  validateur: ['read', 'upload', 'edit', 'approve', 'publish'],
  auditeur: ['read'],
  gestionnaire: ['read', 'upload', 'edit', 'approve', 'publish', 'archive', 'admin'],
};

/** People: id, default role (simulated role, lib/i18n.ts SIM_ROLES), department. */
export const PEOPLE = {
  manager: ['gestionnaire', 'HSE'], // records manager: sees every draft (D-14)
  owner: ['collaborateur', 'QUA'],
  writer: ['collaborateur', 'QUA'],
  writer2: ['collaborateur', 'ING'],
  auditor: ['auditeur', 'QUA'], // may read, may not upload: cannot draft
  head: ['validateur', 'QUA'], // head of the QUA department
  quality: ['validateur', 'QUA'], // quality manager
  quality2: ['validateur', 'QUA'], // second quality manager
  director: ['validateur', 'DIR'], // executive management, group head of department
  pm: ['validateur', 'PRJ'], // manager of project HLT-026
  engineer: ['validateur', 'ING'],
  researcher: ['validateur', 'RDI'], // manager of programme R2601
} as const satisfies Record<string, readonly [string, string]>;
export type Person = keyof typeof PEOPLE;

/** System actors the journal records automatic actions under. */
export const SYSTEM = ['codex', 'vigie', 'keystone'] as const;

export const DEPARTMENTS = ['QUA', 'ING', 'HSE', 'PRJ', 'DIR', 'RDI'] as const;

type TypeFixture = { code: string; family: string; origins: Origin[]; attachments: Attachment[]; circuit: string[]; confAllowed: Conf[]; confDefault: Conf };

const ABOVE_PUBLIC: Conf[] = ['restreint', 'interne', 'confidentiel', 'tres_confidentiel'];

/** Types: a procedure with a two-step circuit, a project document, a template, a research report, correspondence without approval. */
export const TYPES: TypeFixture[] = [
  { code: 'PRO', family: 'qualite', origins: ['interne'], attachments: ['none'], circuit: ['resp_departement', 'resp_qualite'], confAllowed: ABOVE_PUBLIC, confDefault: 'interne' },
  { code: 'PID', family: 'projet', origins: ['interne', 'externe'], attachments: ['project'], circuit: ['chef_projet'], confAllowed: ABOVE_PUBLIC, confDefault: 'interne' },
  { code: 'FRM', family: 'qualite', origins: ['interne'], attachments: ['none'], circuit: ['resp_qualite'], confAllowed: ABOVE_PUBLIC, confDefault: 'interne' },
  { code: 'PRT', family: 'recherche', origins: ['interne'], attachments: ['research'], circuit: ['resp_programme'], confAllowed: ABOVE_PUBLIC, confDefault: 'confidentiel' },
  { code: 'COR', family: 'correspondance', origins: ['interne', 'externe'], attachments: ['none', 'project'], circuit: [], confAllowed: ['public', ...ABOVE_PUBLIC], confDefault: 'interne' },
];

export const FUNCTIONS: [key: string, scope: 'global' | 'department' | 'project' | 'research'][] = [
  ['resp_departement', 'department'],
  ['resp_qualite', 'global'],
  ['direction', 'global'],
  ['chef_projet', 'project'],
  ['resp_programme', 'research'],
];

/** Function holders: [function, scope value (null: the whole group), person], in the order they are looked up. */
export const HOLDERS: [string, string | null, Person][] = [
  ['resp_departement', 'QUA', 'head'],
  ['resp_departement', null, 'director'],
  ['resp_qualite', null, 'quality'],
  ['resp_qualite', null, 'quality2'],
  ['direction', null, 'director'],
  ['chef_projet', null, 'director'],
  ['resp_programme', null, 'director'],
];

/** Writes the reference data into an empty database (openDb). */
export async function insertFixtures(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(s.departments).values(DEPARTMENTS.map((code, sort) => ({ code, labelFr: code, labelEn: code, sort })));
    await tx.insert(s.users).values([
      ...Object.entries(PEOPLE).map(([id, [role, department]]) => ({ id, name: id, initials: id.slice(0, 2).toUpperCase(), role, department })),
      ...SYSTEM.map((id) => ({ id, name: id, initials: id.slice(0, 2).toUpperCase(), role: 'system', isSystem: true })),
    ]);
    await tx.insert(s.rolePermissions).values(Object.entries(MATRIX).flatMap(([role, perms]) => perms.map((perm) => ({ role, perm, granted: true }))));
    const families = [...new Set(TYPES.map((t) => t.family))];
    await tx.insert(s.families).values(families.map((key, sort) => ({ key, labelFr: key, labelEn: key, grp: 'DI', sort })));
    await tx.insert(s.docTypes).values(TYPES.map((t, sort) => ({
      ...t, labelFr: t.code, labelEn: t.code, subtypes: [], retentionYears: 10, retentionTrigger: 'superseded' as const, retentionDisposition: 'destroy' as const, sort,
    })));
    await tx.insert(s.functions).values(FUNCTIONS.map(([key, scope], sort) => ({ key, labelFr: key, labelEn: key, scope, sort })));
    await tx.insert(s.functionHolders).values(HOLDERS.map(([functionKey, scopeValue, userId]) => ({ functionKey, scopeValue, userId })));
    await tx.insert(s.projects).values({ code: 'HLT-026', name: 'Harbor Line', client: 'Port', stage: 'Chantier', managerId: 'pm', site: 'Le Havre', tiers: '', syncedAt: '2026-10-01 08:00:00' });
    await tx.insert(s.researchPrograms).values({ code: 'R2601', name: 'Capteurs', managerId: 'researcher' });
  });
}
