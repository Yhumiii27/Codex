import { clientReport, newClientRef } from './client-errors';

// Browser side of lib/client-errors.ts: the reference of an error the browser threw, and its report to the server.

const refs = new WeakMap<object, string>();
const sent = new WeakSet<object>();

/** The reference shown for `error`, an error of the browser (no digest): the same one each time it is asked for it. */
export function clientRefFor(error: unknown): string {
  if (!error || typeof error !== 'object') return newClientRef();
  let ref = refs.get(error);
  if (!ref) refs.set(error, (ref = newClientRef()));
  return ref;
}

/**
 * Sends the report of `error` under `ref`, once per error (a screen rendered twice), in the background and with
 * `keepalive`, so that it leaves even if the page is reloaded at once. A report that cannot be sent is dropped: the screen
 * works the same.
 */
export function sendClientReport(error: unknown, ref: string): void {
  if (error && typeof error === 'object') {
    if (sent.has(error)) return;
    sent.add(error);
  }
  try {
    const body = JSON.stringify(clientReport(error, ref, location.pathname));
    void fetch('/api/client-errors', { method: 'POST', body, keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }).catch(() => {});
  } catch {
    // Nothing to do: the reference is still shown.
  }
}
