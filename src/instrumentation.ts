import type { Instrumentation } from 'next';

// Next.js calls register() once when a server starts (next dev, next start, the Mac app), before it handles any request,
// and onRequestError() for each server error it catches (node_modules/next/dist/docs/01-app/03-api-reference/
// 03-file-conventions/instrumentation.md). Never during next build. Codex runs on the Node.js runtime only (the proxy
// included); the modules are imported inside the functions, as the guide recommends.

/**
 * Checks the configuration (lib/config-check.ts) and writes what it finds to the technical log. A configuration refused
 * (an error while CODEX_CONFIG_CHECK is strict, the default in production) stops the server before it serves anything.
 * Then starts the scheduler (lib/scheduler.ts), whose first look comes a few seconds later: deferred entry into force,
 * and the maintenance tasks its variables turn on.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { checkAtStart } = await import('./lib/config-check');
  await checkAtStart();
  const { startScheduler } = await import('./lib/scheduler');
  startScheduler();
}

/** Every server error Next.js catches (page rendering, Server Action, route handler, proxy), in the technical log. */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { logRequestError } = await import('./lib/log');
  logRequestError(err, request, context);
};
