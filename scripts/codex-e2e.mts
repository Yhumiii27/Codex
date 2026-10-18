// End-to-end paths through the application in Chromium (point 57 of docs/reste-a-faire.md), through the same buttons
// and dialogs a user clicks, as the screens show them. Five paths, independent of one another (each its own browser
// context and its own documents), on one throwaway demo database:
//
//   approbation  a document created with its file, its paged preview fetched once, sent for approval, approved step by
//                step by the people the circuit names, then in force;
//   rejet        a step rejected with its reason, then a new working version and a new approval request;
//   rappel       an approval request recalled by its requester: the circuit stops, the revision goes back to drafting;
//   vigie        a change asked to Vigie (simulated, D-16) on a document in force, accepted: the next revision opens for
//                the designated author; a second change accepted while that revision is drafted waits for it and is
//                grafted onto it from the record; a third one, while the revision is in review, can only wait (D-26);
//   import       POST /api/import with a token set for this server only: a simulation (?dryRun=1) predicts the ID, the
//                import gives it, the document is seen in the app; a draft imported is seen by its owner only.
//
// Each path also checks that someone outside the drafting circle (Léa Marchand, who may read the group's documents)
// does not see the draft (D-14): the record answers « no access » and the file route 404, or the record shows the
// revision in force alone.
//
//   npm run build && npm run e2e        production build (next start) on a throwaway demo database
//   npm run e2e -- --dev                next dev instead (no build; slower)
//   --port 3191                         port of the server started here
//   --only rejet,rappel                 some paths only (names above)
//   CODEX_E2E_SHOTS=<dossier>           screenshots of the steps worth seeing (the preview at page 3, a failure)
//
// The server and Chromium are started as for npm run a11y (scripts/codex-browser.mts): a demo database of its own in a
// temporary directory, removed at the end (never .data/), and an import token drawn for this run. The people are
// simulated through the session cookie, as the profile menu sets it; who holds each step is read on the screen
// (Validations), their identifier in the profile menu's list. Exit 1 when a path fails (the others still run), at its
// first step that does not give what the screens should show; exit 2 on a wrong usage or when the server cannot start.

import { randomBytes } from 'node:crypto';
import type { Browser, BrowserContext, Locator, Page } from 'playwright-core';
import { DICT } from '../src/lib/i18n';
import { launchChromium, serverLogTail, startServer, stopServer, waitHealthy } from './codex-browser.mjs';

const PATHS = ['approbation', 'rejet', 'rappel', 'vigie', 'import'] as const;
type PathName = (typeof PATHS)[number];

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DEV = args.includes('--dev');
const PORT = Number(opt('--port') ?? 3191);
const ONLY = opt('--only')?.split(',').map((x) => x.trim()).filter(Boolean) ?? [...PATHS];
const VALUED = ['--port', '--only'];
if (
  !Number.isInteger(PORT)
  || args.some((a, i) => a.startsWith('--') && !['--dev', ...VALUED].includes(a) && !VALUED.includes(args[i - 1]))
  || ONLY.some((p) => !(PATHS as readonly string[]).includes(p))
) {
  console.error(`npm run e2e [-- --dev] [--port N] [--only ${PATHS.join(',')}]`);
  process.exit(2);
}

const t = DICT.fr;
const TIMEOUT = 60_000;
/** Import token of this run's server only (CODEX_IMPORT_TOKEN): 43 random characters, never written anywhere. */
const IMPORT_TOKEN = randomBytes(32).toString('base64url');
/** Reads the group's documents (collaboratrice, PRJ), owns none of these, approves none of their circuits. */
const OUTSIDER = 'lmarchand';

/** A PDF of `n` pages, each saying its number: what the user uploads. */
export function pdfWithPages(n: number, note = ''): Buffer {
  const objs: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids: string[] = [];
  for (let i = 0; i < n; i++) {
    const content = `BT /F1 48 Tf 100 600 Td (Page ${i + 1}${note ? ` ${note}` : ''}) Tj ET`;
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${objs.length} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    kids.push(`${objs.length} 0 R`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${n} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

class Failed extends Error {}
function check(ok: unknown, what: string): asserts ok {
  if (!ok) throw new Failed(what);
}

/** One path being run: its browser context and page, the steps it passed, the JavaScript errors of its page. */
type Run = { name: PathName; base: string; ctx: BrowserContext; page: Page; who: Map<string, string>; steps: string[]; errors: string[] };

function done(r: Run, what: string) {
  r.steps.push(what);
  console.log(`  ✓ [${r.name}] ${what}`);
}

/** Opens `url`, waits for the page to settle; returns the HTTP status. */
async function visit(page: Page, url: string): Promise<number> {
  const res = await page.goto(url, { waitUntil: 'networkidle', timeout: TIMEOUT });
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: TIMEOUT });
  return res?.status() ?? 0;
}

async function open(page: Page, url: string) {
  const status = await visit(page, url);
  check(status === 200, `${url} : HTTP ${status}`);
}

const mainText = (page: Page) => page.locator('main').innerText();
const record = (r: Run, docId: string, tab?: string) => `${r.base}/documents/${encodeURIComponent(docId)}${tab ? `?tab=${tab}` : ''}`;

/** Acts as the person `userId` with their default role, as the profile menu does (cookies codex-user, codex-role). */
async function actAs(r: Run, userId: string) {
  await r.ctx.clearCookies({ name: 'codex-role' });
  await r.ctx.addCookies([{ name: 'codex-user', value: userId, url: r.base }]);
}

/** The people of the profile menu: name → identifier (the list the menu offers). */
async function people(page: Page, base: string): Promise<Map<string, string>> {
  await open(page, `${base}/`);
  await page.getByRole('button', { name: /Claire Bardet/ }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: TIMEOUT });
  const options = await dialog.locator('select').first().locator('option').evaluateAll((os) => os.map((o) => [o.textContent ?? '', (o as HTMLOptionElement).value] as [string, string]));
  await page.keyboard.press('Escape');
  return new Map(options);
}

/** Opens the dialog of the button named `name` (the first one on the page). */
async function dialogOf(page: Page, name: string): Promise<Locator> {
  const button = page.getByRole('button', { name, exact: true }).first();
  check(await button.count(), `bouton « ${name} » absent`);
  check(await button.isEnabled(), `bouton « ${name} » désactivé : ${await button.getAttribute('title')}`);
  await button.click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: TIMEOUT });
  return dialog;
}

/** Clicks the dialog's button `name`; fails with the dialog's error line when it does not close. */
async function submit(page: Page, dialog: Locator, name: string) {
  await dialog.getByRole('button', { name, exact: true }).click();
  const closed = dialog.waitFor({ state: 'detached', timeout: TIMEOUT }).then(() => null);
  const error = dialog.getByRole('alert').waitFor({ timeout: TIMEOUT }).then(async () => dialog.getByRole('alert').innerText()).catch(() => null);
  const refused = await Promise.race([closed, error]);
  check(!refused, `« ${name} » refusé : ${refused}`);
  await page.waitForLoadState('networkidle', { timeout: TIMEOUT });
}

/** Creates a document with its file as `userId` (« Déposer un fichier » on the home screen); returns its ID. */
async function createDoc(r: Run, userId: string, title: string): Promise<string> {
  const { page } = r;
  await actAs(r, userId);
  await open(page, `${r.base}/`);
  await page.getByRole('button', { name: t.upload, exact: true }).first().click();
  const create = page.getByRole('dialog');
  await create.waitFor({ timeout: TIMEOUT });
  await create.getByText(t.from_file, { exact: true }).click();
  await create.locator('input[type="file"]').setInputFiles({ name: 'essai-e2e.pdf', mimeType: 'application/pdf', buffer: pdfWithPages(3) });
  await create.locator('input[name="title"]').fill(title);
  await create.getByLabel(t.family, { exact: true }).selectOption('gouvernance_management');
  await create.getByLabel(t.type, { exact: true }).selectOption('PRO');
  await Promise.all([
    page.waitForURL(/\/documents\/[^/?]+/, { timeout: TIMEOUT }),
    create.getByRole('button', { name: t.create_doc }).click(),
  ]);
  const docId = decodeURIComponent(new URL(page.url()).pathname.split('/')[2]);
  check(/^PRO-[A-Z]{3}-\d{4}$/.test(docId), `identifiant attribué inattendu : ${docId}`);
  return docId;
}

/** Sends the draft shown on the record for approval (« Demander la validation »); returns the circuit's ID. */
async function askValidation(r: Run, docId: string): Promise<string> {
  const { page } = r;
  await open(page, record(r, docId));
  const ask = await dialogOf(page, t.request_validation);
  await Promise.all([
    page.waitForURL(/\/validations\?.*r=/, { timeout: TIMEOUT }),
    ask.getByRole('button', { name: t.request_validation, exact: true }).click(),
  ]);
  const wf = new URL(page.url()).searchParams.get('r')!;
  check(/^W-/.test(wf), `circuit inattendu : ${wf}`);
  return wf;
}

/** Who holds the current step of circuit `wf`, as a records manager reads it in Validations: [name, id], or null. */
async function holderOf(r: Run, wf: string): Promise<[string, string] | null> {
  await actAs(r, 'cbardet');
  await open(r.page, `${r.base}/validations?r=${encodeURIComponent(wf)}`);
  const holder = await r.page.evaluate((current) => {
    const lines = [...document.querySelectorAll('section div.text-muted')];
    const line = lines.find((x) => x.textContent?.trim() === current);
    return line?.previousElementSibling?.textContent?.trim() ?? null;
  }, t.st_current);
  if (!holder) return null;
  const id = r.who.get(holder);
  check(id, `titulaire de l’étape introuvable dans le menu du profil : ${holder}`);
  return [holder, id];
}

/** Uploads a new working version of the draft from its record (« Nouvelle version de travail »), as `userId`. */
async function uploadVersion(r: Run, userId: string, docId: string, note: string) {
  await actAs(r, userId);
  await open(r.page, record(r, docId));
  const dialog = await dialogOf(r.page, t.new_working_version);
  await dialog.locator('input[type="file"]').setInputFiles({ name: `essai-e2e-${note}.pdf`, mimeType: 'application/pdf', buffer: pdfWithPages(2, note) });
  await submit(r.page, dialog, t.upload);
}

/** D-14: someone outside the drafting circle gets « no access » on the record of a draft, and 404 on its file. */
async function draftHidden(r: Run, docId: string, title: string, userId = OUTSIDER) {
  await actAs(r, userId);
  await open(r.page, record(r, docId));
  const text = await mainText(r.page);
  check(text.includes(t.no_access) && !text.includes(title), `${userId} voit la fiche du brouillon ${docId}`);
  const file = await r.ctx.request.get(`${r.base}/api/documents/${encodeURIComponent(docId)}/file`);
  check(file.status() === 404, `${userId} : fichier du brouillon ${docId} servi (HTTP ${file.status()})`);
}

/** Calls POST /api/import as the migration tool does: metadata and file in multipart, the run's token. */
async function importApi(r: Run, meta: Record<string, unknown>, file: Buffer | null, dryRun = false) {
  const fd = new FormData();
  fd.set('meta', JSON.stringify(meta));
  if (file) fd.set('file', new Blob([new Uint8Array(file)], { type: 'application/pdf' }), `${meta.legacyRef}.pdf`);
  const res = await fetch(`${r.base}/api/import${dryRun ? '?dryRun=1' : ''}`, { method: 'POST', headers: { Authorization: `Bearer ${IMPORT_TOKEN}` }, body: fd });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const stamp = () => new Date().toISOString().slice(0, 19);

// ── The paths ───────────────────────────────────────────────────────────

/** Created with its file, preview paged, sent for approval, approved step by step, in force. */
async function approbation(r: Run) {
  const { page } = r;
  const title = `Essai de bout en bout ${stamp()}`;
  const docId = await createDoc(r, 'cbardet', title);
  await open(page, record(r, docId));
  check((await mainText(page)).includes(title), 'la fiche ne montre pas le titre');
  check(await page.locator('iframe').count(), 'l’aperçu du PDF déposé est absent');
  done(r, `création de ${docId} avec son fichier PDF (3 pages), aperçu affiché`);

  // Paging through the preview of the draft (point 46): the file, served no-store (D-14), is fetched once, not again
  // at each page.
  const fetched: number[] = [];
  const onFile = (res: import('playwright-core').Response) => {
    if (res.url().includes('/file') && res.request().method() === 'GET') fetched.push(Number(res.headers()['content-length'] ?? 0));
  };
  page.on('response', onFile);
  await open(page, record(r, docId));
  await page.locator('iframe').first().waitFor({ timeout: TIMEOUT });
  for (let p = 2; p <= 3; p++) {
    await page.getByRole('button', { name: t.next_page, exact: true }).click();
    await page.getByText(`${t.page} ${p} ${t.of} 3`, { exact: true }).waitFor({ timeout: TIMEOUT });
    await page.waitForTimeout(500);
  }
  page.off('response', onFile);
  if (process.env.CODEX_E2E_SHOTS) await page.screenshot({ path: `${process.env.CODEX_E2E_SHOTS}/apercu-page-3.png` });
  const bytes = fetched.reduce((a, b) => a + b, 0);
  console.log(`    aperçu du brouillon, pages 1 à 3 : ${fetched.length} téléchargement(s) du fichier, ${bytes} octets`);
  check(fetched.length === 1, `l’aperçu paginé a téléchargé le fichier ${fetched.length} fois pour 3 pages`);
  done(r, 'aperçu paginé du brouillon : fichier téléchargé une fois pour trois pages');

  const wf = await askValidation(r, docId);
  done(r, `demande de validation : circuit ${wf}`);
  await draftHidden(r, docId, title);
  done(r, `brouillon en circuit invisible hors du cercle de rédaction (${OUTSIDER} : pas d’accès, fichier 404)`);

  // Each step approved by the person who holds it, read on the screen.
  for (let n = 0; n < 6; n++) {
    const holder = await holderOf(r, wf);
    if (!holder) break;
    const [name, id] = holder;
    await actAs(r, id);
    await open(page, `${r.base}/validations?f=mine&r=${encodeURIComponent(wf)}`);
    const approve = page.getByRole('button', { name: t.approve, exact: true });
    check(await approve.count(), `${name} ne voit pas « ${t.approve} »`);
    await approve.first().click();
    await page.waitForLoadState('networkidle', { timeout: TIMEOUT });
    await page.getByRole('button', { name: t.approve, exact: true }).waitFor({ state: 'detached', timeout: TIMEOUT });
    done(r, `étape ${n + 1} approuvée par ${name} (${id})`);
  }

  // In force: the record says so, and its owner's circuit is over; every reader sees it now.
  await actAs(r, 'cbardet');
  await open(page, record(r, docId));
  const text = await mainText(page);
  check(text.includes(t.st_in_force) && !text.includes(t.no_rev_in_force), `la fiche ne montre pas « ${t.st_in_force} »`);
  await open(page, `${r.base}/validations?f=done&r=${encodeURIComponent(wf)}`);
  check((await mainText(page)).includes(t.wf_approved), `le circuit ne se dit pas « ${t.wf_approved} »`);
  await actAs(r, OUTSIDER);
  await open(page, record(r, docId));
  check((await mainText(page)).includes(title), `${OUTSIDER} ne voit pas le document en vigueur`);
  done(r, `${docId} en vigueur (révision A), circuit « ${t.wf_approved} », visible de ${OUTSIDER}`);
}

/** A step rejected with its reason; a new working version, then a new approval request. */
async function rejet(r: Run) {
  const { page } = r;
  const title = `Essai de rejet ${stamp()}`;
  const docId = await createDoc(r, 'cbardet', title);
  const wf = await askValidation(r, docId);
  done(r, `création de ${docId} (A.1), demande de validation : circuit ${wf}`);

  const holder = await holderOf(r, wf);
  check(holder, `aucune étape en cours dans ${wf}`);
  const [name, id] = holder;
  await actAs(r, id);
  await open(page, `${r.base}/validations?f=mine&r=${encodeURIComponent(wf)}`);
  const reason = `Références normatives à mettre à jour (${stamp()})`;
  const reject = await dialogOf(page, t.reject);
  // The reason is required: the dialog does not send the step without it.
  check(await reject.locator('textarea[name="reason"]').evaluate((x) => (x as HTMLTextAreaElement).required), 'le motif du rejet n’est pas obligatoire');
  await reject.locator('textarea[name="reason"]').fill(reason);
  await submit(page, reject, t.reject);
  done(r, `étape rejetée par ${name} (${id}) avec son motif`);

  // Back to drafting: the record of its owner tells who rejected it and why, and offers a new request.
  await actAs(r, 'cbardet');
  await open(page, record(r, docId, 'approval'));
  let text = await mainText(page);
  check(text.includes(t.wf_rejected) && text.includes(reason) && text.includes(name), 'la fiche ne montre pas le rejet, son auteur et son motif');
  check(await page.getByRole('button', { name: t.request_validation, exact: true }).count(), 'la révision n’est pas revenue en rédaction');
  await open(page, `${r.base}/validations?f=done&r=${encodeURIComponent(wf)}`);
  text = await mainText(page);
  check(text.includes(t.wf_rejected) && text.includes(reason), `le circuit ne se dit pas « ${t.wf_rejected} » avec son motif`);
  done(r, `révision revenue en rédaction, circuit « ${t.wf_rejected} », motif sur la fiche et dans le circuit`);

  await draftHidden(r, docId, title);
  done(r, `brouillon rejeté invisible hors du cercle de rédaction (${OUTSIDER})`);

  await uploadVersion(r, 'cbardet', docId, 'corrige');
  await open(page, record(r, docId, 'versions'));
  check((await mainText(page)).includes('A.2'), 'la version de travail A.2 n’apparaît pas');
  done(r, 'nouvelle version de travail A.2 déposée');

  const wf2 = await askValidation(r, docId);
  check(wf2 !== wf, `nouvelle demande : même circuit ${wf2}`);
  const next = await holderOf(r, wf2);
  check(next, `aucune étape en cours dans ${wf2}`);
  done(r, `nouvelle demande de validation : circuit ${wf2}, étape tenue par ${next[0]}`);
  await draftHidden(r, docId, title);
  done(r, `brouillon de nouveau en circuit, toujours invisible de ${OUTSIDER}`);
}

/** An approval request recalled by its requester. */
async function rappel(r: Run) {
  const { page } = r;
  const title = `Essai de rappel ${stamp()}`;
  // The requester is not a records manager: a drafter of the engineering department.
  const docId = await createDoc(r, 'jwagner', title);
  const wf = await askValidation(r, docId);
  const holder = await holderOf(r, wf);
  check(holder, `aucune étape en cours dans ${wf}`);
  done(r, `création de ${docId} par Julien Wagner (jwagner), demande de validation : circuit ${wf}, étape tenue par ${holder[0]}`);

  await actAs(r, 'jwagner');
  await open(page, record(r, docId, 'approval'));
  const reason = `Pièce jointe oubliée (${stamp()})`;
  const recall = await dialogOf(page, t.recall);
  await recall.locator('textarea[name="reason"]').fill(reason);
  await submit(page, recall, t.recall);
  await open(page, record(r, docId, 'approval'));
  const text = await mainText(page);
  check(text.includes(t.wf_recalled) && text.includes(reason), `la fiche ne montre pas le circuit « ${t.wf_recalled} » et son motif`);
  check(await page.getByRole('button', { name: t.request_validation, exact: true }).count(), 'la révision n’est pas revenue en rédaction');
  done(r, `demande rappelée par jwagner : circuit « ${t.wf_recalled} », motif sur la fiche, révision revenue en rédaction`);

  // The holder of the step no longer has it to decide.
  await actAs(r, holder[1]);
  await open(page, `${r.base}/validations?f=mine`);
  check(!(await mainText(page)).includes(docId), `${holder[0]} a encore ${docId} à valider`);
  done(r, `${holder[0]} n’a plus l’étape à décider`);

  await draftHidden(r, docId, title);
  done(r, `brouillon rappelé invisible hors du cercle de rédaction (${OUTSIDER})`);
}

/** A change asked to Vigie, accepted; a second one grafted onto the revision being drafted; a third one waiting. */
async function vigie(r: Run) {
  const { page } = r;
  const title = `Essai Vigie ${stamp()}`;
  // A procedure in force to start from, owned by Julien Wagner: imported (the shortest way to a revision in force).
  const legacyRef = `E2E-VIGIE-${Date.now()}`;
  const imported = await importApi(r, { legacyRef, title, typeCode: 'PRO', department: 'ING', ownerId: 'jwagner', revision: 'A' }, pdfWithPages(1));
  check(imported.status === 201, `préparation : import refusé (HTTP ${imported.status} ${JSON.stringify(imported.body)})`);
  const docId = String(imported.body.id);
  done(r, `préparation : ${docId} en vigueur (révision A), propriétaire jwagner`);

  const ask = async (who: string, why: string) => {
    await actAs(r, who);
    await open(page, record(r, docId));
    const dialog = await dialogOf(page, t.request_change);
    await dialog.locator('input[name="reason"]').fill(why);
    await dialog.locator('textarea[name="description"]').fill('Parcours de bout en bout.');
    await submit(page, dialog, t.send);
  };
  /** Vigie's acceptance of the request still « Transmise à Vigie », simulated by a records manager; returns its ID. */
  const accept = async () => {
    await actAs(r, 'cbardet');
    await open(page, record(r, docId, 'requests'));
    const dialog = await dialogOf(page, t.vigie_sim);
    const id = (await dialog.innerText()).match(/ECR-\d{4}-\d+/)?.[0];
    check(id, 'simulation Vigie : demande sans référence');
    check(await dialog.locator('select').first().inputValue() === 'jwagner', 'simulation Vigie : jwagner n’est pas le modificateur proposé');
    await submit(page, dialog, t.vigie_accept);
    return id;
  };

  await ask('jwagner', 'Mise à jour du schéma de principe');
  const ecr1 = await accept();
  await actAs(r, 'jwagner');
  await open(page, record(r, docId, 'requests'));
  let text = await mainText(page);
  check(text.includes(ecr1) && text.includes(`${t.change_opened} B`) && text.includes(t.ecr_implemented), `${ecr1} n’a pas ouvert la révision B`);
  check(text.includes(`${t.rev_short} B ${t.in_progress}`), 'la fiche de jwagner ne montre pas la révision B en cours');
  done(r, `${ecr1} demandée par jwagner, acceptée (simulation Vigie) : révision B ouverte en brouillon pour jwagner`);

  // D-14: the revision in force for the others, nothing of B.
  const outsiderSeesOnlyA = async (what: string) => {
    await actAs(r, OUTSIDER);
    await open(page, record(r, docId, 'versions'));
    const seen = await mainText(page);
    check(seen.includes(title) && seen.includes(t.st_in_force), `${OUTSIDER} ne voit pas la révision A en vigueur (${what})`);
    check(!/\bB(\.\d+)?\b/.test(seen) && !seen.includes(`${t.rev_short} B`), `${OUTSIDER} voit la révision B (${what})`);
    await open(page, record(r, docId, 'requests'));
    const requests = await mainText(page);
    check(!requests.includes(`${t.change_opened} B`) && !requests.includes(`${t.change_grafted_on} B`) && !requests.includes(t.graft_on), `${OUTSIDER} voit dans les demandes la révision B (${what})`);
  };
  await outsiderSeesOnlyA('après ouverture');
  done(r, `${OUTSIDER} voit la révision A en vigueur, rien de la révision B`);

  // D-26: a change accepted while B is drafted waits for it, or is grafted onto it from the record.
  await ask('jwagner', 'Ajout d’un contrôle de recette');
  const ecr2 = await accept();
  await actAs(r, 'jwagner');
  await open(page, record(r, docId));
  text = await mainText(page);
  check(text.includes(`${t.ecr_accepted_l} :`) && text.includes(`${t.graft_on} B`), `${ecr2} acceptée : ni attente ni greffe proposée sur la fiche`);
  done(r, `${ecr2} acceptée pendant la rédaction de B : en attente, greffe proposée sur la fiche (D-26)`);
  await outsiderSeesOnlyA('modification en attente');
  done(r, `${OUTSIDER} ne voit ni l’attente sur B ni la greffe proposée`);

  await actAs(r, 'jwagner');
  await open(page, record(r, docId));
  const graft = await dialogOf(page, `${t.graft_on} B`);
  await submit(page, graft, t.graft_confirm);
  await open(page, record(r, docId, 'requests'));
  text = await mainText(page);
  check(text.includes(`${t.change_grafted_on} B`), `${ecr2} n’est pas greffée sur B`);
  check(!(await page.getByRole('button', { name: `${t.graft_on} B`, exact: true }).count()), 'greffe encore proposée après la greffe');
  done(r, `${ecr2} greffée sur la révision B par jwagner`);
  await outsiderSeesOnlyA('après la greffe');
  done(r, `${OUTSIDER} ne voit toujours rien de la révision B`);

  // In review, B can no longer take a change: the third one only waits.
  await uploadVersion(r, 'jwagner', docId, 'B');
  const wf = await askValidation(r, docId);
  await ask('jwagner', 'Correction d’une coquille');
  const ecr3 = await accept();
  await actAs(r, 'jwagner');
  await open(page, record(r, docId));
  text = await mainText(page);
  check(text.includes(`${t.ecr_accepted_l} :`) && text.includes(`${t.revision} B ${t.graft_closed_review}`), `${ecr3} : l’attente de la révision B en validation n’est pas dite`);
  check(!(await page.getByRole('button', { name: `${t.graft_on} B`, exact: true }).count()), 'greffe proposée sur une révision en validation');
  done(r, `B.1 déposée, circuit ${wf} ; ${ecr3} acceptée : en attente seulement, pas de greffe sur une révision en validation`);
  await outsiderSeesOnlyA('révision B en validation');
  done(r, `${OUTSIDER} ne voit toujours que la révision A`);
}

/** Import through the API: simulated, then real; the document seen in the app; a draft seen by its owner only. */
async function importPath(r: Run) {
  const { page } = r;
  const n = Date.now();
  const title = `Procédure reprise ${stamp()}`;
  const meta = { legacyRef: `GED1/E2E/${n}`, title, typeCode: 'PRO', department: 'QUA', ownerId: 'gcomte', revision: 'C', inForceAt: '2025-03-12', keywords: ['Reprise'] };
  const file = pdfWithPages(2, 'reprise');

  const sim = await importApi(r, meta, file, true);
  check(sim.status === 200 && sim.body.dryRun === true && /^PRO-QUA-\d{4}$/.test(String(sim.body.id)), `simulation : HTTP ${sim.status} ${JSON.stringify(sim.body)}`);
  const predicted = String(sim.body.id);
  await actAs(r, 'cbardet');
  check(await visit(page, record(r, predicted)) === 404, `simulation : ${predicted} existe après la simulation`);
  done(r, `simulation (?dryRun=1) : identifiant prévu ${predicted}, rien créé`);

  const imp = await importApi(r, meta, file);
  check(imp.status === 201 && imp.body.id === predicted && imp.body.status === 'in_force' && imp.body.file === true, `import : HTTP ${imp.status} ${JSON.stringify(imp.body)}`);
  done(r, `import : ${predicted} créé (révision C en vigueur, avec son fichier), l’identifiant prévu`);

  for (const who of ['cbardet', OUTSIDER]) {
    await actAs(r, who);
    await open(page, record(r, predicted));
    const text = await mainText(page);
    check(text.includes(title) && text.includes(t.st_in_force), `${who} ne voit pas ${predicted} en vigueur`);
    check(await page.locator('iframe').count(), `${who} : aperçu du fichier importé absent`);
  }
  await open(page, record(r, meta.legacyRef));
  check(new URL(page.url()).pathname === `/documents/${encodeURIComponent(predicted)}`, `l’ancienne référence ${meta.legacyRef} ne mène pas à ${predicted}`);
  done(r, `${predicted} vu en vigueur avec son aperçu par cbardet et ${OUTSIDER} ; l’ancienne référence y mène`);

  const replay = await importApi(r, meta, file);
  check(replay.status === 409 && replay.body.error === 'duplicate' && replay.body.id === predicted, `rejeu : HTTP ${replay.status} ${JSON.stringify(replay.body)}`);
  done(r, `rejeu : 409 duplicate → ${predicted}`);

  const draftTitle = `Brouillon repris ${stamp()}`;
  const draft = await importApi(r, { legacyRef: `GED1/E2E/${n}-BR`, title: draftTitle, typeCode: 'PRO', department: 'ING', ownerId: 'jwagner', status: 'draft' }, file);
  check(draft.status === 201 && draft.body.status === 'draft', `import d’un brouillon : HTTP ${draft.status} ${JSON.stringify(draft.body)}`);
  const draftId = String(draft.body.id);
  await actAs(r, 'jwagner');
  await open(page, record(r, draftId));
  check((await mainText(page)).includes(draftTitle), `jwagner ne voit pas son brouillon importé ${draftId}`);
  await draftHidden(r, draftId, draftTitle);
  done(r, `brouillon importé ${draftId} : vu par son propriétaire, invisible de ${OUTSIDER} (pas d’accès, fichier 404)`);
}

const RUNNERS: Record<PathName, (r: Run) => Promise<void>> = { approbation, rejet, rappel, vigie, import: importPath };

/** Runs one path in a browser context of its own; returns its outcome. */
async function runPath(browser: Browser, base: string, who: Map<string, string>, name: PathName) {
  const t0 = Date.now();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: 'codex-lang', value: 'fr', url: base }]);
  const page = await ctx.newPage();
  const r: Run = { name, base, ctx, page, who, steps: [], errors: [] };
  page.on('pageerror', (e) => r.errors.push(e.message));
  let error: string | null = null;
  try {
    await RUNNERS[name](r);
    check(!r.errors.length, `erreurs JavaScript : ${r.errors.join(' ; ')}`);
  } catch (err) {
    error = err instanceof Failed ? err.message : err instanceof Error ? err.stack ?? err.message : String(err);
    console.error(`  ✗ [${name}] ${error}`);
    if (process.env.CODEX_E2E_SHOTS) await page.screenshot({ path: `${process.env.CODEX_E2E_SHOTS}/echec-${name}.png`, fullPage: true }).catch(() => {});
  } finally {
    await ctx.close();
  }
  return { name, steps: r.steps.length, seconds: (Date.now() - t0) / 1000, error };
}

async function main() {
  const t0 = Date.now();
  const server = startServer({ port: PORT, dev: DEV, prefix: 'codex-e2e', command: 'e2e', env: { CODEX_IMPORT_TOKEN: IMPORT_TOKEN, CODEX_IMPORT_SECRET: '' } });
  try {
    if (!(await waitHealthy(server.base, server.child))) {
      console.error(`npm run e2e : le serveur ne répond pas sur ${server.base} (journal : ${server.log}).`);
      console.error(serverLogTail(server));
      process.exitCode = 2;
      return;
    }
    console.log(`Parcours de bout en bout sur ${server.base} (base de démonstration jetable), démarrage en ${((Date.now() - t0) / 1000).toFixed(0)} s :`);
    const browser = await launchChromium();
    const results = [];
    try {
      const ctx = await browser.newContext();
      await ctx.addCookies([{ name: 'codex-lang', value: 'fr', url: server.base }]);
      const who = await people(await ctx.newPage(), server.base);
      await ctx.close();
      check(who.get('Claire Bardet') === 'cbardet', 'menu du profil : Claire Bardet absente');
      for (const name of PATHS.filter((p) => ONLY.includes(p))) results.push(await runPath(browser, server.base, who, name));
    } finally {
      await browser.close();
    }
    console.log('');
    for (const x of results) console.log(`${x.error ? '✗' : '✓'} ${x.name.padEnd(12)} ${String(x.steps).padStart(2)} étapes  ${x.seconds.toFixed(1).padStart(5)} s${x.error ? '  (échec)' : ''}`);
    const failed = results.filter((x) => x.error);
    console.log(`\n${results.length - failed.length}/${results.length} parcours réussis, ${results.reduce((a, x) => a + x.steps, 0)} étapes, en ${((Date.now() - t0) / 1000).toFixed(0)} s au total.`);
    if (failed.length) {
      console.error(`(journal du serveur :)\n${serverLogTail(server, 15)}`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`\n✗ ${err instanceof Failed ? err.message : err instanceof Error ? err.stack ?? err.message : String(err)}`);
    console.error(`(journal du serveur :)\n${serverLogTail(server, 15)}`);
    process.exitCode = 1;
  } finally {
    await stopServer(server);
  }
}

await main();
