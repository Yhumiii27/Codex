import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { requestChange, simulateVigieDecision } from '@/lib/actions';
import { DICT } from '@/lib/i18n';
import { vigieConnected, vigieSimulated, vigieUrl } from '@/lib/vigie';
import { addDoc, fixClock, setupDb } from '../support/db';
import { actAs } from '../support/session';

// Vigie's request D12 (decision D-31): on the shared server, Codex creates a change or withdrawal request through
// Vigie's function vigie.pub_creer_demande_modification (M-17), in the transaction that mirrors it, and keeps the
// number Vigie gives; P0V01 / P0V02 mean the request was not sent, and nothing is kept. Without the function, Codex
// numbers the request and a records manager simulates the decision (the other tests).

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock();
const t = DICT.fr;
const ID = 'PRO-QUA-0001';

// A stand-in of Vigie's function, with its signature (Vigie, drizzle/0029_convergence_m02_ecr_eco.sql): it records each
// call and raises as Vigie does (P0V01 for an unknown caller, P0V02 for an invalid request).
const VIGIE = `create schema vigie;
  create table vigie.calls (id_externe text, nature text, document text, motif text, description text, demandeur_ref text,
    demandeur_nom text, demandeur_matricule text, remplacant text, enregistre_le timestamptz);
  create table vigie.refuse (code text);
  create sequence vigie.seq start 901;
  create function vigie.pub_creer_demande_modification(p_id_externe text, p_nature text, p_document text, p_motif text,
    p_description text, p_demandeur_ref text, p_demandeur_nom text, p_demandeur_matricule text, p_remplacant text,
    p_enregistre_le timestamptz) returns text language plpgsql as $$
  begin
    if exists (select 1 from vigie.refuse where code = 'P0V01') then raise exception 'appelant inconnu' using errcode = 'P0V01'; end if;
    if p_motif = 'invalide' then raise exception 'motif refusé par Vigie' using errcode = 'P0V02'; end if;
    insert into vigie.calls values (p_id_externe, p_nature, p_document, p_motif, p_description, p_demandeur_ref,
      p_demandeur_nom, p_demandeur_matricule, p_remplacant, p_enregistre_le);
    return 'ECR-2026-' || nextval('vigie.seq');
  end $$;`;

const calls = async () => (await db().$client.query<Record<string, unknown>>('select * from vigie.calls')).rows;
const mirrored = () => db().select().from(s.changeRequests);

// On PGlite only: under npm run test:pg the role has no CREATE on the database (as codex_app on the shared server).
describe.skipIf(!!process.env.CODEX_TEST_DATABASE_URL?.trim())('D12: requests created through vigie.pub_creer_demande_modification', () => {
  beforeEach(async () => {
    await db().$client.exec(VIGIE);
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force' }] });
    await addDoc(db(), { id: 'PRO-QUA-0002', revisions: [{ letter: 'A', status: 'in_force' }] });
    await db().update(s.users).set({ matricule: 'EMP-0042' }).where(eq(s.users.id, 'writer2'));
  });
  afterEach(async () => {
    await db().$client.exec('drop schema if exists vigie cascade');
  });

  it('sends the request to Vigie and keeps the number Vigie gives', async () => {
    expect(await vigieConnected(db())).toBe(true);
    actAs('writer2');
    expect(await requestChange(ID, 'modification', 'Écart de procédure', 'Détail')).toEqual({ ok: true, message: `${t.ecr_sent} : ECR-2026-901` });
    const [call] = await calls();
    expect(call).toMatchObject({
      nature: 'modification', document: ID, motif: 'Écart de procédure', description: 'Détail', demandeur_ref: 'writer2',
      demandeur_matricule: 'EMP-0042', remplacant: null,
    });
    expect(call.id_externe).toMatch(/^codex:[0-9a-f-]{36}$/);
    expect(call.demandeur_nom).toBeTruthy();
    expect(await mirrored()).toMatchObject([{ id: 'ECR-2026-901', docId: ID, requesterId: 'writer2', status: 'submitted', source: 'codex' }]);
    // A withdrawal proposing a replacement; the owner has no matricule.
    actAs('owner');
    expect(await requestChange('PRO-QUA-0002', 'obsolescence', 'Doublon', '', ID)).toEqual({ ok: true, message: `${t.ecr_sent} : ECR-2026-902` });
    expect((await calls())[1]).toMatchObject({ nature: 'obsolescence', remplacant: ID, demandeur_matricule: null });
  });

  it('keeps nothing when Vigie refuses the request (P0V02, P0V01) or gives a number Codex already has', async () => {
    actAs('writer2');
    expect(await requestChange(ID, 'modification', 'invalide', '')).toEqual({ ok: false, error: `${t.vigie_invalid} : motif refusé par Vigie` });
    await db().$client.exec(`insert into vigie.refuse values ('P0V01')`);
    expect(await requestChange(ID, 'modification', 'r', '')).toEqual({ ok: false, error: t.vigie_refused });
    expect(await mirrored()).toEqual([]);
    expect(await calls()).toEqual([]);
    const journal = await db().select().from(s.auditLog).where(eq(s.auditLog.targetId, ID));
    expect(journal.filter((e) => e.action === 'ecr')).toEqual([]);
    // A number of Codex's own, from before the link, that Vigie gives again: refused, Vigie's deposit undone with it.
    await db().$client.exec(`delete from vigie.refuse`);
    await db().insert(s.changeRequests).values({ id: 'ECR-2026-901', kind: 'modification', docId: 'PRO-QUA-0002', requesterId: 'owner', reason: 'r', status: 'rejected', createdAt: '2026-10-01 10:00:00' });
    expect(await requestChange(ID, 'modification', 'r', '')).toEqual({ ok: false, error: `${t.vigie_taken} : ECR-2026-901` });
    expect(await calls()).toEqual([]);
  });

  it('no longer simulates Vigie’s decision once the function is reachable', async () => {
    expect(await vigieSimulated(db())).toBe(false);
    actAs('writer2');
    await requestChange(ID, 'modification', 'r', '');
    actAs('manager');
    expect(await simulateVigieDecision('ECR-2026-901', false, null)).toEqual({ ok: false, error: t.vigie_only });
    await db().$client.exec('drop schema vigie cascade');
    expect(await vigieSimulated(db())).toBe(true);
  });
});

describe('D12: link to the request in Vigie', () => {
  it('opens /modifications-techniques/<ECR>', () => {
    vi.stubEnv('NEXT_PUBLIC_VIGIE_URL', 'https://vigie.example.org/');
    expect(vigieUrl('ECR-2026-004')).toBe('https://vigie.example.org/modifications-techniques/ECR-2026-004');
    vi.unstubAllEnvs();
  });
});
