// What the browser checks share (scripts/codex-a11y.mts, scripts/codex-e2e.mts): a Codex server started on a throwaway
// demo database, its health awaited, then stopped and its directory removed; and Chromium through playwright-core.
//
// The server gets a demo database of its own in a temporary directory (CODEX_DATA_DIR, CODEX_SEED=demo), removed at the
// end: never .data/. Production build (next start) by default, `next dev` with `dev`. Chromium: the one playwright-core
// knows (PLAYWRIGHT_BROWSERS_PATH, or `npx playwright-core install chromium`), or CODEX_A11Y_CHROMIUM.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export type Server = { child: ChildProcess; dir: string; base: string; log: string };

/**
 * Starts `next start` (or `next dev`) on `port`, on a demo database in a new temporary directory named after `prefix`.
 * `env`: more variables for the server. Exits with status 2 when there is no production build to start.
 */
export function startServer(o: { port: number; dev?: boolean; prefix: string; command: string; env?: Record<string, string> }): Server {
  if (!o.dev && !existsSync(path.join(ROOT, '.next', 'BUILD_ID'))) {
    console.error(`npm run ${o.command} : pas de build de production. Lancez \`npm run build\` d’abord, ou passez --dev.`);
    process.exit(2);
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), `${o.prefix}-`));
  const log = path.join(dir, 'server.log');
  const fd = openSync(log, 'a');
  const next = require.resolve('next/dist/bin/next');
  const child = spawn(process.execPath, [next, o.dev ? 'dev' : 'start', '--port', String(o.port)], {
    cwd: ROOT,
    env: { ...process.env, CODEX_DATA_DIR: path.join(dir, 'data'), CODEX_SEED: 'demo', CODEX_MIGRATION_BACKUP: 'off', NEXT_TELEMETRY_DISABLED: '1', DATABASE_URL: '', ...o.env },
    stdio: ['ignore', fd, fd],
    detached: true,
  });
  return { child, dir, base: `http://localhost:${o.port}`, log };
}

/** Waits until /api/health answers (3 minutes at most); false when it never does or the server exits. */
export async function waitHealthy(base: string, child?: ChildProcess): Promise<boolean> {
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

/** The last lines of the server's log, to explain why it did not start. */
export function serverLogTail(server: Server, lines = 30): string {
  return readFileSync(server.log, 'utf8').split('\n').slice(-lines).join('\n');
}

/** Stops the server (its whole process group) and removes its directory. */
export async function stopServer(server: Server | null): Promise<void> {
  if (!server) return;
  try { process.kill(-server.child.pid!, 'SIGTERM'); } catch { /* already gone */ }
  await new Promise((r) => setTimeout(r, 1_500));
  try { process.kill(-server.child.pid!, 'SIGKILL'); } catch { /* gone */ }
  rmSync(server.dir, { recursive: true, force: true });
}

export function launchChromium(): Promise<Browser> {
  return chromium.launch(process.env.CODEX_A11Y_CHROMIUM ? { executablePath: process.env.CODEX_A11Y_CHROMIUM } : {});
}
