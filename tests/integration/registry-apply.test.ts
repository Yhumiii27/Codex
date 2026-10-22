import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, schema as s, type Db } from '@/db';
import { FAMILIES, TYPES } from '@/db/registry';
import { INITIAL_ADMIN, seed } from '@/db/seed';
import { FUNCTIONS } from '@/db/seed-org';
import { getCtx } from '@/lib/context';
import { applyRegistry, REGISTRY_APPLY_DETAIL } from '@/lib/registry-apply';
import { emptyTables, useDb } from '../support/db';

// The minimal seed (CODEX_SEED=minimal, point 45 of docs/reste-a-faire.md) and the command that applies the register
// of the code to an existing database (npm run registry:apply, src/lib/registry-apply.ts, point 60): what the
// administration set, as the journal tells it, wins; codes are never renamed or reused; nothing is deleted.

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

let db: Db;
beforeAll(async () => {
  db = await openDb();
}, 60_000);
afterAll(async () => {
  useDb(null);
  await db.$client.close();
});
beforeEach(async () => {
  await emptyTables(db);
  await seed(db, 'minimal');
  useDb(db);
});

const type = async (code: string) => (await db.select().from(s.docTypes).where(eq(s.docTypes.code, code)))[0];
const count = async (table: typeof s.documents | typeof s.projects | typeof s.functionHolders | typeof s.auditLog | typeof s.savedSearches) =>
  (await db.select().from(table)).length;

/** A document of type `code` (the type's family), owned by the initial administrator. */
async function addDocument(id: string, code: string, conf: 'interne' | 'tres_confidentiel' = 'interne') {
  const t = await type(code);
  await db.insert(s.documents).values({
    id, title: id, origin: 'interne', attachment: 'none', family: t.family, typeCode: code, department: 'QUA', ownerId: INITIAL_ADMIN.id, authorId: INITIAL_ADMIN.id,
    conf, keywords: [], state: 'active', status: 'draft', retentionYears: 3, retentionTrigger: 'superseded', retentionDisposition: 'destroy', createdAt: '2026-10-01', modifiedAt: '2026-10-01',
  });
}

/** An entry of the administration, as lib/actions.ts writes it. */
async function adminEntry(action: string, kind: 'type' | 'family' | 'function', id: string, changes: { field: string; before?: unknown; after?: unknown }[] = []) {
  await db.insert(s.auditLog).values({ at: new Date().toISOString(), userId: INITIAL_ADMIN.id, action, targetKind: kind, targetId: id, detail: '', data: { changes: changes as never } });
}

describe('minimal seed', () => {
  it('holds the reference data and one administrator, no demonstration', async () => {
    expect((await db.select().from(s.docTypes)).length).toBe(TYPES.length);
    expect((await db.select().from(s.families)).length).toBe(FAMILIES.length);
    expect((await db.select().from(s.functions)).length).toBe(FUNCTIONS.length);
    expect((await db.select().from(s.rolePermissions)).length).toBeGreaterThan(0);
    expect((await db.select().from(s.departments)).length).toBeGreaterThan(0);
    const users = await db.select().from(s.users);
    expect(users.filter((u) => !u.isSystem).map((u) => u.id)).toEqual([INITIAL_ADMIN.id]);
    expect(users.filter((u) => u.isSystem).map((u) => u.id).sort()).toEqual(['codex', 'keystone', 'vigie']);
    for (const t of [s.documents, s.projects, s.functionHolders, s.auditLog, s.savedSearches] as const) expect(await count(t)).toBe(0);
  });

  it('opens on the initial administrator, who may administer', async () => {
    const ctx = await getCtx();
    expect(ctx.user.id).toBe(INITIAL_ADMIN.id);
    expect(ctx.can('admin')).toBe(true);
    expect(ctx.screens.admin).toBe(true);
  });
});

describe('applyRegistry', () => {
  it('finds nothing to do on a database that follows the register', async () => {
    expect(await applyRegistry(db, { write: false })).toEqual({ steps: [], notes: [], written: false });
  });

  it('brings an earlier register up to date, simulated first, then written and journaled', async () => {
    const victim = TYPES.find((t) => !['PRO', 'FRM'].includes(t.code))!.code;
    await db.update(s.docTypes).set({ labelFr: 'Ancien libellé', retentionYears: 99 }).where(eq(s.docTypes.code, 'PRO'));
    await db.delete(s.docTypes).where(eq(s.docTypes.code, victim));
    await db.insert(s.docTypes).values({ ...(await type('PRO')), code: 'ZZZ', source: 'deck', sort: 999 });
    await db.insert(s.families).values({ key: 'ancienne', labelFr: 'Ancienne', labelEn: 'Old', grp: 'DI', sort: 99 });

    const dry = await applyRegistry(db, { write: false });
    expect(dry.steps.map((x) => `${x.kind} ${x.key} ${x.op}`).sort()).toEqual(['type PRO update', `type ${victim} add`, 'type ZZZ deactivate'].sort());
    expect(dry.steps.find((x) => x.key === 'PRO')!.changes.map((c) => c.field).sort()).toEqual(['labelFr', 'retention']);
    expect(dry.notes).toEqual(expect.arrayContaining([
      { kind: 'family', key: 'ancienne', why: 'absent' }, { kind: 'type', key: 'ZZZ', why: 'absent' }, { kind: 'type', key: 'PRO', why: 'retention_docs' },
    ]));
    // A simulation writes nothing.
    expect((await type('PRO')).labelFr).toBe('Ancien libellé');
    expect(await type(victim)).toBeUndefined();
    expect(await count(s.auditLog)).toBe(0);

    const done = await applyRegistry(db, { write: true });
    expect(done.steps).toEqual(dry.steps);
    expect((await type('PRO')).labelFr).toBe(TYPES.find((t) => t.code === 'PRO')!.label_fr);
    expect((await type('PRO')).retentionYears).toBe(TYPES.find((t) => t.code === 'PRO')!.retention.years);
    expect(await type(victim)).toBeDefined();
    expect((await type('ZZZ')).active).toBe(false);
    expect(await db.select().from(s.families).where(eq(s.families.key, 'ancienne'))).toHaveLength(1);
    const journal = await db.select().from(s.auditLog);
    expect(journal.map((a) => `${a.userId} ${a.action} ${a.targetKind} ${a.targetId} ${a.detail}`).sort()).toEqual([
      `codex type type PRO ${REGISTRY_APPLY_DETAIL}`, `codex type type ZZZ ${REGISTRY_APPLY_DETAIL}`, `codex type_add type ${victim} ${REGISTRY_APPLY_DETAIL}`,
    ].sort());

    // Applied again: nothing more, and the register's values written by the command are not taken for the administration's.
    expect((await applyRegistry(db, { write: true })).steps).toEqual([]);
  });

  it('keeps what the administration set: fields, renamed, deleted and created entries', async () => {
    const [renamed, removed] = TYPES.filter((t) => !['PRO', 'FRM'].includes(t.code)).map((t) => t.code);
    // A label set in the administration, and a circuit changed by nobody the journal knows (an earlier register).
    await db.update(s.docTypes).set({ labelFr: 'Procédure maison', circuit: ['direction'] }).where(eq(s.docTypes.code, 'PRO'));
    await adminEntry('type', 'type', 'PRO', [{ field: 'labelFr', before: 'Procédure', after: 'Procédure maison' }]);
    await db.update(s.docTypes).set({ code: 'QQQ' }).where(eq(s.docTypes.code, renamed));
    await adminEntry('type', 'type', 'QQQ', [{ field: 'code', before: renamed, after: 'QQQ' }]);
    await db.delete(s.docTypes).where(eq(s.docTypes.code, removed));
    await adminEntry('type_remove', 'type', removed);
    await db.insert(s.docTypes).values({ ...(await type('PRO')), code: 'ZZA', source: 'codex', sort: 998 });
    await adminEntry('type_add', 'type', 'ZZA');
    // A type of an earlier register, renamed in the administration, that this register no longer has: kept active.
    await db.insert(s.docTypes).values({ ...(await type('PRO')), code: 'ZZB', source: 'deck', sort: 997 });
    await adminEntry('type', 'type', 'ZZB', [{ field: 'code', before: 'ZZY', after: 'ZZB' }]);
    await db.update(s.functions).set({ labelFr: 'Qualité (maison)' }).where(eq(s.functions.key, 'resp_qualite'));
    await adminEntry('function', 'function', 'resp_qualite', [{ field: 'labelFr', before: 'Responsable qualité', after: 'Qualité (maison)' }]);

    const res = await applyRegistry(db, { write: true });
    expect(res.steps.map((x) => `${x.kind} ${x.key} ${x.op} ${x.changes.map((c) => c.field).join(',')}`)).toEqual(['type PRO update circuit']);
    expect(res.notes).toEqual(expect.arrayContaining([
      { kind: 'type', key: 'PRO', why: 'admin_fields', fields: ['labelFr'] },
      { kind: 'type', key: renamed, why: 'admin_renamed', to: 'QQQ' },
      { kind: 'type', key: removed, why: 'admin_removed' },
      { kind: 'function', key: 'resp_qualite', why: 'admin_fields', fields: ['labelFr'] },
      { kind: 'type', key: 'ZZB', why: 'admin_fields', fields: ['code'] },
    ]));
    expect((await type('PRO')).labelFr).toBe('Procédure maison');
    expect((await type('PRO')).circuit).toEqual(TYPES.find((t) => t.code === 'PRO')!.circuit);
    expect(await type(renamed)).toBeUndefined();
    expect((await type('QQQ')).active).toBe(true);
    expect(await type(removed)).toBeUndefined();
    expect((await type('ZZA')).active).toBe(true);
    expect((await type('ZZB')).active).toBe(true);
  });

  it('holds back a narrower setting that documents would leave, and moves the documents with their family', async () => {
    const pro = TYPES.find((t) => t.code === 'PRO')!;
    const otherFamily = FAMILIES.find((f) => f.key !== pro.family)!.key;
    await db.update(s.docTypes).set({ confAllowed: [...pro.confAllowed, 'tres_confidentiel'], family: otherFamily }).where(eq(s.docTypes.code, 'PRO'));
    await addDocument('PRO-QUA-0001', 'PRO', 'tres_confidentiel');
    await addDocument('PRO-QUA-0002', 'PRO');

    const res = await applyRegistry(db, { write: true });
    expect(res.notes).toContainEqual({ kind: 'type', key: 'PRO', why: 'narrowing', fields: ['confAllowed'], count: 1 });
    expect((await type('PRO')).confAllowed).toContain('tres_confidentiel');
    expect((await type('PRO')).family).toBe(pro.family);
    const docs = await db.select({ family: s.documents.family }).from(s.documents);
    expect(docs.map((d) => d.family)).toEqual([pro.family, pro.family]);
  });

  it('keeps the scope of a function that has holders', async () => {
    await db.update(s.functions).set({ scope: 'department' }).where(eq(s.functions.key, 'resp_qualite'));
    await db.insert(s.functionHolders).values({ functionKey: 'resp_qualite', scopeValue: 'QUA', userId: INITIAL_ADMIN.id });
    const res = await applyRegistry(db, { write: true });
    expect(res.notes).toContainEqual({ kind: 'function', key: 'resp_qualite', why: 'scope_locked' });
    expect((await db.select().from(s.functions).where(and(eq(s.functions.key, 'resp_qualite'), eq(s.functions.scope, 'department'))))).toHaveLength(1);
  });
});
