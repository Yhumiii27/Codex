// Stored file types the browser displays without running scripts. The file route serves only these inline
// (src/app/api/documents/[id]/file/route.ts); any other type goes out as a download, as application/octet-stream, so the
// document preview (src/app/documents/[id]/DocClient.tsx) shows only these too. No 'server-only': the preview is a
// client component.

import { fmtSize } from './format';
import type { Lang, T } from './i18n';

export const INLINE_SAFE: ReadonlySet<string> = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain']);

export type PreviewKind = 'pdf' | 'image' | 'text';

/**
 * How the preview shows a stored file of this type (already normalised by normalizeMime); null when the file route only
 * hands it out as a download (image/vnd.dwg, image/tiff, image/svg+xml, Office files…): the preview then offers it.
 */
export function previewKind(mime: string | null | undefined): PreviewKind | null {
  if (!mime || !INLINE_SAFE.has(mime)) return null;
  return mime === 'application/pdf' ? 'pdf' : mime === 'text/plain' ? 'text' : 'image';
}

// ── Formats admitted on upload ──────────────────────────────────────────
//
// Every file entering Codex (new document, working version, copy of a template, import) is checked by stageFile
// (src/lib/storage.ts) against these rules; the upload dialogs check name and size beforehand (FilePicker). Which
// formats and what size are open questions (M12 of docs/audit-deck-epc2i.md): the defaults below are the assistant's,
// set through CODEX_FILE_EXTENSIONS and CODEX_MAX_FILE_MB (.env.example).

/**
 * Content signatures checked when reliable; formats without one (text, CAD exchange files…) are taken on their name.
 * ooxml: a ZIP holding "[Content_Types].xml" (Office Open XML, Visio); odf: a ZIP holding "mimetype" or
 * "META-INF/manifest.xml" (OpenDocument); ole2: a compound file whose directory can be read (Office 97-2003, Project,
 * Outlook); ole2_encrypted: one holding an "EncryptedPackage" stream, an Office Open XML file encrypted by a password or a
 * sensitivity label (MS-OFFCRYPTO).
 */
type Signature = 'pdf' | 'png' | 'jpeg' | 'gif' | 'webp' | 'tiff' | 'zip' | 'ooxml' | 'odf' | 'ole2' | 'ole2_encrypted' | 'rtf' | 'dwg' | 'ftyp';

const OOXML: readonly Signature[] = ['ooxml', 'ole2_encrypted'];

/** Formats Codex knows, by extension, with the signatures one of which their content must have (null: none checked). */
const FORMATS: Readonly<Record<string, readonly Signature[] | null>> = {
  // Documents (a .doc may also be Word's RTF, as older systems export it)
  '.pdf': ['pdf'], '.doc': ['ole2', 'rtf'], '.docx': OOXML, '.dotx': OOXML, '.odt': ['odf'], '.rtf': ['rtf'], '.txt': null,
  '.xls': ['ole2'], '.xlsx': OOXML, '.xltx': OOXML, '.ods': ['odf'], '.csv': null,
  '.ppt': ['ole2'], '.pptx': OOXML, '.potx': OOXML, '.odp': ['odf'],
  '.vsdx': OOXML, '.mpp': ['ole2'], '.msg': ['ole2'], '.eml': null,
  // Images and video (site photos, scans, training material)
  '.png': ['png'], '.jpg': ['jpeg'], '.jpeg': ['jpeg'], '.gif': ['gif'], '.webp': ['webp'], '.tif': ['tiff'], '.tiff': ['tiff'], '.heic': ['ftyp'], '.mp4': ['ftyp'],
  // Drawings and models (DXF and STL also exist in binary form: no signature)
  '.dwg': ['dwg'], '.dxf': null, '.step': null, '.stp': null, '.iges': null, '.igs': null, '.ifc': null, '.stl': null,
  // Data
  '.json': null, '.xml': null,
  // Known, but not admitted by default: archives can carry anything past the format check.
  '.zip': ['zip'],
};

/** Admitted by default: every known format but archives. */
export const DEFAULT_EXTENSIONS: readonly string[] = Object.keys(FORMATS).filter((e) => e !== '.zip');

/**
 * Never admitted, whatever CODEX_FILE_EXTENSIONS says: programs, installers and disk images, scripts a workstation runs
 * when the file is opened, pages and images that run scripts in a browser, Office files with macros.
 */
export const DENIED_EXTENSIONS: ReadonlySet<string> = new Set([
  '.exe', '.com', '.scr', '.pif', '.bat', '.cmd', '.msi', '.msp', '.msix', '.appx', '.dll', '.sys', '.cpl', '.ocx', '.drv',
  '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.mjs', '.wsf', '.wsh', '.hta', '.lnk', '.url', '.reg', '.inf', '.scf',
  '.jar', '.apk', '.app', '.dmg', '.pkg', '.command', '.iso', '.img', '.vhd', '.vhdx',
  '.html', '.htm', '.xhtml', '.xht', '.shtml', '.mht', '.mhtml', '.svg', '.svgz',
  '.docm', '.dotm', '.xlsm', '.xltm', '.xlam', '.pptm', '.potm', '.ppam', '.ppsm', '.sldm',
]);

export const DEFAULT_MAX_FILE_MB = 50;
/** Microsoft Graph's simple upload, the one the SharePoint store uses (src/lib/storage.ts), goes no further. */
export const SHAREPOINT_MAX_FILE_MB = 250;

export type FileRules = { extensions: readonly string[]; maxBytes: number };

/**
 * The settings the rules read (CODEX_MAX_FILE_MB, CODEX_FILE_EXTENSIONS, CODEX_STORAGE): process.env on the server, never
 * on the client (the layout hands the rules down).
 */
type FileEnv = Readonly<Record<string, string | undefined>>;

/** Largest file, in bytes: CODEX_MAX_FILE_MB (50 by default), capped at 250 MB with the SharePoint store. */
export function maxFileBytes(env: FileEnv): number {
  const mb = Number(env.CODEX_MAX_FILE_MB);
  const wanted = Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_MAX_FILE_MB;
  return Math.floor((env.CODEX_STORAGE === 'sharepoint' ? Math.min(wanted, SHAREPOINT_MAX_FILE_MB) : wanted) * 1024 * 1024);
}

/**
 * Extensions admitted: CODEX_FILE_EXTENSIONS (the whole list, comma-separated, with or without the dot) or the default
 * one, never one of DENIED_EXTENSIONS. A list that leaves nothing falls back to the default.
 */
export function admittedExtensions(env: FileEnv): string[] {
  const raw = env.CODEX_FILE_EXTENSIONS?.trim();
  const list = (raw ? raw.split(',') : DEFAULT_EXTENSIONS)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .map((e) => (e.startsWith('.') ? e : `.${e}`))
    .filter((e) => /^\.[a-z0-9]{1,10}$/.test(e) && !DENIED_EXTENSIONS.has(e));
  const unique = [...new Set(list)];
  return unique.length ? unique : [...DEFAULT_EXTENSIONS];
}

export function fileRules(env: FileEnv): FileRules {
  return { extensions: admittedExtensions(env), maxBytes: maxFileBytes(env) };
}

/** Extension of a file name, lower case with its dot; '' for none (a leading dot alone, as in ".profile", is none). */
export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i).toLowerCase() : '';
}

/**
 * The name a received file is checked, recorded and named under: its last path segment (a browser sends none, but a
 * migration tool or a form posted before the page is hydrated may), without control or bidirectional characters, nor the
 * trailing separators, dots and spaces that would hide its extension ("procedure.hta/", "procedure.hta." are
 * "procedure.hta", as Windows would save them).
 */
export function cleanFileName(name: string): string {
  const flat = name.replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/[\\/\s.]+$/, '');
  return (flat.split(/[\\/]/).pop() ?? '').trim();
}

const ascii = (head: Uint8Array, at: number, text: string) =>
  head.length >= at + text.length && [...text].every((c, i) => head[at + i] === c.charCodeAt(0));
const bytes = (head: Uint8Array, at: number, sig: number[]) => head.length >= at + sig.length && sig.every((b, i) => head[at + i] === b);

// ── Containers: ZIP and compound files (OLE2) ────────────────────────────

/** Little-endian integers; -1 past the end of the bytes. */
const u16 = (h: Uint8Array, at: number) => (at >= 0 && at + 2 <= h.length ? h[at] | (h[at + 1] << 8) : -1);
const u32 = (h: Uint8Array, at: number) => (at >= 0 && at + 4 <= h.length ? (h[at] | (h[at + 1] << 8) | (h[at + 2] << 16)) + h[at + 3] * 0x1000000 : -1);
const u64 = (h: Uint8Array, at: number) => {
  const lo = u32(h, at), hi = u32(h, at + 4);
  return lo < 0 || hi < 0 ? -1 : lo + hi * 0x100000000;
};

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/**
 * Entry names of a ZIP file, read from its central directory (what Office and OpenDocument readers go by); null when
 * there is none to read: not a ZIP, or one cut short or damaged.
 */
export function zipEntries(h: Uint8Array): string[] | null {
  if (!bytes(h, 0, ZIP_MAGIC)) return null;
  // The end record (22 bytes) closes the file, followed only by a comment of up to 65 535 bytes.
  let end = -1;
  for (let i = h.length - 22; i >= Math.max(0, h.length - 22 - 0xffff); i--) {
    if (h[i] === 0x50 && h[i + 1] === 0x4b && h[i + 2] === 0x05 && h[i + 3] === 0x06) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  let count = u16(h, end + 10);
  let at = u32(h, end + 16);
  if (count === 0xffff || at === 0xffffffff) {
    // ZIP64: the real values are in the ZIP64 end record, which the locator just before the end record points to.
    if (!bytes(h, end - 20, [0x50, 0x4b, 0x06, 0x07])) return null;
    const rec = u64(h, end - 12);
    if (rec < 0 || !bytes(h, rec, [0x50, 0x4b, 0x06, 0x06])) return null;
    count = u64(h, rec + 32);
    at = u64(h, rec + 48);
  }
  const names: string[] = [];
  const utf8 = new TextDecoder();
  // Every entry takes 46 bytes at least: a count beyond what the bytes can hold stops at the first missing header.
  for (let n = 0; n < count; n++) {
    if (!bytes(h, at, [0x50, 0x4b, 0x01, 0x02])) return null;
    const len = u16(h, at + 28), extra = u16(h, at + 30), comment = u16(h, at + 32);
    if (len < 0 || extra < 0 || comment < 0 || at + 46 + len > h.length) return null;
    names.push(utf8.decode(h.subarray(at + 46, at + 46 + len)));
    at += 46 + len + extra + comment;
  }
  return names;
}

/** End of a chain of sectors in a compound file; any value from 0xFFFFFFFA up is no sector. */
const END_OF_CHAIN = 0xfffffffe;

/**
 * Names of the storages and streams of a compound file (OLE2: Office 97-2003, Project, Outlook, encrypted Office Open
 * XML), read from its directory through its allocation table (MS-CFB); null when it cannot be read: not a compound file,
 * or one cut short or damaged.
 */
export function cfbNames(h: Uint8Array): string[] | null {
  if (!bytes(h, 0, CFB_MAGIC) || h.length < 512) return null;
  const shift = u16(h, 0x1e);
  if (shift !== 9 && shift !== 12) return null;
  const size = 2 ** shift;
  const per = size / 4;
  // Sector n follows the header, which takes one sector.
  const offset = (sector: number) => (sector + 1) * size;
  const readable = (sector: number) => sector >= 0 && sector < 0xfffffffa && offset(sector) < h.length;
  /** Sector of the allocation table that holds its k-th part: 109 in the header, then a chain of DIFAT sectors. */
  const fatSector = (k: number): number => {
    if (k < 109) return u32(h, 0x4c + 4 * k);
    let sector = u32(h, 0x44);
    for (let j = k - 109, hops = 0; ; j -= per - 1, hops++) {
      if (!readable(sector) || hops > h.length / size) return -1;
      if (j < per - 1) return u32(h, offset(sector) + 4 * j);
      sector = u32(h, offset(sector) + 4 * (per - 1));
    }
  };
  const next = (sector: number): number => {
    const fat = fatSector(Math.floor(sector / per));
    return readable(fat) ? u32(h, offset(fat) + 4 * (sector % per)) : -1;
  };
  const names: string[] = [];
  const seen = new Set<number>();
  for (let sector = u32(h, 0x30); sector !== END_OF_CHAIN; sector = next(sector)) {
    if (!readable(sector) || seen.has(sector)) return null;
    seen.add(sector);
    // Entries of 128 bytes: the name in UTF-16LE (64 bytes), its length in bytes with the final NUL, then the type
    // (1 storage, 2 stream, 5 root; 0 unused).
    for (let at = offset(sector); at < offset(sector) + size && at + 128 <= h.length; at += 128) {
      const len = u16(h, at + 0x40);
      if (![1, 2, 5].includes(h[at + 0x42]) || len < 2 || len > 64 || len % 2) continue;
      let name = '';
      for (let i = 0; i < len / 2 - 1; i++) name += String.fromCharCode(u16(h, at + 2 * i));
      names.push(name);
    }
  }
  return names.length ? names : null;
}

/**
 * Whether a file carries VBA macros: a "vbaProject.bin" part in a ZIP (Office Open XML), a "_VBA_PROJECT" stream or
 * "_VBA_PROJECT_CUR" storage in a compound file (Word, Excel, Project 97-2003, and an Outlook message that embeds such a
 * file). Not seen here: PowerPoint 97-2003 macros (compressed inside the presentation), Excel 4.0 macro sheets, Basic
 * macros of OpenDocument files, and whatever an encrypted file holds; the virus scan is there for those.
 */
export function hasMacros(h: Uint8Array): boolean {
  const zip = zipEntries(h);
  if (zip) return zip.some((n) => /(^|\/)vbaproject\.bin$/i.test(n));
  return cfbNames(h)?.some((n) => /^_vba_project(_cur)?$/i.test(n)) ?? false;
}

const holds = (names: string[] | null, ...wanted: string[]) => !!names?.some((n) => wanted.includes(n.toLowerCase()));

const SIGNATURES: Record<Signature, (h: Uint8Array) => boolean> = {
  // A PDF reader accepts the header anywhere in the first kilobyte.
  pdf: (h) => {
    for (let i = 0; i <= Math.min(1024, h.length - 5); i++) if (ascii(h, i, '%PDF-')) return true;
    return false;
  },
  png: (h) => bytes(h, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpeg: (h) => bytes(h, 0, [0xff, 0xd8, 0xff]),
  gif: (h) => ascii(h, 0, 'GIF87a') || ascii(h, 0, 'GIF89a'),
  webp: (h) => ascii(h, 0, 'RIFF') && ascii(h, 8, 'WEBP'),
  tiff: (h) => bytes(h, 0, [0x49, 0x49, 0x2a, 0x00]) || bytes(h, 0, [0x4d, 0x4d, 0x00, 0x2a]),
  zip: (h) => bytes(h, 0, ZIP_MAGIC),
  // An Office Open XML package always has its content types; an OpenDocument package its type or its manifest.
  ooxml: (h) => holds(zipEntries(h), '[content_types].xml'),
  odf: (h) => holds(zipEntries(h), 'mimetype', 'meta-inf/manifest.xml'),
  ole2: (h) => cfbNames(h) !== null,
  ole2_encrypted: (h) => holds(cfbNames(h), 'encryptedpackage'),
  rtf: (h) => ascii(h, 0, '{\\rtf'),
  // AutoCAD R12 (AC1009) to 2018 (AC1032) and later.
  dwg: (h) => ascii(h, 0, 'AC10') && h.length >= 6 && h[4] >= 0x30 && h[4] <= 0x39 && h[5] >= 0x30 && h[5] <= 0x39,
  // ISO base media files (MP4, HEIC).
  ftyp: (h) => ascii(h, 4, 'ftyp'),
};

/** Signatures that name one format: what a file without extension is recognised by (ZIP and OLE2 hold several). */
const SELF_EVIDENT: readonly Signature[] = ['pdf', 'png', 'jpeg', 'gif', 'webp', 'tiff', 'rtf', 'dwg'];

/** A program, whatever its name: Windows (PE), Linux (ELF), macOS (Mach-O, also Java classes). */
export function isExecutable(h: Uint8Array): boolean {
  if (bytes(h, 0, [0x7f, 0x45, 0x4c, 0x46])) return true;
  for (const m of [[0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe], [0xca, 0xfe, 0xba, 0xbe]]) {
    if (bytes(h, 0, m)) return true;
  }
  // "MZ" alone also starts some text: a PE file has "PE\0\0" where its DOS header points.
  if (!ascii(h, 0, 'MZ') || h.length < 0x40) return false;
  const pe = h[0x3c] | (h[0x3d] << 8) | (h[0x3e] << 16) | (h[0x3f] << 24);
  return pe >= 0x40 && bytes(h, pe, [0x50, 0x45, 0x00, 0x00]);
}

export type FileIssue =
  | { code: 'too_large'; size: number; maxBytes: number }
  | { code: 'executable' }
  /** No extension, and a content that names no admitted format. */
  | { code: 'no_extension' }
  | { code: 'format'; ext: string }
  /** The content is not what its extension says. */
  | { code: 'signature'; ext: string }
  /** VBA macros (hasMacros), whatever the extension. */
  | { code: 'macros'; ext: string };

/**
 * Why a file may not enter Codex, or null. `head`: its first bytes (the whole file on the server, null in the browser,
 * where only the name and the size are checked). An extension not admitted is said first, with the list; a program is
 * refused whatever its name, a file with VBA macros whatever its extension. `name` is the one the file is recorded under
 * (cleanFileName on the server).
 */
export function fileIssue(name: string, size: number, head: Uint8Array | null, rules: FileRules): FileIssue | null {
  if (size > rules.maxBytes) return { code: 'too_large', size, maxBytes: rules.maxBytes };
  const ext = extensionOf(name);
  if (ext && !rules.extensions.includes(ext)) return { code: 'format', ext };
  if (head && isExecutable(head)) return { code: 'executable' };
  if (!ext) {
    if (!head) return null;
    // Recognised by its content alone, when it is a format admitted under one of its extensions.
    const known = SELF_EVIDENT.some((sig) => SIGNATURES[sig](head) && rules.extensions.some((e) => FORMATS[e]?.includes(sig)));
    return known ? null : { code: 'no_extension' };
  }
  const sigs = FORMATS[ext];
  if (head && sigs && !sigs.some((sig) => SIGNATURES[sig](head))) return { code: 'signature', ext };
  if (head && hasMacros(head)) return { code: 'macros', ext };
  return null;
}

/** The largest size, as said to the user: "50 Mo" rather than "50,0 Mo". */
export function fmtMax(bytes: number, lang: Lang): string {
  return fmtSize(bytes, lang).replace(/[.,]0 /, ' ');
}

/** The `accept` attribute of a file input: the admitted extensions. */
export function acceptAttr(rules: FileRules): string {
  return rules.extensions.join(',');
}

/** The refusal, in the user's language. */
export function fileIssueText(t: T, lang: Lang, issue: FileIssue, rules: FileRules): string {
  switch (issue.code) {
    case 'too_large': return t.file_too_large.replace('{size}', fmtSize(issue.size, lang)).replace('{max}', fmtMax(rules.maxBytes, lang));
    case 'executable': return t.file_executable;
    case 'no_extension': return t.file_no_extension.replace('{list}', rules.extensions.join(', '));
    case 'format': return t.file_format.replace('{ext}', issue.ext).replace('{list}', rules.extensions.join(', '));
    case 'signature': return t.file_signature.replace('{ext}', issue.ext);
    case 'macros': return t.file_macros;
  }
}

/** The same refusal, short, for a sentence that names the file (the copy of a template: actions.ts). */
export function fileIssueReason(t: T, lang: Lang, issue: FileIssue): string {
  switch (issue.code) {
    case 'too_large': return t.file_reason_too_large.replace('{size}', fmtSize(issue.size, lang)).replace('{max}', fmtMax(issue.maxBytes, lang));
    case 'executable': return t.file_reason_executable;
    case 'no_extension': return t.file_reason_no_extension;
    case 'format': return t.file_reason_format.replace('{ext}', issue.ext);
    case 'signature': return t.file_reason_signature.replace('{ext}', issue.ext);
    case 'macros': return t.file_reason_macros;
  }
}
