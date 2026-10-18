// End-to-end path through the application in Chromium (point 57 of docs/reste-a-faire.md): a document created with
// its file, sent for approval, approved step by step by the people the circuit names, then in force, as the screens
// show it, through the same buttons and dialogs a user clicks.
//
//   npm run build && npm run e2e        production build (next start) on a throwaway demo database
//   npm run e2e -- --dev                next dev instead (no build; slower)
//   --port 3191                         port of the server started here
//   CODEX_E2E_SHOTS=<dossier>           screenshots of the steps worth seeing (the preview at page 3)
//
// The server and Chromium are started as for npm run a11y (scripts/codex-browser.mts): a demo database of its own in
// a temporary directory, removed at the end (never .data/). The people are simulated through the session cookie, as
// the profile menu sets it; who holds each step is read on the screen (Validations), their identifier in the profile
// menu's list. Fails (exit 1) at the first step that does not give what the screens should show; exit 2 on a wrong
// usage or when the server cannot start.

import type { BrowserContext, Page } from 'playwright-core';
import { DICT } from '../src/lib/i18n';
import { launchChromium, serverLogTail, startServer, stopServer, waitHealthy } from './codex-browser.mjs';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DEV = args.includes('--dev');
const PORT = Number(opt('--port') ?? 3191);
if (!Number.isInteger(PORT) || args.some((a, i) => a.startsWith('--') && !['--dev', '--port'].includes(a) && args[i - 1] !== '--port')) {
  console.error('npm run e2e [-- --dev] [--port N]');
  process.exit(2);
}

const t = DICT.fr;
const TIMEOUT = 60_000;

/** A PDF of `n` pages, each saying its number: what the user uploads. */
export function pdfWithPages(n: number): Buffer {
  const objs: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids: string[] = [];
  for (let i = 0; i < n; i++) {
    const content = `BT /F1 48 Tf 100 600 Td (Page ${i + 1}) Tj ET`;
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
const steps: string[] = [];
function check(ok: unknown, what: string): asserts ok {
  if (!ok) throw new Failed(what);
}
function done(what: string) {
  steps.push(what);
  console.log(`  ✓ ${what}`);
}

async function open(page: Page, url: string) {
  const res = await page.goto(url, { waitUntil: 'networkidle', timeout: TIMEOUT });
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: TIMEOUT });
  check(res?.status() === 200, `${url} : HTTP ${res?.status()}`);
}

/** Acts as the person `userId` with their default role, as the profile menu does (cookies codex-user, codex-role). */
async function actAs(ctx: BrowserContext, base: string, userId: string) {
  await ctx.clearCookies({ name: 'codex-role' });
  await ctx.addCookies([{ name: 'codex-user', value: userId, url: base }]);
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

async function run(base: string) {
  const browser = await launchChromium();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addCookies([{ name: 'codex-lang', value: 'fr', url: base }]);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const who = await people(page, base);
    check(who.get('Claire Bardet') === 'cbardet', 'menu du profil : Claire Bardet absente');
    await actAs(ctx, base, 'cbardet');

    // 1. Create a document with its file (« Déposer un fichier » on the home screen).
    const title = `Essai de bout en bout ${new Date().toISOString().slice(0, 19)}`;
    await open(page, `${base}/`);
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
    await open(page, `${base}/documents/${encodeURIComponent(docId)}`);
    check((await page.locator('main').innerText()).includes(title), 'la fiche ne montre pas le titre');
    check(await page.locator('iframe').count(), 'l’aperçu du PDF déposé est absent');
    done(`création de ${docId} avec son fichier PDF (3 pages), aperçu affiché`);

    // Paging through the preview of the draft (point 46): the file, served no-store (D-14), is fetched once, not again
    // at each page.
    const fetched: number[] = [];
    const onFile = (r: import('playwright-core').Response) => {
      if (r.url().includes('/file') && r.request().method() === 'GET') fetched.push(Number(r.headers()['content-length'] ?? 0));
    };
    page.on('response', onFile);
    await open(page, `${base}/documents/${encodeURIComponent(docId)}`);
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
    done('aperçu paginé du brouillon : fichier téléchargé une fois pour trois pages');

    // 2. Ask for approval.
    await page.getByRole('button', { name: t.request_validation, exact: true }).first().click();
    const ask = page.getByRole('dialog');
    await ask.waitFor({ timeout: TIMEOUT });
    await Promise.all([
      page.waitForURL(/\/validations\?.*r=/, { timeout: TIMEOUT }),
      ask.getByRole('button', { name: t.request_validation, exact: true }).click(),
    ]);
    const wf = new URL(page.url()).searchParams.get('r')!;
    check(/^W-/.test(wf), `circuit inattendu : ${wf}`);
    done(`demande de validation : circuit ${wf}`);

    // 3. Each step approved by the person who holds it, read on the screen.
    for (let n = 0; n < 6; n++) {
      await actAs(ctx, base, 'cbardet');
      await open(page, `${base}/validations?r=${encodeURIComponent(wf)}`);
      const holder = await page.evaluate((current) => {
        const lines = [...document.querySelectorAll('section div.text-muted')];
        const line = lines.find((x) => x.textContent?.trim() === current);
        return line?.previousElementSibling?.textContent?.trim() ?? null;
      }, t.st_current);
      if (!holder) break;
      const id = who.get(holder);
      check(id, `titulaire de l’étape introuvable dans le menu du profil : ${holder}`);
      await actAs(ctx, base, id);
      await open(page, `${base}/validations?f=mine&r=${encodeURIComponent(wf)}`);
      const approve = page.getByRole('button', { name: t.approve, exact: true });
      check(await approve.count(), `${holder} ne voit pas « ${t.approve} »`);
      await approve.first().click();
      await page.waitForLoadState('networkidle', { timeout: TIMEOUT });
      await page.getByRole('button', { name: t.approve, exact: true }).waitFor({ state: 'detached', timeout: TIMEOUT });
      done(`étape ${n + 1} approuvée par ${holder} (${id})`);
    }

    // 4. In force: the record says so, and its owner's circuit is over.
    await actAs(ctx, base, 'cbardet');
    await open(page, `${base}/documents/${encodeURIComponent(docId)}`);
    const record = await page.locator('main').innerText();
    check(record.includes(t.st_in_force) && !record.includes(t.no_rev_in_force), `la fiche ne montre pas « ${t.st_in_force} »`);
    await open(page, `${base}/validations?f=done&r=${encodeURIComponent(wf)}`);
    check((await page.locator('main').innerText()).includes(t.wf_approved), `le circuit ne se dit pas « ${t.wf_approved} »`);
    done(`${docId} en vigueur (révision A), circuit « ${t.wf_approved} »`);
    check(!errors.length, `erreurs JavaScript : ${errors.join(' ; ')}`);
  } finally {
    await browser.close();
  }
}

async function main() {
  const t0 = Date.now();
  const server = startServer({ port: PORT, dev: DEV, prefix: 'codex-e2e', command: 'e2e' });
  try {
    if (!(await waitHealthy(server.base, server.child))) {
      console.error(`npm run e2e : le serveur ne répond pas sur ${server.base} (journal : ${server.log}).`);
      console.error(serverLogTail(server));
      process.exitCode = 2;
      return;
    }
    console.log(`Parcours de bout en bout sur ${server.base} (base de démonstration jetable) :`);
    await run(server.base);
    console.log(`\n${steps.length} étapes réussies en ${((Date.now() - t0) / 1000).toFixed(0)} s.`);
  } catch (err) {
    console.error(`\n✗ ${err instanceof Failed ? err.message : err instanceof Error ? err.stack ?? err.message : String(err)}`);
    console.error(`(${steps.length} étape(s) réussie(s) avant ; journal du serveur :)\n${serverLogTail(server, 15)}`);
    process.exitCode = 1;
  } finally {
    await stopServer(server);
  }
}

await main();
