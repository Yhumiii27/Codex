import 'server-only';
import { getDb } from '@/db';
import type { Ctx } from './context';
import { journalConsultation } from './lifecycle';
import { diffLines, type LineDiff } from './line-diff';
import { logger } from './log';
import { readableVersions, type ReadableVersion } from './queries';
import { FileNotFoundError, normalizeMime, readStored, sha256Of, storedExt } from './storage';
import { extractLimits, extractText, textFormat, type Extracted, type ExtractFailure } from './text-extract';

// Comparison of the content of two versions of a document (point 14 of docs/reste-a-faire.md, G05): the text of each
// file (lib/text-extract.ts), then its differences line by line (lib/line-diff.ts). Read through the file route's
// rules (lib/queries.ts readableVersions, D-14): outside the drafting circle, only the final file of the revision in
// force can be compared, that is, with nothing else. Each version compared is journaled as a consultation ("B.2 ·
// Comparaison"), as viewing it would be. GET /api/documents/[id]/compare?a=&b= (route), limited by CODEX_RATE_COMPARE.

const log = logger('compare');

/** One side of the comparison: the version, and why its text could not be read when it could not. */
export type CompareSide = { id: number; label: string; lines: number | null; truncated: boolean; failure: ExtractFailure | null };

export type CompareResult = {
  a: CompareSide;
  b: CompareSide;
  /** Same bytes on both sides (same recorded SHA-256). */
  sameFile: boolean;
  /** Null when either text is missing. */
  diff: LineDiff | null;
};

/** Longest text shown of one line: a PDF without line breaks can give one of several thousand characters. */
const MAX_LINE_SHOWN = 2_000;
/** Comparisons running at once in this process; beyond, 'busy' (503). */
const MAX_RUNNING = 3;

/** Texts recently extracted, by fingerprint and format: comparing B.2 with B.1 then B.3 reads B.2 once. */
const CACHE_SIZE = 6;
type Cached = { key: string; value: Extracted };
type State = { running: number; cache: Cached[] };
const state: State = ((globalThis as unknown as { __codexCompare?: State }).__codexCompare ??= { running: 0, cache: [] });

async function textOf(v: ReadableVersion, labels: { sheet: string; slide: string }): Promise<Extracted> {
  const { version } = v;
  if (!version.fileKey) return { ok: false, reason: 'no_file' };
  const name = version.fileName ?? '';
  const mime = normalizeMime(version.mime, name);
  const format = textFormat(storedExt(name, mime), mime);
  if (!format) return { ok: false, reason: 'unsupported' };
  const limits = extractLimits(process.env);
  if (version.size != null && version.size > limits.maxBytes) return { ok: false, reason: 'too_large' };
  const key = version.sha256 ? `${version.sha256}:${format}:${labels.sheet}:${labels.slide}` : null;
  const hit = key && state.cache.find((c) => c.key === key);
  if (hit) return hit.value;
  let buf: Buffer;
  try {
    buf = await readStored(version.storage, version.fileKey);
  } catch (err) {
    if (!(err instanceof FileNotFoundError)) log.error('store unreachable', { version: version.id, err });
    return { ok: false, reason: 'unavailable' };
  }
  // A file that is no longer the one recorded is not compared (lib/integrity-core.mjs).
  if (version.sha256 && sha256Of(buf) !== version.sha256) {
    log.error('stored file altered: not compared', { version: version.id });
    return { ok: false, reason: 'altered' };
  }
  const value = await extractText(buf, format, limits, labels);
  if (key && (value.ok || value.reason !== 'timeout')) {
    state.cache.unshift({ key, value });
    state.cache.length = Math.min(state.cache.length, CACHE_SIZE);
  }
  return value;
}

const side = (id: number, label: string, x: Extracted): CompareSide =>
  x.ok ? { id, label, lines: x.lines.length, truncated: x.truncated, failure: null } : { id, label, lines: null, truncated: false, failure: x.reason };

/**
 * Compares versions `a` (the older, or the one picked) and `b` (the current one) of a document. Null when the document
 * or either version is not one the user may have (the route answers 404 for both, as the file route would); 'busy' when
 * too many comparisons run.
 */
export async function compareVersions(ctx: Ctx, docId: string, a: number, b: number): Promise<CompareResult | 'busy' | null> {
  const found = await readableVersions(ctx, docId, [a, b]);
  const va = found?.versions.get(a);
  const vb = found?.versions.get(b);
  if (!found || !va || !vb) return null;
  if (state.running >= MAX_RUNNING) return 'busy';
  state.running++;
  try {
    const labels = { sheet: ctx.t.compare_sheet, slide: ctx.t.compare_slide };
    // One after the other: two large PDFs at once would double the memory taken.
    const ta = await textOf(va, labels);
    const tb = a === b ? ta : await textOf(vb, labels);
    const db = await getDb();
    for (const v of a === b ? [va] : [va, vb]) await journalConsultation(db, ctx.user.id, 'view', found.doc.id, `${v.label} · Comparaison`, v.version.revisionId, { text: { code: 'compared', params: { label: v.label } } });
    let diff: LineDiff | null = null;
    if (ta.ok && tb.ok) {
      diff = diffLines(ta.lines, tb.lines);
      if (diff.kind === 'diff') {
        for (const h of diff.hunks) for (const l of h.lines) if (l.text.length > MAX_LINE_SHOWN) l.text = `${l.text.slice(0, MAX_LINE_SHOWN)}…`;
      }
    }
    const sameFile = !!va.version.sha256 && va.version.sha256 === vb.version.sha256;
    return { a: side(a, va.label, ta), b: side(b, vb.label, tb), sameFile, diff };
  } finally {
    state.running--;
  }
}
