import type { T } from './i18n';

// What the user is shown of an unexpected error (point 44 of docs/reste-a-faire.md): never its message, which may name
// a table, a path or a value, but a reference to give the administrator, who finds the error with it in the technical
// log (lib/log.ts). Next.js gives the browser that reference as `digest`: for a failed Server Action, the request
// identifier of the "action failed" entry (lib/log.ts traceAction, withDigest); for a failed rendering, the digest
// Next.js computes, which the "request failed" entry carries in err.digest (lib/log.ts logRequestError).

const REF = /^[A-Za-z0-9._:-]{1,128}$/;

/** The reference of a server error as the browser receives it, or null (an error of the browser itself). */
export function errorRef(err: unknown): string | null {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && REF.test(digest) ? digest : null;
}

/** « Une erreur est survenue · Réf. … » for a toast or a dialog, the plain message when there is no reference. */
export function failureText(t: T, err: unknown): string {
  const ref = errorRef(err);
  return ref ? `${t.error} · ${t.error_ref.replace('{ref}', ref)}` : t.error;
}
