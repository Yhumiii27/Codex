// Errors of the browser itself (point 49 of docs/reste-a-faire.md, rest « une erreur survenue dans le navigateur n'a pas
// de référence et n'est pas remontée au serveur »). A server error reaches the error screens with the reference the
// technical log carries (lib/errors.ts); one thrown while the browser renders has none. The error screens
// (src/app/error.tsx, global-error.tsx) give it one here, show it like a server reference and send a short report to
// POST /api/client-errors, which writes it to the technical log under that reference (scope `client`).
//
// What a report carries: the reference, the error's name, the first line of its message, cut, the first frames of its
// stack (file, line, column of the bundled code) and the path of the page, without its query string. Never the page's
// content, a form's values nor a cookie. Pure: used in the browser (to build the report) and on the server (to read it).

export const CLIENT_REF_PREFIX = 'nav-';
const CLIENT_REF = /^nav-[0-9a-f]{16}$/;

const MAX_NAME = 80;
const MAX_MESSAGE = 300;
const MAX_PATH = 200;
const MAX_FRAMES = 8;
const MAX_FRAME = 200;
/** Largest body accepted by the route: a report is a few hundred bytes. */
export const MAX_CLIENT_REPORT_BYTES = 8_192;

export type ClientReport = { ref: string; name: string; message: string; path: string; frames: string[] };

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);

/** A new reference for an error of the browser: « nav- » and 16 hexadecimal digits (getRandomValues works over http too). */
export function newClientRef(random: (a: Uint8Array) => Uint8Array = (a) => globalThis.crypto.getRandomValues(a)): string {
  const bytes = random(new Uint8Array(8));
  return CLIENT_REF_PREFIX + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const isClientRef = (ref: unknown): ref is string => typeof ref === 'string' && CLIENT_REF.test(ref);

/** A page path as the log keeps it: the path alone, never its query string nor its fragment; '/' when unreadable. */
function cleanPath(raw: unknown): string {
  if (typeof raw !== 'string') return '/';
  const path = raw.split(/[?#]/)[0];
  return path.startsWith('/') && !path.startsWith('//') ? cut(path, MAX_PATH) : '/';
}

/** The stack frames of a browser's stack (« at f (url:1:2) » in Chromium, « f@url:1:2 » in Firefox and WebKit). */
function framesOf(stack: unknown): string[] {
  if (typeof stack !== 'string') return [];
  return stack
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^at /.test(l) || /@\S+:\d+:\d+$/.test(l))
    .slice(0, MAX_FRAMES)
    .map((l) => cut(l, MAX_FRAME));
}

/** First line of a message, cut: a longer message may quote what the page showed. */
const firstLine = (m: unknown) => (typeof m === 'string' ? cut(m.split('\n')[0].trim(), MAX_MESSAGE) : '');

/** The report of `error` sent by the browser, under `ref`, for the page at `path` (location.pathname). */
export function clientReport(error: unknown, ref: string, path: string): ClientReport {
  const e = (error && typeof error === 'object' ? error : { message: String(error) }) as { name?: unknown; message?: unknown; stack?: unknown };
  return {
    ref,
    name: typeof e.name === 'string' && e.name ? cut(e.name, MAX_NAME) : 'Error',
    message: firstLine(e.message),
    path: cleanPath(path),
    frames: framesOf(e.stack),
  };
}

/**
 * A report as received by the route, checked and cut again (the browser may send anything): null when its reference is
 * not one newClientRef gives. Only the five fields are kept.
 */
export function readClientReport(raw: unknown): ClientReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isClientRef(r.ref)) return null;
  const frames = Array.isArray(r.frames) ? r.frames.filter((f): f is string => typeof f === 'string').slice(0, MAX_FRAMES).map((f) => cut(f.trim(), MAX_FRAME)) : [];
  return {
    ref: r.ref,
    name: typeof r.name === 'string' && r.name.trim() ? cut(r.name.trim(), MAX_NAME) : 'Error',
    message: firstLine(r.message),
    path: cleanPath(r.path),
    frames,
  };
}
