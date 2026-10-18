import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Db as CodexDb } from '@/db';
import * as s from '@/db/schema';
import { FAMILIES, TYPES, type RegistryType } from '@/db/registry';
import { FUNCTIONS } from '@/db/seed-org';
import { entryChanges, familyJournal, functionJournal, typeJournal } from './journal-values';
import { BUILT_IN_TYPES, builtInScopeIssue, builtInTypeIssue, keyIssue, outsideType, typeCodeIssue, type FunctionScope } from './registry-rules';

// Applies the register of the code (src/db/registry.ts: families and types; the approval functions of
// src/db/seed-org.ts) to an existing database, which the seed only fills once (point 60 of docs/reste-a-faire.md):
// `npm run registry:apply` shows what would change (simulation, the default), `-- --apply` writes it, server stopped.
//
// What Administration › Registre des types and › Fonctions & circuits set wins over the register, as long as the
// journal tells it (entries since 15 October 2026, by a person, not by this command):
// - an entry created there, or the register's entry renamed or deleted there, is left as it is;
// - a field changed there keeps its value; the register's other fields are applied.
// The rules of the administration hold (lib/actions.ts): a code is never renamed or reused here (a used code is frozen;
// a code the register no longer has is a type made inactive, never deleted: documents.type_code refers to it); a new
// code that would read as another segment of an ID is refused; a type's documents follow its family; a setting that
// would leave out an origin, attachment or confidentiality some documents have is held back, to be confirmed in the
// administration; a function with holders keeps its scope; documents keep their retention class (applied, if wanted,
// from the administration). Each change is journaled like the administration's, by the system actor Codex.

/** A drizzle database with Codex's schema: the server's (src/db/index.ts) or the command's. */
type Db = CodexDb;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type EntryKind = 'family' | 'function' | 'type';

/** A change written (or, in simulation, that would be): the entry, what is done, the fields before → after. */
export type RegistryStep = { kind: EntryKind; key: string; op: 'add' | 'update' | 'deactivate'; changes: s.AuditChange[] };

/**
 * Why something of the register is not applied, or not all of it:
 * - admin_fields: fields set in the administration, kept (`fields`);
 * - admin_added: an entry the administration created has the register's code: kept as it is;
 * - admin_removed: deleted in the administration: not restored;
 * - admin_renamed: renamed in the administration (`to`): the register's fields are applied under its new code;
 * - code_clash: a new code already names a department, project, programme or QMS (`detail`): not added;
 * - narrowing: `fields` would leave out values `count` documents have: held back, to confirm in the administration;
 * - invalid: the merged values are not a valid setting (`detail`): nothing applied to that entry;
 * - scope_locked: a function with holders keeps its scope;
 * - absent: in the database from an earlier register, no longer in it: kept (a family, a function) or made inactive (a type);
 * - retention_docs: the type's retention changed; its documents keep theirs until applied from the administration.
 */
export type RegistryNote = {
  kind: EntryKind; key: string;
  why: 'admin_fields' | 'admin_added' | 'admin_removed' | 'admin_renamed' | 'code_clash' | 'narrowing' | 'invalid' | 'scope_locked' | 'absent' | 'retention_docs';
  fields?: string[]; count?: number; to?: string; detail?: string;
};
export type RegistryReport = { steps: RegistryStep[]; notes: RegistryNote[]; written: boolean };

/** The journal's detail of the entries this command writes. */
export const REGISTRY_APPLY_DETAIL = 'npm run registry:apply';

/** What the administration did to the entries of one kind, read from the journal (people only, oldest first). */
type History = { fields: Map<string, Set<string>>; added: Set<string>; removed: Set<string>; renamed: Map<string, string> };

async function history(tx: Tx, kind: EntryKind): Promise<History> {
  const rows = await tx.select({ action: s.auditLog.action, id: s.auditLog.targetId, data: s.auditLog.data }).from(s.auditLog)
    .where(and(eq(s.auditLog.targetKind, kind), ne(s.auditLog.userId, 'codex'), inArray(s.auditLog.action, [kind, `${kind}_add`, `${kind}_remove`])))
    .orderBy(asc(s.auditLog.at), asc(s.auditLog.id));
  const h: History = { fields: new Map(), added: new Set(), removed: new Set(), renamed: new Map() };
  const codeField = kind === 'type' ? 'code' : 'key';
  for (const r of rows) {
    const id = r.id ?? '';
    if (r.action === `${kind}_add`) {
      h.added.add(id);
      h.removed.delete(id);
    } else if (r.action === `${kind}_remove`) {
      h.removed.add(id);
      h.added.delete(id);
      h.fields.delete(id);
    } else {
      const cs = (r.data as s.AuditData | null)?.changes ?? [];
      const rename = cs.find((c) => c.field === codeField && typeof c.before === 'string' && typeof c.after === 'string');
      if (rename) {
        const from = rename.before as string;
        const fields = h.fields.get(from) ?? new Set<string>();
        h.fields.delete(from);
        h.fields.set(id, fields);
        if (h.added.delete(from)) h.added.add(id);
        for (const [k, v] of h.renamed) if (v === from) h.renamed.set(k, id);
        h.renamed.set(from, id);
      }
      const fields = h.fields.get(id) ?? new Set<string>();
      cs.forEach((c) => fields.add(c.field));
      h.fields.set(id, fields);
    }
  }
  return h;
}

/** The database's key of a register entry: its own, or the one the administration renamed it to. */
function resolve(key: string, present: Set<string>, h: History): { key: string; renamed?: string } | null {
  if (present.has(key)) return { key };
  const to = h.renamed.get(key);
  return to && present.has(to) ? { key: to, renamed: to } : null;
}

async function journal(tx: Tx, action: string, kind: EntryKind, id: string, cs: s.AuditChange[]) {
  await tx.insert(s.auditLog).values({ at: new Date().toISOString(), userId: 'codex', action, targetKind: kind, targetId: id, detail: REGISTRY_APPLY_DETAIL, data: { changes: cs } });
}

async function nextSort(tx: Tx, column: typeof s.docTypes.sort | typeof s.families.sort | typeof s.functions.sort) {
  const [{ last }] = await tx.select({ last: sql<number>`coalesce(max(${column}), -1)::int` }).from(column.table);
  return Number(last) + 1;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Applies, field by field, what the administration did not set; returns the fields it kept. */
function merge<T extends Record<string, unknown>>(cur: T, wanted: Partial<T>, fromAdmin: Set<string> | undefined, journalField: (k: string) => string) {
  const next = { ...cur };
  const kept: string[] = [];
  for (const [k, v] of Object.entries(wanted)) {
    if (same(cur[k], v)) continue;
    if (fromAdmin?.has(journalField(k))) kept.push(journalField(k));
    else (next as Record<string, unknown>)[k] = v;
  }
  return { next, kept: [...new Set(kept)] };
}

class Rollback extends Error {}

// ── Families ─────────────────────────────────────────────────────────────

async function applyFamilies(tx: Tx, steps: RegistryStep[], notes: RegistryNote[]) {
  const h = await history(tx, 'family');
  const rows = await tx.select().from(s.families);
  const present = new Set(rows.map((r) => r.key));
  const claimed = new Set<string>();
  for (const f of FAMILIES) {
    const wanted = { labelFr: f.label_fr, labelEn: f.label_en, grp: f.group };
    const at = resolve(f.key, present, h);
    if (!at) {
      if (h.removed.has(f.key)) notes.push({ kind: 'family', key: f.key, why: 'admin_removed' });
      else {
        const bad = keyIssue(f.key, [...present]);
        if (bad) notes.push({ kind: 'family', key: f.key, why: 'invalid', detail: bad });
        else {
          const values = { key: f.key, ...wanted };
          await tx.insert(s.families).values({ ...values, sort: await nextSort(tx, s.families.sort) });
          await journal(tx, 'family_add', 'family', f.key, entryChanges(null, familyJournal(values)));
          steps.push({ kind: 'family', key: f.key, op: 'add', changes: entryChanges(null, familyJournal(values)) });
          present.add(f.key);
        }
      }
      claimed.add(f.key);
      continue;
    }
    if (at.renamed) notes.push({ kind: 'family', key: f.key, why: 'admin_renamed', to: at.renamed });
    claimed.add(at.key);
    if (h.added.has(at.key)) {
      notes.push({ kind: 'family', key: at.key, why: 'admin_added' });
      continue;
    }
    const cur = rows.find((r) => r.key === at.key)!;
    const { next, kept } = merge({ labelFr: cur.labelFr, labelEn: cur.labelEn, grp: cur.grp }, wanted, h.fields.get(at.key), (k) => k);
    if (kept.length) notes.push({ kind: 'family', key: at.key, why: 'admin_fields', fields: kept });
    const cs = entryChanges(familyJournal(cur), familyJournal({ key: at.key, ...next }));
    if (!cs.length) continue;
    await tx.update(s.families).set(next).where(eq(s.families.key, at.key));
    await journal(tx, 'family', 'family', at.key, cs);
    steps.push({ kind: 'family', key: at.key, op: 'update', changes: cs });
  }
  for (const r of rows) if (!claimed.has(r.key) && !h.added.has(r.key)) notes.push({ kind: 'family', key: r.key, why: 'absent' });
}

// ── Functions ────────────────────────────────────────────────────────────

async function applyFunctions(tx: Tx, steps: RegistryStep[], notes: RegistryNote[]) {
  const h = await history(tx, 'function');
  const rows = await tx.select().from(s.functions);
  const present = new Set(rows.map((r) => r.key));
  const claimed = new Set<string>();
  for (const [key, labelFr, labelEn, scope] of FUNCTIONS) {
    const wanted = { labelFr, labelEn, scope: scope as FunctionScope };
    const at = resolve(key, present, h);
    if (!at) {
      if (h.removed.has(key)) notes.push({ kind: 'function', key, why: 'admin_removed' });
      else {
        const bad = keyIssue(key, [...present]) ?? builtInScopeIssue(key, wanted.scope);
        if (bad) notes.push({ kind: 'function', key, why: 'invalid', detail: bad });
        else {
          const values = { key, ...wanted };
          await tx.insert(s.functions).values({ ...values, sort: await nextSort(tx, s.functions.sort) });
          await journal(tx, 'function_add', 'function', key, entryChanges(null, functionJournal(values)));
          steps.push({ kind: 'function', key, op: 'add', changes: entryChanges(null, functionJournal(values)) });
          present.add(key);
        }
      }
      claimed.add(key);
      continue;
    }
    if (at.renamed) notes.push({ kind: 'function', key, why: 'admin_renamed', to: at.renamed });
    claimed.add(at.key);
    if (h.added.has(at.key)) {
      notes.push({ kind: 'function', key: at.key, why: 'admin_added' });
      continue;
    }
    const cur = rows.find((r) => r.key === at.key)!;
    const { next, kept } = merge({ labelFr: cur.labelFr, labelEn: cur.labelEn, scope: cur.scope }, wanted, h.fields.get(at.key), (k) => k);
    if (kept.length) notes.push({ kind: 'function', key: at.key, why: 'admin_fields', fields: kept });
    if (next.scope !== cur.scope) {
      const [held] = await tx.select({ id: s.functionHolders.id }).from(s.functionHolders).where(eq(s.functionHolders.functionKey, at.key)).limit(1);
      if (held || builtInScopeIssue(at.key, next.scope)) {
        notes.push({ kind: 'function', key: at.key, why: 'scope_locked' });
        next.scope = cur.scope;
      }
    }
    const cs = entryChanges(functionJournal(cur), functionJournal({ key: at.key, ...next }));
    if (!cs.length) continue;
    await tx.update(s.functions).set(next).where(eq(s.functions.key, at.key));
    await journal(tx, 'function', 'function', at.key, cs);
    steps.push({ kind: 'function', key: at.key, op: 'update', changes: cs });
  }
  for (const r of rows) if (!claimed.has(r.key) && !h.added.has(r.key)) notes.push({ kind: 'function', key: r.key, why: 'absent' });
}

// ── Types ────────────────────────────────────────────────────────────────

type TypeRow = typeof s.docTypes.$inferSelect;
type TypeSettings = Omit<TypeRow, 'code' | 'reviewMonths' | 'active' | 'source' | 'sort'>;

/** A register type as the columns of doc_types store it. */
function settingsOf(t: RegistryType): TypeSettings {
  return {
    labelFr: t.label_fr, labelEn: t.label_en, family: t.family, origins: t.origins, attachments: t.attachments, subtypes: t.subtypes, circuit: t.circuit,
    retentionYears: t.retention.years, retentionTrigger: t.retention.trigger, retentionDisposition: t.retention.disposition, retentionBasis: t.retention.basis, retentionBasisEn: t.retention.basisEn ?? '',
    confAllowed: t.confAllowed, confDefault: t.confDefault, iso: t.iso ?? null, clientDeliverable: !!t.clientDeliverable,
  };
}

/** Journal field of a column (lib/journal-values.ts typeJournal): the three retention columns are one field. */
const typeField = (k: string) => (k.startsWith('retention') && k !== 'retentionBasis' && k !== 'retentionBasisEn' ? 'retention' : k);

/** Why these settings are not a valid type, or null. */
async function typeIssue(tx: Tx, code: string, v: TypeSettings): Promise<string | null> {
  if (!v.origins.length || !v.attachments.length || !v.confAllowed.length) return 'empty origins, attachments or confidentialities';
  if (!v.confAllowed.includes(v.confDefault)) return `default confidentiality ${v.confDefault} not admitted`;
  const fixed = builtInTypeIssue(code, v);
  if (fixed) return fixed;
  const [fam] = await tx.select({ key: s.families.key }).from(s.families).where(eq(s.families.key, v.family));
  if (!fam) return `unknown family ${v.family}`;
  const known = new Set((await tx.select({ key: s.functions.key }).from(s.functions)).map((r) => r.key));
  const missing = v.circuit.filter((k) => !known.has(k));
  return missing.length ? `unknown function ${missing.join(', ')}` : null;
}

async function applyTypes(tx: Tx, steps: RegistryStep[], notes: RegistryNote[]) {
  const h = await history(tx, 'type');
  const rows = await tx.select().from(s.docTypes);
  const present = new Set(rows.map((r) => r.code));
  const claimed = new Set<string>();
  const [departments, projects, programs] = await Promise.all([
    tx.select({ k: s.departments.code }).from(s.departments), tx.select({ k: s.projects.code }).from(s.projects), tx.select({ k: s.researchPrograms.code }).from(s.researchPrograms),
  ]);
  const space = () => ({ types: [...present], departments: departments.map((x) => x.k), projects: projects.map((x) => x.k), programs: programs.map((x) => x.k) });

  for (const t of TYPES) {
    const wanted = settingsOf(t);
    const at = resolve(t.code, present, h);
    if (!at) {
      claimed.add(t.code);
      if (h.removed.has(t.code)) {
        notes.push({ kind: 'type', key: t.code, why: 'admin_removed' });
        continue;
      }
      const clash = typeCodeIssue(t.code, space());
      if (clash) {
        notes.push({ kind: 'type', key: t.code, why: 'code_clash', detail: clash });
        continue;
      }
      const bad = await typeIssue(tx, t.code, wanted);
      if (bad) {
        notes.push({ kind: 'type', key: t.code, why: 'invalid', detail: bad });
        continue;
      }
      const row = { code: t.code, ...wanted, reviewMonths: null, active: true, source: t.source };
      await tx.insert(s.docTypes).values({ ...row, sort: await nextSort(tx, s.docTypes.sort) });
      const cs = entryChanges(null, typeJournal(row));
      await journal(tx, 'type_add', 'type', t.code, cs);
      steps.push({ kind: 'type', key: t.code, op: 'add', changes: cs });
      present.add(t.code);
      continue;
    }
    if (at.renamed) notes.push({ kind: 'type', key: t.code, why: 'admin_renamed', to: at.renamed });
    claimed.add(at.key);
    const cur = rows.find((r) => r.code === at.key)!;
    if (h.added.has(at.key) || cur.source === 'codex') {
      notes.push({ kind: 'type', key: at.key, why: 'admin_added' });
      continue;
    }
    const settings = Object.fromEntries(Object.keys(wanted).map((k) => [k, cur[k as keyof TypeSettings]])) as TypeSettings;
    const { next, kept } = merge<TypeSettings>(settings, wanted, h.fields.get(at.key), typeField);
    if (kept.length) notes.push({ kind: 'type', key: at.key, why: 'admin_fields', fields: kept });

    // A narrower setting that some documents would no longer meet waits for the administration's confirmation.
    const narrower = (['origins', 'attachments', 'confAllowed'] as const).filter((k) => (cur[k] as string[]).some((x) => !(next[k] as string[]).includes(x)));
    if (narrower.length) {
      const docs = await tx.select({ origin: s.documents.origin, attachment: s.documents.attachment, conf: s.documents.conf }).from(s.documents).where(eq(s.documents.typeCode, at.key));
      const out = docs.filter((d) => outsideType(d, next) && !outsideType(d, cur)).length;
      if (out) {
        for (const k of narrower) (next as Record<string, unknown>)[k] = cur[k];
        if (!next.confAllowed.includes(next.confDefault)) next.confDefault = cur.confDefault;
        notes.push({ kind: 'type', key: at.key, why: 'narrowing', fields: [...narrower], count: out });
      }
    }
    const merged = { ...cur, ...next };
    const cs = entryChanges(typeJournal(cur), typeJournal(merged));
    if (!cs.length) continue;
    const bad = await typeIssue(tx, at.key, next);
    if (bad) {
      notes.push({ kind: 'type', key: at.key, why: 'invalid', detail: bad });
      continue;
    }
    await tx.update(s.docTypes).set(next).where(eq(s.docTypes.code, at.key));
    // A document's family is its type's (lib/actions.ts updateType).
    if (next.family !== cur.family) await tx.update(s.documents).set({ family: next.family }).where(eq(s.documents.typeCode, at.key));
    await journal(tx, 'type', 'type', at.key, cs);
    steps.push({ kind: 'type', key: at.key, op: 'update', changes: cs });
    if (cs.some((c) => c.field === 'retention')) notes.push({ kind: 'type', key: at.key, why: 'retention_docs' });
  }

  // Types of an earlier register that this one no longer has: made inactive, never deleted (documents refer to them).
  for (const r of rows) {
    if (claimed.has(r.code) || h.added.has(r.code) || r.source === 'codex') continue;
    notes.push({ kind: 'type', key: r.code, why: 'absent' });
    if (!r.active || BUILT_IN_TYPES.includes(r.code)) continue;
    // Made active again, or renamed, in the administration: its decision stands.
    const set = ['active', 'code'].filter((f) => h.fields.get(r.code)?.has(f));
    if (set.length) {
      notes.push({ kind: 'type', key: r.code, why: 'admin_fields', fields: set });
      continue;
    }
    await tx.update(s.docTypes).set({ active: false }).where(eq(s.docTypes.code, r.code));
    const cs = entryChanges(typeJournal(r), typeJournal({ ...r, active: false }));
    await journal(tx, 'type', 'type', r.code, cs);
    steps.push({ kind: 'type', key: r.code, op: 'deactivate', changes: cs });
  }
}

/**
 * Compares the register of the code with the database and applies the difference (`write`), in one transaction; in
 * simulation, the same work is done and rolled back, so that the report is exactly what writing would do.
 */
export async function applyRegistry(db: Db, { write }: { write: boolean }): Promise<RegistryReport> {
  const steps: RegistryStep[] = [];
  const notes: RegistryNote[] = [];
  try {
    await db.transaction(async (tx) => {
      await applyFamilies(tx, steps, notes);
      await applyFunctions(tx, steps, notes);
      await applyTypes(tx, steps, notes);
      if (!write) throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
  return { steps, notes, written: write };
}
