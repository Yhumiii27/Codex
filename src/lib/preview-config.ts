// Configuration of the PDF preview of Office files (point 15 of docs/reste-a-faire.md, M12; lib/office-preview.ts). No
// conversion unless one service is named:
//   CODEX_PREVIEW_SOFFICE        absolute path of LibreOffice's soffice, run headless on the server
//                                (/usr/bin/soffice, /Applications/LibreOffice.app/Contents/MacOS/soffice);
//   CODEX_PREVIEW_GOTENBERG_URL  address of a Gotenberg service (http://gotenberg:3000), reached on a private network.
//   CODEX_PREVIEW_TIMEOUT_S      longest conversion, in seconds (60 by default, 5 to 600);
//   CODEX_PREVIEW_MAX_MB         largest file converted, in megabytes (20 by default, 1 to 200).
// Both services named: none is used, and the configuration check says so. Pure (lib/config-check.ts reads it too).

export type Converter =
  | { kind: 'off' }
  | { kind: 'soffice'; path: string }
  | { kind: 'gotenberg'; url: string }
  | { kind: 'invalid'; reason: 'both' | 'soffice_path' | 'gotenberg_url' };

type Env = Record<string, string | undefined>;

/** The conversion service the environment names. */
export function converterOf(env: Env): Converter {
  const soffice = env.CODEX_PREVIEW_SOFFICE?.trim();
  const gotenberg = env.CODEX_PREVIEW_GOTENBERG_URL?.trim();
  if (soffice && gotenberg) return { kind: 'invalid', reason: 'both' };
  if (soffice) {
    // An absolute path only: a bare name would be looked up in the PATH of whoever starts the server.
    if (!soffice.startsWith('/') || /[\0\n]/.test(soffice)) return { kind: 'invalid', reason: 'soffice_path' };
    return { kind: 'soffice', path: soffice };
  }
  if (gotenberg) {
    let url: URL;
    try {
      url = new URL(gotenberg);
    } catch {
      return { kind: 'invalid', reason: 'gotenberg_url' };
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) return { kind: 'invalid', reason: 'gotenberg_url' };
    return { kind: 'gotenberg', url: url.href.replace(/\/+$/, '') };
  }
  return { kind: 'off' };
}

export const DEFAULT_PREVIEW_TIMEOUT_S = 60;
export const DEFAULT_PREVIEW_MAX_MB = 20;

function bounded(raw: string | undefined, min: number, max: number, def: number): number {
  const v = raw?.trim();
  if (!v) return def;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : def;
}

/** Longest conversion, in milliseconds. */
export const previewTimeoutMs = (env: Env) => bounded(env.CODEX_PREVIEW_TIMEOUT_S, 5, 600, DEFAULT_PREVIEW_TIMEOUT_S) * 1000;
/** Largest file converted, in bytes. */
export const previewMaxBytes = (env: Env) => Math.floor(bounded(env.CODEX_PREVIEW_MAX_MB, 1, 200, DEFAULT_PREVIEW_MAX_MB) * 1024 * 1024);
/** Whether a value of CODEX_PREVIEW_TIMEOUT_S or CODEX_PREVIEW_MAX_MB is out of its range (configuration check). */
export const previewTimeoutInvalid = (env: Env) => !!env.CODEX_PREVIEW_TIMEOUT_S?.trim() && bounded(env.CODEX_PREVIEW_TIMEOUT_S, 5, 600, -1) < 0;
export const previewMaxInvalid = (env: Env) => !!env.CODEX_PREVIEW_MAX_MB?.trim() && bounded(env.CODEX_PREVIEW_MAX_MB, 1, 200, -1) < 0;

/** Formats converted for the preview: word processing, spreadsheets and presentations, Office and OpenDocument. */
export const CONVERTIBLE: ReadonlySet<string> = new Set(['.doc', '.docx', '.dotx', '.odt', '.rtf', '.xls', '.xlsx', '.xltx', '.ods', '.ppt', '.pptx', '.potx', '.odp']);

/** Whether a stored file is converted for its preview, by the extension it is stored and served with (lib/storage.ts storedExt). */
export function convertible(ext: string): boolean {
  return CONVERTIBLE.has(ext.toLowerCase());
}
