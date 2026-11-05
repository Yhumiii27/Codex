import { readFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/documents/route';
import { schema as s } from '@/db';
import { TYPES } from '@/db/registry';
import { createDocument, releaseHold, updateMeta } from '@/lib/actions';
import { syncCapex } from '@/lib/capex';
import { getCtx } from '@/lib/context';
import { DICT } from '@/lib/i18n';
import { getDoc } from '@/lib/queries';
import { resetRateLimits } from '@/lib/ratelimit';
import { fixClock, setupDb, viewOf } from '../support/db';
import { actAs } from '../support/session';

// Arche's requests CX-01, CX-02 and CX-07, as the user chose on 1 November 2026 (docs/decisions.md D-29): a 4th
// attachment `capex` whose CAPEX code is the context of the ID (PID-CPX-APM-2026-01-001), the CAPEX read from Arche's view
// arche.pub_capex into a mirror; sub-types of existing types for the CAPEX pieces; a legal hold put at the deposit of a
// gate file, never an approval outside a circuit.

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock('2026-11-05T08:00:00Z');
const t = DICT.fr;
const TOKEN = 'D3p0sit-t0ken-0f-th1rty-tw0-v4r1ed-ch4rs';

beforeEach(async () => {
  resetRateLimits();
  vi.stubEnv('CODEX_DOCUMENTS_TOKEN', TOKEN);
  vi.stubEnv('CODEX_CLAMD', '');
  // The fixtures' P&ID admits a project only; the register gives capex to every type that admits a project.
  await db().update(s.docTypes).set({ attachments: ['project', 'capex'] }).where(eq(s.docTypes.code, 'PID'));
  await db().insert(s.capex).values([
    { code: 'CPX-APM-2026-01', name: 'Ligne 3', subsidiaryCode: 'APM', subsidiary: 'APM Industrie', site: 'Lyon', status: 'en_cours', phase: 'P2', syncedAt: '2026-11-01T08:00:00Z' },
    { code: 'CPX-OLD-2025-09', name: 'Ancien', active: false, syncedAt: '2026-11-01T08:00:00Z' },
  ]);
});
afterEach(() => vi.unstubAllEnvs());

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
const pid = (fields: Record<string, string> = {}) => createDocument(form({ title: 'P&ID de la ligne 3', typeCode: 'PID', origin: 'interne', attachment: 'capex', capexCode: 'CPX-APM-2026-01', department: 'QUA', ...fields }));

async function deposit(meta: Record<string, unknown>) {
  const res = await POST(new Request('http://codex.test/api/documents', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(meta),
  }));
  return { status: res.status, body: await res.json() };
}
const META = { sourceRef: 'arche:dossier/CPX-APM-2026-01/g1/v1', title: 'Dossier de jalon G1', typeCode: 'PID', department: 'QUA', ownerId: 'owner', conf: 'interne' };

describe('CX-01: the capex attachment', () => {
  it('takes the CAPEX code as the context of the ID, three digits, and keeps it on the record', async () => {
    actAs('owner');
    expect(await pid()).toMatchObject({ ok: true, href: '/documents/PID-CPX-APM-2026-01-001?tab=meta' });
    expect(await pid()).toMatchObject({ ok: true, href: '/documents/PID-CPX-APM-2026-01-002?tab=meta' });
    const [d] = await db().select().from(s.documents).where(eq(s.documents.id, 'PID-CPX-APM-2026-01-001'));
    expect(d).toMatchObject({ attachment: 'capex', capexCode: 'CPX-APM-2026-01', projectCode: null, programCode: null });
    const res = await getDoc(await getCtx(), d.id);
    expect(res !== 'hidden' && res?.doc.contextL).toBe('CPX-APM-2026-01 · Ligne 3');
  });

  it('refuses a CAPEX missing, unknown or no longer published, and a type that does not admit it', async () => {
    actAs('owner');
    expect(await pid({ capexCode: '' })).toEqual({ ok: false, error: t.capex_required });
    expect(await pid({ capexCode: 'CPX-XXX' })).toEqual({ ok: false, error: t.capex_required });
    expect(await pid({ capexCode: 'CPX-OLD-2025-09' })).toEqual({ ok: false, error: t.capex_required });
    expect(await pid({ typeCode: 'PRO' })).toEqual({ ok: false, error: t.type_mismatch });
    expect(await db().select().from(s.documents)).toEqual([]);
  });

  it('moves a draft to a CAPEX: a new ID, the former one kept as an alias', async () => {
    actAs('owner');
    await createDocument(form({ title: 'P&ID', typeCode: 'PID', origin: 'interne', attachment: 'project', projectCode: 'HLT-026', department: 'QUA' }));
    const r = await updateMeta(form({ docId: 'PID-HLT-026-001', version: (await viewOf(db(), 'PID-HLT-026-001')).version, attachment: 'capex', capexCode: 'CPX-APM-2026-01' }));
    expect(r).toMatchObject({ ok: true });
    const [d] = await db().select().from(s.documents);
    expect(d).toMatchObject({ id: 'PID-CPX-APM-2026-01-001', aliases: ['PID-HLT-026-001'], projectCode: null, capexCode: 'CPX-APM-2026-01' });
  });

  it('is filed by an application with attachment capex and capexCode; an unknown CAPEX is refused', async () => {
    const ok = await deposit({ ...META, attachment: 'capex', capexCode: 'CPX-APM-2026-01' });
    expect(ok).toMatchObject({ status: 201, body: { id: 'PID-CPX-APM-2026-01-001', revision: 'A', status: 'draft' } });
    const bad = await deposit({ ...META, sourceRef: 'arche:x/2', attachment: 'capex', capexCode: 'CPX-OLD-2025-09' });
    expect(bad).toMatchObject({ status: 400, body: { error: 'validation', issues: [expect.objectContaining({ field: 'capexCode', code: 'capex_unknown' })] } });
    // The code alone says the attachment, as a project or programme code does.
    expect(await deposit({ ...META, sourceRef: 'arche:x/3', capexCode: 'CPX-APM-2026-01' })).toMatchObject({ status: 201, body: { id: 'PID-CPX-APM-2026-01-002' } });
  });
});

describe('CX-01: the CAPEX read from Arche', () => {
  it('waits while arche.pub_capex cannot be read, and changes nothing', async () => {
    expect(await syncCapex(db())).toEqual({ status: 'skipped', reason: 'no_source' });
    expect(await db().select().from(s.capex)).toHaveLength(2);
  });

  // On PGlite only: under npm run test:pg the role has no CREATE on the database (as codex_app on the shared server), so
  // it cannot make the stand-in schema arche; the case above (view not readable) runs on both.
  it.skipIf(!!process.env.CODEX_TEST_DATABASE_URL?.trim())('adds and updates the CAPEX published, makes inactive those no longer published, never removes one', async () => {
    await db().$client.exec(`create schema arche;
      create table arche.pub_capex (code text, filiale_code text, filiale text, zone text, site text, intitule text, statut text, phase_code text, maj_le timestamptz);
      insert into arche.pub_capex values ('CPX-APM-2026-01', 'APM', 'APM Industrie', 'Sud', 'Lyon', 'Ligne de conditionnement 3', 'en_cours', 'P3', now()),
        ('CPX-NEW-2026-05', 'NEW', 'Nouvelle filiale', 'Est', 'Metz', 'Atelier', 'cadrage', 'P1', now());`);
    try {
      expect(await syncCapex(db(), new Date('2026-11-05T09:00:00Z'))).toEqual({ status: 'ok', read: 2, added: 1, updated: 1, inactivated: 0 });
      const rows = await db().select().from(s.capex).orderBy(s.capex.code);
      expect(rows.map((c) => [c.code, c.name, c.phase, c.active])).toEqual([
        ['CPX-APM-2026-01', 'Ligne de conditionnement 3', 'P3', true],
        ['CPX-NEW-2026-05', 'Atelier', 'P1', true],
        ['CPX-OLD-2025-09', 'Ancien', null, false],
      ]);
      await db().$client.exec(`delete from arche.pub_capex where code = 'CPX-APM-2026-01'`);
      expect(await syncCapex(db())).toEqual({ status: 'ok', read: 1, added: 0, updated: 0, inactivated: 1 });
      expect((await db().select().from(s.capex).where(eq(s.capex.code, 'CPX-APM-2026-01')))[0].active).toBe(false);
    } finally {
      await db().$client.exec('drop schema arche cascade');
    }
  });
});

describe('CX-02: sub-types for the CAPEX pieces', () => {
  const subs = (code: string) => TYPES.find((x) => x.code === code)!.subtypes.map((x) => x.fr);
  it('are in the register, under the existing types Arche named', () => {
    expect(subs('GA')).toContain('Plan de masse');
    expect(subs('RSQ')).toEqual(expect.arrayContaining(['HazID', 'HazOp / AMDEC', 'Zonage ATEX (DRPCE)', 'PSSR / RSPDI', 'Audit ASPD']));
    expect(subs('AUT')).toEqual(expect.arrayContaining(['Dossier ICPE', 'Permis de construire / PLU']));
    expect(subs('FIN')).toContain('AFE (autorisation de dépense)');
    expect(subs('DEF')).toEqual(expect.arrayContaining(['Business case', 'Dossier d’investissement', 'Dossier de jalon G1', 'Dossier de jalon G2', 'Dossier de jalon G3']));
    expect(subs('REM')).toContain('PV de transfert d’actif');
    // capex next to project, and for FIN (an AFE belongs to a CAPEX).
    for (const x of TYPES) expect(x.attachments.includes('capex'), x.code).toBe(x.attachments.includes('project') || x.code === 'FIN');
  });

  it('are added to a database already filled by the migration 0003, once, keeping what the administration set', async () => {
    const sql = readFileSync(path.join(process.cwd(), 'drizzle', '0003_capex.sql'), 'utf8');
    const data = sql.slice(sql.indexOf('-- Données')).split('--> statement-breakpoint');
    await db().update(s.docTypes).set({ attachments: ['none', 'project'], subtypes: [{ fr: 'Charte projet', en: 'Charter' }] }).where(eq(s.docTypes.code, 'COR'));
    await db().insert(s.docTypes).values({ ...(await db().select().from(s.docTypes).where(eq(s.docTypes.code, 'PRO')))[0], code: 'DEF', attachments: ['project'], subtypes: [{ fr: 'Business case', en: 'Business case' }] });
    for (let i = 0; i < 2; i++) for (const q of data) await db().$client.exec(q);
    const [def] = await db().select().from(s.docTypes).where(eq(s.docTypes.code, 'DEF'));
    expect(def.attachments).toEqual(['project', 'capex']);
    expect(def.subtypes.map((x) => x.fr)).toEqual(['Business case', 'Dossier d’investissement', 'Dossier de jalon G1', 'Dossier de jalon G2', 'Dossier de jalon G3']);
    expect((await db().select().from(s.docTypes).where(eq(s.docTypes.code, 'COR')))[0].attachments).toEqual(['none', 'project', 'capex']);
    expect((await db().select().from(s.docTypes).where(eq(s.docTypes.code, 'PRO')))[0].attachments).toEqual(['none']);
  });
});

describe('CX-07: legal hold put at the deposit', () => {
  it('holds the document from its creation, journaled, without approving it; only a records manager lifts it', async () => {
    const r = await deposit({ ...META, attachment: 'capex', capexCode: 'CPX-APM-2026-01', legalHold: true });
    expect(r).toMatchObject({ status: 201, body: { id: 'PID-CPX-APM-2026-01-001', status: 'draft', legalHold: true } });
    const [d] = await db().select().from(s.documents);
    expect(d).toMatchObject({ legalHold: true, legalHoldAt: '2026-11-05', status: 'draft' });
    const journal = await db().select().from(s.auditLog).where(eq(s.auditLog.docId, d.id)).orderBy(s.auditLog.id);
    expect(journal.map((x) => [x.action, x.userId])).toEqual([['upload', 'codex'], ['hold', 'codex']]);
    // Frozen: its metadata cannot change while held.
    actAs('owner');
    expect(await updateMeta(form({ docId: d.id, version: (await viewOf(db(), d.id)).version, title: 'Autre' }))).toMatchObject({ ok: false });
    actAs('manager');
    expect(await releaseHold(d.id)).toMatchObject({ ok: true });
  });

  it('takes a boolean only, and a deposit without it is not held', async () => {
    expect(await deposit({ ...META, legalHold: 'oui', attachment: 'capex', capexCode: 'CPX-APM-2026-01' })).toMatchObject({ status: 400, body: { issues: [expect.objectContaining({ field: 'legalHold', code: 'invalid_type' })] } });
    expect(await deposit({ ...META, attachment: 'capex', capexCode: 'CPX-APM-2026-01' })).toMatchObject({ status: 201 });
    expect((await db().select().from(s.documents))[0].legalHold).toBe(false);
  });
});
