import 'server-only';
import { cache } from 'react';
import { asc } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { getDb, schema as s } from '@/db';
import { DICT, MATRIX_ROLE, SIM_ROLES, type Lang, type Perm, type SimRole, type T } from './i18n';
import { promoteDue } from './lifecycle';

export const COOKIE_LANG = 'codex-lang';
export const COOKIE_USER = 'codex-user';
export const COOKIE_ROLE = 'codex-role';
export const DEFAULT_USER = 'cbardet'; // reference user of the design: Claire Bardet, HSE and records manager

export type User = typeof s.users.$inferSelect;
export type DocType = typeof s.docTypes.$inferSelect;
export type Screen = 'home' | 'explorer' | 'search' | 'departments' | 'workflow' | 'retention' | 'admin';
export type LabelAxis = 'department' | 'site' | 'family' | 'type' | 'function' | 'project' | 'program';

export type Ctx = {
  lang: Lang;
  L: 0 | 1;
  t: T;
  user: User;
  role: SimRole;
  users: Map<string, User>;
  /** Display label of a reference value (department, site, family, type…). */
  label: (axis: LabelAxis, key: string | null | undefined) => string;
  departments: (typeof s.departments.$inferSelect)[];
  sites: (typeof s.sites.$inferSelect)[];
  families: (typeof s.families.$inferSelect)[];
  types: DocType[];
  typeByCode: Map<string, DocType>;
  functions: (typeof s.functions.$inferSelect)[];
  projects: (typeof s.projects.$inferSelect)[];
  programs: (typeof s.researchPrograms.$inferSelect)[];
  perms: Set<Perm>;
  can: (p: Perm) => boolean;
  /** Records managers see every document, drafts included. */
  seesAll: boolean;
  /** Screens the simulated role can reach (navigation follows the mockup's rules; administration follows the matrix). */
  screens: Record<Screen, boolean>;
  userName: (id: string | null | undefined) => string;
};

/** Everything a request needs to render: language, simulated user and role, reference data and permissions. */
export const getCtx = cache(async (): Promise<Ctx> => {
  const jar = await cookies();
  const db = await getDb();
  // Approved revisions whose effective date has come enter into force before anything is read.
  await promoteDue(db);
  const lang: Lang = jar.get(COOKIE_LANG)?.value === 'en' ? 'en' : 'fr';
  const [users, departments, sites, families, types, functions, projects, programs, rows] = await Promise.all([
    db.select().from(s.users),
    db.select().from(s.departments).orderBy(asc(s.departments.sort)),
    db.select().from(s.sites).orderBy(asc(s.sites.sort)),
    db.select().from(s.families).orderBy(asc(s.families.sort)),
    db.select().from(s.docTypes).orderBy(asc(s.docTypes.sort), asc(s.docTypes.code)),
    db.select().from(s.functions).orderBy(asc(s.functions.sort)),
    db.select().from(s.projects).orderBy(asc(s.projects.code)),
    db.select().from(s.researchPrograms).orderBy(asc(s.researchPrograms.code)),
    db.select().from(s.rolePermissions),
  ]);
  const byId = new Map(users.map((u) => [u.id, u]));
  // System actors (Codex, Keystone, Vigie) are never a simulated person: the audit trail keeps them for automatic actions.
  const fromCookie = byId.get(jar.get(COOKIE_USER)?.value ?? '');
  const user = (fromCookie && !fromCookie.isSystem ? fromCookie : undefined) ?? byId.get(DEFAULT_USER) ?? users.find((u) => !u.isSystem)!;
  const cookieRole = jar.get(COOKIE_ROLE)?.value as SimRole | undefined;
  const role: SimRole = cookieRole && SIM_ROLES.includes(cookieRole) ? cookieRole : SIM_ROLES.includes(user.role as SimRole) ? (user.role as SimRole) : 'collaborateur';
  const perms = new Set(rows.filter((r) => r.role === MATRIX_ROLE[role] && r.granted).map((r) => r.perm as Perm));
  const fr = lang === 'fr';
  const labels = new Map<string, string>();
  departments.forEach((x) => labels.set(`department:${x.code}`, fr ? x.labelFr : x.labelEn));
  sites.forEach((x) => labels.set(`site:${x.key}`, x.label));
  families.forEach((x) => labels.set(`family:${x.key}`, fr ? x.labelFr : x.labelEn));
  types.forEach((x) => labels.set(`type:${x.code}`, fr ? x.labelFr : x.labelEn));
  functions.forEach((x) => labels.set(`function:${x.key}`, fr ? x.labelFr : x.labelEn));
  projects.forEach((x) => labels.set(`project:${x.code}`, x.name));
  programs.forEach((x) => labels.set(`program:${x.code}`, x.name));
  return {
    lang, L: fr ? 0 : 1, t: DICT[lang], user, role, users: byId, departments, sites, families, types,
    typeByCode: new Map(types.map((x) => [x.code, x])), functions, projects, programs, perms,
    label: (axis, key) => (key ? labels.get(`${axis}:${key}`) ?? key : '—'),
    can: (p) => perms.has(p),
    seesAll: role === 'gestionnaire',
    screens: { home: true, explorer: true, search: true, departments: true, workflow: role !== 'auditeur', retention: role !== 'collaborateur', admin: perms.has('admin') },
    userName: (id) => (id ? byId.get(id)?.name ?? id : '—'),
  };
});
