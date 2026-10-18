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
//
// Started here, the server gets a demo database of its own in a temporary directory (CODEX_DATA_DIR, CODEX_SEED=demo),
// removed at the end: never .data/. Chromium: the one playwright-core knows (PLAYWRIGHT_BROWSERS_PATH, or
// `npx playwright-core install chromium`), or CODEX_A11Y_CHROMIUM.
// Fails (exit 1) on a violation axe rates serious or critical, or when the skip link does not work; moderate and minor
// ones are listed only. Exit 2 on a wrong usage or when the server cannot start.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { DICT, type Lang } from '../src/lib/i18n';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DEV = args.includes('--dev');
const URL_ARG = opt('--url');
const PORT = Number(opt('--port') ?? 3190);
const JSON_OUT = opt('--json');
const LANG_ARG = opt('--lang') ?? 'fr';
const LANGS: Lang[] = LANG_ARG === 'all' ? ['fr', 'en'] : LANG_ARG === 'en' ? ['en'] : LANG_ARG === 'fr' ? ['fr'] : [];
if (!LANGS.length || !Number.isInteger(PORT)) {
  console.error('npm run a11y [-- --dev | --url <adresse>] [--lang fr|en|all] [--port N] [--json fichier]');
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
type Finding = Violation & { where: string; lang: Lang };

const findings: Finding[] = [];
const problems: string[] = [];
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

async function axe(page: Page, where: string, lang: Lang, include?: string) {
  await page.evaluate(AXE);
  const res = await page.evaluate(
    async ({ tags, include }) => {
      const w = window as unknown as { axe: { run: (ctx: unknown, o: unknown) => Promise<{ violations: Violation[] }> } };
      const r = await w.axe.run(include ? { include: [include] } : document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.map((n) => ({ target: n.target, html: n.html.slice(0, 300), failureSummary: n.failureSummary })) }));
    },
    { tags: TAGS, include },
  );
  for (const v of res) findings.push({ ...v, where, lang });
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

async function dialog(page: Page, base: string, d: (typeof DIALOGS)[number], t: T, lang: Lang) {
  await open(page, base, d.path);
  const name = d.button(t);
  const btn = page.getByRole('button', { name, exact: typeof name === 'string' }).first();
  if (!(await btn.count())) { problems.push(`${d.name} : bouton introuvable sur ${d.path}`); return; }
  if (await btn.isDisabled()) { problems.push(`${d.name} : bouton inactif sur ${d.path}`); return; }
  const box = page.locator('[role="dialog"][aria-modal="true"]');
  for (let i = 0; i < 3 && !(await box.count()); i++) {
    await btn.click();
    await box.first().waitFor({ timeout: 3_000 }).catch(() => {});
  }
  if (!(await box.count())) { problems.push(`${d.name} : le dialogue ne s'ouvre pas`); return; }
  // Content fetched by the dialog (Compare) has time to arrive.
  await page.waitForLoadState('networkidle');
  await axe(page, `Dialogue « ${d.name} »`, lang, '[role="dialog"][aria-modal="true"]');
  // Focus is inside the dialog, and comes back out once it is closed.
  const inside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  if (!inside) problems.push(`${d.name} : le focus n'est pas dans le dialogue à l'ouverture`);
  await page.keyboard.press('Escape');
  await box.first().waitFor({ state: 'detached', timeout: 5_000 }).catch(() => problems.push(`${d.name} : Échap ne ferme pas le dialogue`));
}

function startServer(): { child: ChildProcess; dir: string; base: string; log: string } {
  if (!DEV && !existsSync(path.join(ROOT, '.next', 'BUILD_ID'))) {
    console.error('npm run a11y : pas de build de production. Lancez `npm run build` d’abord, ou passez --dev.');
    process.exit(2);
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), 'codex-a11y-'));
  const log = path.join(dir, 'server.log');
  const fd = openSync(log, 'a');
  const next = require.resolve('next/dist/bin/next');
  const child = spawn(process.execPath, [next, DEV ? 'dev' : 'start', '--port', String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, CODEX_DATA_DIR: path.join(dir, 'data'), CODEX_SEED: 'demo', CODEX_MIGRATION_BACKUP: 'off', NEXT_TELEMETRY_DISABLED: '1', DATABASE_URL: '' },
    stdio: ['ignore', fd, fd],
    detached: true,
  });
  return { child, dir, base: `http://localhost:${PORT}`, log };
}

async function waitHealthy(base: string, child?: ChildProcess) {
  const until = Date.now() + 180_000;
  while (Date.now() < until) {
    if (child && child.exitCode != null) return false;
    try {
      const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(30_000) });
      if (r.ok) return true;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return false;
}

async function main() {
  const t0 = Date.now();
  const server = URL_ARG ? null : startServer();
  const base = URL_ARG?.replace(/\/$/, '') ?? server!.base;
  let browser: Browser | null = null;
  try {
    if (!(await waitHealthy(base, server?.child))) {
      console.error(`npm run a11y : le serveur ne répond pas sur ${base}${server ? ` (journal : ${server.log})` : ''}.`);
      if (server) console.error(readFileSync(server.log, 'utf8').split('\n').slice(-30).join('\n'));
      process.exitCode = 2;
      return;
    }
    browser = await chromium.launch(process.env.CODEX_A11Y_CHROMIUM ? { executablePath: process.env.CODEX_A11Y_CHROMIUM } : {});
    for (const lang of LANGS) {
      const t = DICT[lang];
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx.addCookies([{ name: 'codex-lang', value: lang, url: base }]);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => problems.push(`[${lang}] erreur JavaScript : ${e.message}`));
      for (const p of PAGES) {
        const status = await open(page, base, p.path);
        if (status !== 200 && !(p.path === '/introuvable' && status === 404)) problems.push(`[${lang}] ${p.name} : HTTP ${status}`);
        await axe(page, p.name, lang);
      }
      await skipLink(page, base, t);
      for (const d of DIALOGS) await dialog(page, base, d, t, lang);
      await ctx.close();
    }
  } finally {
    await browser?.close();
    if (server) {
      try { process.kill(-server.child.pid!, 'SIGTERM'); } catch { /* already gone */ }
      await new Promise((r) => setTimeout(r, 1_500));
      try { process.kill(-server.child.pid!, 'SIGKILL'); } catch { /* gone */ }
      rmSync(server.dir, { recursive: true, force: true });
    }
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
    if (FAILING.has(impact ?? '')) failing += n;
    console.log(`\n[${impact}] ${id} — ${help} (${n} élément(s)) ${helpUrl}`);
    for (const f of fs.slice(0, 6)) console.log(`  ${f.lang} · ${f.where} : ${f.nodes.slice(0, 2).map((x) => x.target.join(' ')).join(' ; ')}`);
    if (fs.length > 6) console.log(`  … et ${fs.length - 6} autre(s) écran(s) ou dialogue(s)`);
  }
  for (const p of problems) console.log(`\n[contrôle] ${p}`);
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ findings, problems }, null, 2));
  const s = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\n${PAGES.length} écrans et ${DIALOGS.length} dialogues par langue (${LANGS.join(', ')}), ${s} s : ${failing} élément(s) en violation sérieuse ou critique, ${findings.length - findings.filter((f) => FAILING.has(f.impact ?? '')).length} constat(s) modéré(s) ou mineur(s), ${problems.length} problème(s) de contrôle.`);
  if (failing || problems.length) process.exitCode = 1;
}

await main();
