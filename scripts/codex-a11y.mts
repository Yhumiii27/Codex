// Automated accessibility check (point 55 of docs/reste-a-faire.md, docs/accessibilite.md): axe-core run in Chromium
// (playwright-core) on the main screens and dialogs, as the default simulated user (Claire Bardet, records manager,
// who sees every screen).
//
//   npm run build && npm run a11y      production build (next start) on a throwaway demo database
//   npm run a11y -- --dev              next dev instead (no build; slower, and no other `next dev` may run in the repo)
//   npm run a11y -- --url http://localhost:3100   an app already running, on its own database: no dialog is sent
//                                       (see DIALOGS), but the records opened are journalised as consultations
//   --lang en                          English interface (French by default); --lang all for both
//   --port 3190                        port of the server started here
//   --json report.json                 every finding, moderate and minor ones included
//   --narrow                           narrow display and zoom (WCAG 1.4.10, 1.4.4; scripts/codex-narrow.mts): every
//                                      screen and dialog at 1 440 px (reference), 320 px, and 1 280 px at 200 %: axe at
//                                      each size, and the page's sideways overflow, texts out of reach, cut or drawn over
//                                      one another; these layout findings are listed, they never fail the run
//   --shots <dossier>                  a screenshot of every screen (at each size with --narrow), to compare two builds
//
// Started here, the server gets a demo database of its own in a temporary directory (CODEX_DATA_DIR, CODEX_SEED=demo),
// removed at the end: never .data/. Chromium: the one playwright-core knows (PLAYWRIGHT_BROWSERS_PATH, or
// `npx playwright-core install chromium`), or CODEX_A11Y_CHROMIUM.
// Fails (exit 1) on a violation axe rates serious or critical, or when the skip link does not work; moderate and minor
// ones are listed only. Exit 2 on a wrong usage or when the server cannot start.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { DICT, type Lang } from '../src/lib/i18n';
import { launchChromium, serverLogTail, startServer, stopServer, waitHealthy } from './codex-browser.mjs';
import { KIND_LABEL, KINDS, measureLayout, SIZES, type Layout, type Size } from './codex-narrow.mjs';

const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DEV = args.includes('--dev');
const URL_ARG = opt('--url');
const PORT = Number(opt('--port') ?? 3190);
const JSON_OUT = opt('--json');
const NARROW = args.includes('--narrow');
const SHOTS = opt('--shots');
const LANG_ARG = opt('--lang') ?? 'fr';
const LANGS: Lang[] = LANG_ARG === 'all' ? ['fr', 'en'] : LANG_ARG === 'en' ? ['en'] : LANG_ARG === 'fr' ? ['fr'] : [];
if (!LANGS.length || !Number.isInteger(PORT)) {
  console.error('npm run a11y [-- --dev | --url <adresse>] [--lang fr|en|all] [--port N] [--json fichier] [--narrow] [--shots dossier]');
  process.exit(2);
}

/** Rules axe applies: WCAG 2.0 to 2.2, levels A and AA, and its best practices (reported, failing only when serious). */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const FAILING = new Set(['serious', 'critical']);

/** Screens, each with the tabs or views its URL selects (demo database: src/db/seed-docs.ts). */
const PAGES: { name: string; path: string }[] = [
  { name: 'Accueil', path: '/' },
  { name: 'Explorateur', path: '/explorateur' },
  { name: 'Explorateur, document sélectionné', path: '/explorateur?sel=PRO-QUA-0001' },
  { name: 'Recherche', path: '/recherche' },
  { name: 'Recherche, texte et filtre', path: '/recherche?q=levage&status=in_force' },
  { name: 'Département', path: '/departements/QUA' },
  { name: 'Fiche (en vigueur)', path: '/documents/PRO-QUA-0001' },
  { name: 'Fiche, Révisions', path: '/documents/PRO-QUA-0001?tab=versions' },
  { name: 'Fiche, Validation', path: '/documents/PRO-QUA-0001?tab=approval' },
  { name: 'Fiche, Demandes', path: '/documents/PRO-QUA-0001?tab=requests' },
  { name: 'Fiche, Historique', path: '/documents/PRO-QUA-0001?tab=history' },
  { name: 'Fiche de projet', path: '/documents/PV-HLT-026-001' },
  { name: 'Fiche (brouillon)', path: '/documents/VAR-HLT-026-001?tab=versions' },
  { name: 'Validations', path: '/validations' },
  { name: 'Validations, terminées', path: '/validations?f=done' },
  { name: 'Mes demandes Vigie', path: '/validations?f=vigie' },
  { name: 'Archivage', path: '/archivage' },
  { name: 'Archivage, règles', path: '/archivage?tab=rules' },
  { name: 'Archivage, dates d’événement', path: '/archivage?tab=events' },
  { name: 'Archivage, archives', path: '/archivage?tab=archives' },
  { name: 'Administration, registre', path: '/administration' },
  { name: 'Administration, fonctions', path: '/administration?tab=functions' },
  { name: 'Administration, rôles', path: '/administration?tab=roles' },
  { name: 'Administration, organisation', path: '/administration?tab=org' },
  { name: 'Administration, vocabulaires', path: '/administration?tab=vocab' },
  { name: 'Administration, reprise', path: '/administration?tab=transfer' },
  { name: 'Administration, modèles', path: '/administration?tab=templates' },
  { name: 'Administration, journal', path: '/administration?tab=audit' },
  { name: 'Aide', path: '/aide' },
  { name: 'Page introuvable', path: '/introuvable' },
];

type T = (typeof DICT)['fr'];
/**
 * Main dialogs: the screen, then the button that opens it (by its accessible name, from the dictionary). Each is closed
 * with Escape, never sent: the database is not changed.
 */
const DIALOGS: { name: string; path: string; button: (t: T) => string | RegExp }[] = [
  { name: 'Nouveau depuis un modèle', path: '/', button: (t) => t.new_from_tpl },
  { name: 'Déposer un fichier', path: '/', button: (t) => t.upload },
  { name: 'Notes de conception', path: '/', button: (t) => t.notes },
  { name: 'Simuler un utilisateur', path: '/', button: () => /Claire Bardet/ },
  { name: 'Modifier les métadonnées', path: '/documents/PRO-QUA-0001', button: (t) => t.edit_meta },
  { name: 'Demander une modification', path: '/documents/PRO-HSE-0001', button: (t) => t.request_change },
  { name: 'Demander le retrait', path: '/documents/PRO-HSE-0001', button: (t) => t.request_obsolete },
  { name: 'Lecteurs désignés', path: '/documents/RHF-RHU-0001', button: (t) => t.readers },
  { name: 'Lier un document', path: '/documents/PRO-QUA-0001', button: (t) => t.link_add },
  { name: 'Nouvelle version de travail', path: '/documents/VAR-HLT-026-001', button: (t) => t.new_working_version },
  { name: 'Demander la validation', path: '/documents/VAR-HLT-026-001', button: (t) => t.request_validation },
  { name: 'Comparer', path: '/documents/VAR-HLT-026-001?tab=versions', button: (t) => t.compare },
  { name: 'Rejeter', path: '/validations', button: (t) => t.reject },
  { name: 'Déléguer', path: '/validations', button: (t) => t.delegate },
  { name: 'Rappeler la demande', path: '/validations', button: (t) => t.recall },
  { name: 'Simulation Vigie', path: '/documents/PRO-QUA-0001?tab=requests', button: (t) => t.vigie_sim },
  { name: 'Enregistrer la recherche', path: '/recherche?q=levage', button: (t) => t.search_save },
  { name: 'Nouveau type', path: '/administration', button: (t) => t.new_type },
  { name: 'Nouvelle fonction', path: '/administration?tab=functions', button: (t) => t.new_function },
  { name: 'Nouveau département', path: '/administration?tab=org', button: (t) => t.new_department },
];

type Node = { target: string[]; html: string; failureSummary?: string };
type Violation = { id: string; impact: string | null; help: string; helpUrl: string; nodes: Node[] };
/** `narrow`: found at a narrow size (--narrow), listed without failing the run. */
type Finding = Violation & { where: string; lang: Lang; narrow?: boolean };
/** Layout measured on a screen or in a dialog at one size (--narrow). */
type LayoutRow = Layout & { where: string; lang: Lang; size: Size['key'] };

const findings: Finding[] = [];
const layouts: LayoutRow[] = [];
const problems: string[] = [];
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

async function axe(page: Page, where: string, lang: Lang, include?: string, narrow = false) {
  await page.evaluate(AXE);
  const res = await page.evaluate(
    async ({ tags, include }) => {
      const w = window as unknown as { axe: { run: (ctx: unknown, o: unknown) => Promise<{ violations: Violation[] }> } };
      const r = await w.axe.run(include ? { include: [include] } : document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.map((n) => ({ target: n.target, html: n.html.slice(0, 300), failureSummary: n.failureSummary })) }));
    },
    { tags: TAGS, include },
  );
  for (const v of res) findings.push({ ...v, where, lang, narrow });
}

async function open(page: Page, base: string, p: string) {
  const res = await page.goto(base + p, { waitUntil: 'networkidle', timeout: 120_000 });
  // Hydrated: the client components answer (the dialogs are opened by them).
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 30_000 });
  return res?.status() ?? 0;
}

/** First Tab stop is « Aller au contenu », shown while focused; Enter moves the focus to <main id="contenu">. */
async function skipLink(page: Page, base: string, t: T) {
  await open(page, base, '/');
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    const r = a?.getBoundingClientRect();
    return { cls: a?.className ?? '', text: a?.textContent?.trim() ?? '', href: a?.getAttribute('href'), w: r?.width ?? 0, h: r?.height ?? 0 };
  });
  if (!String(first.cls).includes('skip-link') || first.text !== t.skip_to_content || first.href !== '#contenu') problems.push(`Lien d'évitement : premier arrêt de Tab = ${JSON.stringify(first)}`);
  else if (first.w < 20 || first.h < 10) problems.push(`Lien d'évitement invisible au focus (${first.w}×${first.h})`);
  await page.keyboard.press('Enter');
  const after = await page.evaluate(() => document.activeElement?.id ?? '');
  if (after !== 'contenu') problems.push(`Lien d'évitement : le focus va sur « ${after} » au lieu de <main id="contenu">`);
}

async function dialog(page: Page, base: string, d: (typeof DIALOGS)[number], t: T, lang: Lang, size?: Size) {
  await open(page, base, d.path);
  const name = d.button(t);
  const btn = page.getByRole('button', { name, exact: typeof name === 'string' }).first();
  const tag = size && size.key !== 'bureau' ? ` (${size.label})` : '';
  if (!(await btn.count())) { problems.push(`${d.name}${tag} : bouton introuvable sur ${d.path}`); return; }
  if (await btn.isDisabled()) { problems.push(`${d.name}${tag} : bouton inactif sur ${d.path}`); return; }
  const box = page.locator('[role="dialog"][aria-modal="true"]');
  for (let i = 0; i < 3 && !(await box.count()); i++) {
    // At a narrow size the button may be cut by its block or covered: the measure says so, the dialog is opened anyway.
    if (size) await btn.click({ timeout: 3_000 }).catch(() => btn.evaluate((b) => (b as HTMLElement).click()));
    else await btn.click();
    await box.first().waitFor({ timeout: 3_000 }).catch(() => {});
  }
  if (!(await box.count())) { problems.push(`${d.name}${tag} : le dialogue ne s'ouvre pas`); return; }
  // Content fetched by the dialog (Compare) has time to arrive.
  await page.waitForLoadState('networkidle');
  const where = `Dialogue « ${d.name} »`;
  await axe(page, size ? `${size.label} · ${where}` : where, lang, '[role="dialog"][aria-modal="true"]', !!tag);
  if (size) layouts.push({ ...(await page.evaluate(measureLayout, '[role="dialog"][aria-modal="true"]')), where, lang, size: size.key });
  if (SHOTS) await shot(page, size, lang, `d${String(DIALOGS.indexOf(d) + 1).padStart(2, '0')}-${slug(d.name)}`);
  // Focus is inside the dialog, and comes back out once it is closed.
  const inside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  if (!inside) problems.push(`${d.name}${tag} : le focus n'est pas dans le dialogue à l'ouverture`);
  await page.keyboard.press('Escape');
  await box.first().waitFor({ state: 'detached', timeout: 5_000 }).catch(() => problems.push(`${d.name}${tag} : Échap ne ferme pas le dialogue`));
}

/** A screenshot in <--shots>/<size>-<lang>/<name>.png. */
async function shot(page: Page, size: Size | undefined, lang: Lang, name: string) {
  const dir = path.join(SHOTS!, `${(size ?? SIZES[0]).key}-${lang}`);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

const slug = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Every screen, then the skip link and the dialogs, in one language and at one size. */
async function pass(browser: Browser, base: string, lang: Lang, size: Size | undefined) {
  const t = DICT[lang];
  const vp = size ?? SIZES[0];
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.scale });
  // tsx keeps the names of the functions it compiles (__name), which measureLayout carries into the page.
  await ctx.addInitScript('globalThis.__name = globalThis.__name || ((f) => f);');
  await ctx.addCookies([{ name: 'codex-lang', value: lang, url: base }]);
  const page = await ctx.newPage();
  const tag = size && size.key !== 'bureau' ? ` (${size.label})` : '';
  page.on('pageerror', (e) => problems.push(`[${lang}] erreur JavaScript${tag} : ${e.message}`));
  for (const [i, p] of PAGES.entries()) {
    const status = await open(page, base, p.path);
    if (status !== 200 && !(p.path === '/introuvable' && status === 404)) problems.push(`[${lang}] ${p.name}${tag} : HTTP ${status}`);
    await axe(page, size ? `${size.label} · ${p.name}` : p.name, lang, undefined, !!tag);
    if (size) layouts.push({ ...(await page.evaluate(measureLayout, null)), where: p.name, lang, size: size.key });
    if (SHOTS) await shot(page, size, lang, `${String(i + 1).padStart(2, '0')}-${slug(p.name)}`);
  }
  await skipLink(page, base, t);
  for (const d of DIALOGS) await dialog(page, base, d, t, lang, size);
  await ctx.close();
}

/** One line per screen or dialog with its counts at each size, then the totals of each narrow size (details: --json). */
function reportLayout() {
  const count = (r: LayoutRow) => KINDS.map((k) => r[k].length);
  for (const lang of LANGS) {
    console.log(`\nAffichage étroit et zoom [${lang}] : page = débordement horizontal de la page en px ; ${KINDS.map((k) => KIND_LABEL[k]).join(', ')}`);
    const wheres = [...new Set(layouts.filter((r) => r.lang === lang).map((r) => r.where))];
    for (const where of wheres) {
      const cells = SIZES.map((s) => {
        const r = layouts.find((x) => x.lang === lang && x.where === where && x.size === s.key);
        return r ? `${s.key} page ${r.page} · ${count(r).join('/')}` : `${s.key} —`;
      });
      console.log(`  ${where} : ${cells.join(' | ')}`);
    }
  }
  for (const s of SIZES.filter((x) => x.key !== 'bureau')) {
    const rows = layouts.filter((r) => r.size === s.key);
    const tot = (k: (typeof KINDS)[number]) => rows.reduce((n, r) => n + r[k].length, 0);
    const ref = (k: (typeof KINDS)[number]) => layouts.filter((r) => r.size === 'bureau').reduce((n, r) => n + r[k].length, 0);
    const wide = rows.filter((r) => r.page > 0).length;
    console.log(`\n${s.label} : ${wide}/${rows.length} écrans ou dialogues plus larges que la fenêtre ; ${KINDS.map((k) => `${KIND_LABEL[k]} ${tot(k)} (bureau ${ref(k)})`).join(', ')}.`);
  }
}



async function main() {
  const t0 = Date.now();
  const server = URL_ARG ? null : startServer({ port: PORT, dev: DEV, prefix: 'codex-a11y', command: 'a11y' });
  const base = URL_ARG?.replace(/\/$/, '') ?? server!.base;
  let browser: Browser | null = null;
  try {
    if (!(await waitHealthy(base, server?.child))) {
      console.error(`npm run a11y : le serveur ne répond pas sur ${base}${server ? ` (journal : ${server.log})` : ''}.`);
      if (server) console.error(serverLogTail(server));
      process.exitCode = 2;
      return;
    }
    browser = await launchChromium();
    for (const lang of LANGS) {
      if (!NARROW) await pass(browser, base, lang, undefined);
      else for (const size of SIZES) await pass(browser, base, lang, size);
    }
  } finally {
    await browser?.close();
    await stopServer(server);
  }
  if (process.exitCode === 2) return;

  // One line per rule, then where it was found and its first elements.
  const byRule = new Map<string, Finding[]>();
  for (const f of findings) byRule.set(f.id, [...(byRule.get(f.id) ?? []), f]);
  const order = ['critical', 'serious', 'moderate', 'minor'];
  const rules = [...byRule.values()].sort((a, b) => order.indexOf(a[0].impact ?? 'minor') - order.indexOf(b[0].impact ?? 'minor'));
  let failing = 0;
  for (const fs of rules) {
    const { id, impact, help, helpUrl } = fs[0];
    const n = fs.reduce((s, f) => s + f.nodes.length, 0);
    if (FAILING.has(impact ?? '')) failing += fs.filter((f) => !f.narrow).reduce((s, f) => s + f.nodes.length, 0);
    console.log(`\n[${impact}] ${id} — ${help} (${n} élément(s)) ${helpUrl}`);
    for (const f of fs.slice(0, 6)) console.log(`  ${f.lang} · ${f.where} : ${f.nodes.slice(0, 2).map((x) => x.target.join(' ')).join(' ; ')}`);
    if (fs.length > 6) console.log(`  … et ${fs.length - 6} autre(s) écran(s) ou dialogue(s)`);
  }
  for (const p of problems) console.log(`\n[contrôle] ${p}`);
  if (NARROW) reportLayout();
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ findings, problems, ...(NARROW ? { sizes: SIZES, layouts } : {}) }, null, 2));
  const s = ((Date.now() - t0) / 1000).toFixed(0);
  const sizes = NARROW ? ` et par taille (${SIZES.map((x) => x.label).join(', ')})` : '';
  const narrowSerious = findings.filter((f) => f.narrow && FAILING.has(f.impact ?? '')).reduce((n, f) => n + f.nodes.length, 0);
  const narrowNote = NARROW ? ` (${narrowSerious} de plus aux tailles étroites, listés sans faire échouer)` : '';
  console.log(`\n${PAGES.length} écrans et ${DIALOGS.length} dialogues par langue (${LANGS.join(', ')})${sizes}, ${s} s : ${failing} élément(s) en violation sérieuse ou critique${narrowNote}, ${findings.length - findings.filter((f) => FAILING.has(f.impact ?? '')).length} constat(s) modéré(s) ou mineur(s), ${problems.length} problème(s) de contrôle.`);
  if (failing || problems.length) process.exitCode = 1;
}

await main();
