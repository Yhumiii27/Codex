import { ZipReadError, zipDirectory, zipEntry } from './zip-read';

// Text of a stored file, for the comparison of two versions (point 14 of docs/reste-a-faire.md, G05; lib/compare.ts).
// What is compared is the running text, line by line, not the layout: PDF (text layer, through pdf.js packaged by
// unpdf; a scan without text layer gives nothing), Word, Excel and PowerPoint (Office Open XML: the ZIP and its XML read
// here), OpenDocument, and plain text formats. Office 97-2003 files (.doc, .xls, .ppt), images and drawings are not
// read: the comparison says so rather than guess.
//
// Bounds: the file (CODEX_COMPARE_MAX_MB, 20 MB by default), what each ZIP entry unpacks to, the pages of a PDF, the
// lines and characters kept (beyond them the text is cut and the comparison says so) and the time given (beyond it the
// extraction stops). No 'server-only': pure apart from unpdf, loaded only for a PDF; tested in tests/unit.

export type TextFormat = 'pdf' | 'text' | 'docx' | 'xlsx' | 'pptx' | 'odf';

/** Why there is no text to compare. */
/** `no_file`, `unavailable` (not in the store) and `altered` (not the bytes recorded) are found by lib/compare.ts. */
export type ExtractFailure = 'unsupported' | 'too_large' | 'timeout' | 'unreadable' | 'encrypted' | 'empty' | 'no_file' | 'unavailable' | 'altered';

export type Extracted = { ok: true; lines: string[]; truncated: boolean } | { ok: false; reason: ExtractFailure };

export type ExtractLimits = {
  /** Largest file read, in bytes. */
  maxBytes: number;
  /** Lines kept, and characters in all; beyond, the text is cut (`truncated`). */
  maxLines: number;
  maxChars: number;
  /** Pages of a PDF read at most; beyond, cut. */
  maxPages: number;
  /** Largest XML entry once unpacked, in bytes. */
  maxEntryBytes: number;
  /** Instant (Date.now()) beyond which the extraction gives up. */
  deadline: number;
};

export const DEFAULT_COMPARE_MAX_MB = 20;
export const EXTRACT_TIME_MS = 15_000;

/** Bounds of an extraction started now; `env`: CODEX_COMPARE_MAX_MB (megabytes, 1 to 200). */
export function extractLimits(env: Record<string, string | undefined>, now = Date.now()): ExtractLimits {
  const raw = Number(env.CODEX_COMPARE_MAX_MB?.trim());
  const mb = Number.isFinite(raw) && raw >= 1 && raw <= 200 ? raw : DEFAULT_COMPARE_MAX_MB;
  return { maxBytes: Math.floor(mb * 1024 * 1024), maxLines: 20_000, maxChars: 2_000_000, maxPages: 1_000, maxEntryBytes: 50 * 1024 * 1024, deadline: now + EXTRACT_TIME_MS };
}

const TEXT_EXTS = new Set(['.txt', '.csv', '.log', '.json', '.xml', '.eml']);
const BY_EXT: Record<string, TextFormat> = {
  '.pdf': 'pdf', '.docx': 'docx', '.dotx': 'docx', '.xlsx': 'xlsx', '.xltx': 'xlsx', '.pptx': 'pptx', '.potx': 'pptx', '.odt': 'odf', '.ods': 'odf', '.odp': 'odf',
};

/**
 * How the text of a stored file is read, by the extension it is stored with (lib/storage.ts storedExt) and its type
 * (normalised); null when it is not.
 */
export function textFormat(ext: string, mime: string | null): TextFormat | null {
  if (mime === 'application/pdf') return 'pdf';
  ext = ext.toLowerCase();
  if (BY_EXT[ext]) return BY_EXT[ext];
  if (TEXT_EXTS.has(ext) || mime === 'text/plain' || mime === 'text/csv') return 'text';
  return null;
}

class Timeout extends Error {}
class Encrypted extends Error {}

/** Labels written between the parts of a workbook or a presentation: "[Feuille : Budget]", "[Diapositive 3]". */
export type PartLabels = { sheet: string; slide: string };

/**
 * The text of `buf` as lines: blanks collapsed, empty lines left out (the layout is not compared). Never throws: a
 * failure is a reason.
 */
export async function extractText(buf: Buffer, format: TextFormat, limits: ExtractLimits, labels: PartLabels): Promise<Extracted> {
  if (buf.length > limits.maxBytes) return { ok: false, reason: 'too_large' };
  const out = new Lines(limits);
  try {
    if (format === 'text') out.addText(decodeText(buf));
    else if (format === 'pdf') await pdfText(buf, out, limits);
    else officeText(buf, format, out, limits, labels);
  } catch (err) {
    if (err instanceof Timeout) return { ok: false, reason: 'timeout' };
    if (err instanceof Encrypted) return { ok: false, reason: 'encrypted' };
    if (err instanceof ZipReadError) return { ok: false, reason: err.reason === 'too_large' ? 'too_large' : err.reason === 'unsupported' ? 'unsupported' : 'unreadable' };
    if (err instanceof Full) return { ok: true, lines: out.lines, truncated: true };
    if ((err as Error)?.name === 'PasswordException') return { ok: false, reason: 'encrypted' };
    return { ok: false, reason: 'unreadable' };
  }
  if (!out.lines.length) return { ok: false, reason: 'empty' };
  return { ok: true, lines: out.lines, truncated: false };
}

class Full extends Error {}

/** Lines gathered, cut at the bounds (Full). */
class Lines {
  lines: string[] = [];
  private chars = 0;
  constructor(private readonly limits: ExtractLimits) {}
  add(line: string) {
    const l = line.replace(/[\s ​]+/g, ' ').trim();
    if (!l) return;
    if (this.lines.length >= this.limits.maxLines || this.chars + l.length > this.limits.maxChars) throw new Full();
    this.lines.push(l);
    this.chars += l.length;
  }
  addText(text: string) {
    for (const l of text.split(/\r\n|\r|\n/)) this.add(l);
  }
  tick() {
    if (Date.now() > this.limits.deadline) throw new Timeout();
  }
}

/** Windows-1252 characters 0x80-0x9F, which differ from Latin-1 (Node's TextDecoder may decode them as Latin-1). */
const CP1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';

/** UTF-8 (BOM dropped), else Windows-1252, as a text file written on a French workstation may be. */
export function decodeText(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buf);
  } catch {
    return buf.toString('latin1').replace(/[\u0080-\u009f]/g, (c) => CP1252[c.charCodeAt(0) - 0x80]);
  }
}

// ── PDF ─────────────────────────────────────────────────────────────────

type TextItem = { str?: string; hasEOL?: boolean };

async function pdfText(buf: Buffer, out: Lines, limits: ExtractLimits) {
  const { getDocumentProxy } = await import('unpdf');
  // A copy: pdf.js takes the buffer over. No eval, no fonts loaded, errors only.
  const loading = getDocumentProxy(new Uint8Array(buf), { isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0, stopAtErrors: false });
  let pdf: Awaited<typeof loading>;
  try {
    pdf = await withDeadline(loading, limits.deadline);
  } catch (err) {
    // Opened after the deadline: released then.
    loading.then((late) => late.destroy(), () => {});
    throw err;
  }
  try {
    const pages = Math.min(pdf.numPages, limits.maxPages);
    for (let n = 1; n <= pages; n++) {
      out.tick();
      const page = await withDeadline(pdf.getPage(n), limits.deadline);
      const content = await withDeadline(page.getTextContent(), limits.deadline);
      let line = '';
      for (const item of content.items as TextItem[]) {
        line += item.str ?? '';
        if (item.hasEOL) {
          out.add(line);
          line = '';
        }
      }
      out.add(line);
      page.cleanup();
    }
    if (pdf.numPages > limits.maxPages) throw new Full();
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

async function withDeadline<T>(p: Promise<T>, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Timeout()), Math.max(0, deadline - Date.now())); })]);
  } finally {
    clearTimeout(timer);
  }
}

// ── Office Open XML and OpenDocument ────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** XML character data as text: the five named entities and numeric references. */
export function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

const TOKEN = /<(\/?)([\w.:-]+)([^>]*?)(\/?)>|([^<]+)|<!\[CDATA\[([\s\S]*?)\]\]>|<[!?][^>]*>/g;

/**
 * Lines of a WordprocessingML or DrawingML part: the text of `<p:t>` runs (`ns`: w, a), one line per paragraph, `tab` and
 * `br` as such. Deleted text of a tracked change (`w:delText`) and field codes (`w:instrText`) are not text.
 */
export function ooxmlLines(xml: string, ns: 'w' | 'a', out: { add(l: string): void }) {
  let line = '';
  let inText = false;
  for (const m of xml.matchAll(TOKEN)) {
    const [, close, tag, , self, text] = m;
    if (text !== undefined) {
      if (inText) line += unescapeXml(text);
      continue;
    }
    if (!tag) continue;
    if (tag === `${ns}:t`) inText = !close && !self;
    else if (!close && (tag === `${ns}:tab`)) line += '\t';
    else if (!close && (tag === `${ns}:br` || tag === `${ns}:cr`)) {
      out.add(line);
      line = '';
    } else if (close && tag === `${ns}:p`) {
      out.add(line);
      line = '';
    }
  }
  out.add(line);
}

/** Lines of an OpenDocument content.xml: one per paragraph or heading; text:s, text:tab and text:line-break as such. */
export function odfLines(xml: string, out: { add(l: string): void }) {
  let line = '';
  let depth = 0;
  for (const m of xml.matchAll(TOKEN)) {
    const [, close, tag, attrs, self, text] = m;
    if (text !== undefined) {
      if (depth > 0) line += unescapeXml(text);
      continue;
    }
    if (!tag) continue;
    if (tag === 'text:p' || tag === 'text:h') {
      if (self) continue;
      if (close) {
        depth = Math.max(0, depth - 1);
        if (depth === 0) {
          out.add(line);
          line = '';
        }
      } else depth++;
    } else if (depth > 0 && !close) {
      if (tag === 'text:s') line += ' '.repeat(Math.min(Number(/text:c="(\d+)"/.exec(attrs)?.[1] ?? 1), 100));
      else if (tag === 'text:tab') line += '\t';
      else if (tag === 'text:line-break') {
        out.add(line);
        line = '';
      }
    }
  }
  out.add(line);
}

/** Column number of a cell reference ("C12" → 2). */
function columnOf(ref: string): number {
  let n = 0;
  for (const ch of /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? '') n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

/** Text runs (`<t>`) of a fragment, joined: a shared string or an inline string. */
function runs(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('');
}

/** One line per row of a worksheet: its cells in their columns, separated by " | "; formulas give their last value. */
export function sheetLines(xml: string, shared: string[], out: { add(l: string): void }) {
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], body = c[2] ?? '';
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const value = type === 's' ? (shared[Number(v)] ?? '') : type === 'inlineStr' ? runs(body) : v !== undefined ? unescapeXml(v) : '';
      if (!value) continue;
      const col = columnOf(/\br="([A-Z]+\d+)"/i.exec(attrs)?.[1] ?? '') || cells.length;
      while (cells.length < Math.min(col, 1000)) cells.push('');
      cells.push(value);
    }
    out.add(cells.join(' | '));
  }
}

const byNumber = (prefix: string) => (a: string, b: string) => Number(a.slice(prefix.length).replace(/\D/g, '')) - Number(b.slice(prefix.length).replace(/\D/g, ''));

function officeText(buf: Buffer, format: Exclude<TextFormat, 'pdf' | 'text'>, out: Lines, limits: ExtractLimits, labels: PartLabels) {
  const dir = zipDirectory(buf);
  const part = (name: string) => {
    out.tick();
    const b = zipEntry(buf, dir, name, limits.maxEntryBytes);
    return b ? b.toString('utf8') : null;
  };
  if (format === 'odf') {
    if (dir.has('META-INF/manifest.xml') && /manifest:encryption-data/.test(part('META-INF/manifest.xml') ?? '')) throw new Encrypted();
    const xml = part('content.xml');
    if (xml === null) throw new ZipReadError('damaged');
    odfLines(xml, out);
    return;
  }
  if (format === 'docx') {
    const xml = part('word/document.xml');
    if (xml === null) throw new ZipReadError('damaged');
    ooxmlLines(xml, 'w', out);
    return;
  }
  if (format === 'pptx') {
    const slides = [...dir.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(byNumber('ppt/slides/slide'));
    if (!slides.length && !dir.has('ppt/presentation.xml')) throw new ZipReadError('damaged');
    slides.forEach((name, i) => {
      out.add(`[${labels.slide} ${i + 1}]`);
      ooxmlLines(part(name) ?? '', 'a', out);
    });
    return;
  }
  // Workbook: shared strings, then each sheet in the workbook's order, under its name.
  const sharedXml = part('xl/sharedStrings.xml');
  const shared = sharedXml ? [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => runs(m[1])) : [];
  const workbook = part('xl/workbook.xml');
  if (workbook === null) throw new ZipReadError('damaged');
  const rels = part('xl/_rels/workbook.xml.rels') ?? '';
  const target = new Map([...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => [/\bId="([^"]+)"/.exec(m[1])?.[1] ?? '', /\bTarget="([^"]+)"/.exec(m[1])?.[1] ?? '']));
  for (const s of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = unescapeXml(/\bname="([^"]*)"/.exec(s[1])?.[1] ?? '');
    const rid = /\br:id="([^"]+)"/.exec(s[1])?.[1] ?? '';
    const t = target.get(rid);
    if (!t) continue;
    const path = t.startsWith('/') ? t.slice(1) : `xl/${t}`;
    out.add(`[${labels.sheet} : ${name}]`);
    sheetLines(part(path) ?? '', shared, out);
  }
}
