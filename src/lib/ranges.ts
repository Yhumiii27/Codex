// Byte ranges and conditional requests on the files Codex serves (src/app/api/documents/[id]/file/route.ts), after
// RFC 9110 §13 and §14. Pure: the route resolves access first, then asks this module what to answer.

/** Bytes `start` … `end`, both included. */
export type ByteRange = { start: number; end: number };

/**
 * What a Range header asks of a representation of `size` bytes:
 * - `full`: no Range, a unit other than bytes, or several ranges (multipart/byteranges is not offered: the whole file
 *   is a valid answer to them);
 * - `partial`: one satisfiable range, its end clamped to the last byte;
 * - `invalid`: a bytes range that is malformed (`bytes=5-2`, `bytes=x`) or starts beyond the last byte, answered 416.
 */
export type RangeAsk = { kind: 'full' } | { kind: 'partial'; range: ByteRange } | { kind: 'invalid' };

const UNIT = /^\s*([!#$%&'*+.^_`|~0-9A-Za-z-]+)\s*=(.*)$/;

export function parseRange(header: string | null, size: number): RangeAsk {
  if (header == null) return { kind: 'full' };
  const m = UNIT.exec(header);
  if (!m) return { kind: 'invalid' };
  if (m[1].toLowerCase() !== 'bytes') return { kind: 'full' };
  const specs = m[2].split(',').map((x) => x.trim()).filter(Boolean);
  if (!specs.length) return { kind: 'invalid' };
  if (specs.length > 1) return { kind: 'full' };
  const spec = specs[0];
  const suffix = /^-(\d+)$/.exec(spec);
  if (suffix) {
    const n = Number(suffix[1]);
    // The last n bytes; none of an empty file.
    return n > 0 && size > 0 ? { kind: 'partial', range: { start: Math.max(0, size - n), end: size - 1 } } : { kind: 'invalid' };
  }
  const span = /^(\d+)-(\d*)$/.exec(spec);
  if (!span) return { kind: 'invalid' };
  const start = Number(span[1]);
  const last = span[2] === '' ? null : Number(span[2]);
  if (last !== null && last < start) return { kind: 'invalid' };
  if (start >= size) return { kind: 'invalid' };
  return { kind: 'partial', range: { start, end: last === null ? size - 1 : Math.min(last, size - 1) } };
}

/** Entity tags of an If-None-Match or If-Range value, `*` kept as is. */
function entityTags(header: string): string[] {
  return header.match(/\*|(?:W\/)?"[^"]*"/g) ?? [];
}

const opaque = (tag: string) => tag.replace(/^W\//, '');

/** If-None-Match by weak comparison: `*` or one of its tags equal to `etag`, W/ prefixes aside. */
export function noneMatchHits(header: string, etag: string): boolean {
  return entityTags(header).some((x) => x === '*' || opaque(x) === opaque(etag));
}

/** HTTP dates have whole seconds. */
const toSecond = (d: Date) => Math.floor(d.getTime() / 1000) * 1000;

/**
 * If-Range: the range applies only to the representation the client already holds part of. A strong tag equal to
 * `etag`, or a date equal to Last-Modified; a weak tag never matches (strong comparison).
 */
export function ifRangeHolds(header: string, etag: string, modified: Date | null): boolean {
  const v = header.trim();
  if (v.startsWith('"')) return v === etag;
  if (v.startsWith('W/')) return false;
  const at = Date.parse(v);
  return !!modified && !Number.isNaN(at) && at === toSecond(modified);
}

export type FileAnswer = { status: 200 } | { status: 206; range: ByteRange } | { status: 304 } | { status: 416 };

/**
 * What to answer a GET or HEAD for a file the user may have, of `size` bytes (null when unknown: no range then), with
 * validators `etag` and `modified`:
 * - 304 when the client's copy is current: If-None-Match, else If-Modified-Since (a date in the future is ignored).
 *   Only when `conditional`, for a file the browser may keep: an explicit download always sends the file, which is how
 *   it is journaled, and a file the browser must not keep is always sent whole;
 * - for a GET, 206 with one range, 416 for a range it cannot satisfy; a Range whose If-Range no longer holds, or a HEAD
 *   (RFC 9110 §14.2: Range is for GET), gets the whole file.
 */
export function fileAnswer(
  headers: Headers,
  x: { method: 'GET' | 'HEAD'; size: number | null; etag: string; modified: Date | null; conditional: boolean; now?: number },
): FileAnswer {
  if (x.conditional) {
    const inm = headers.get('if-none-match');
    if (inm != null) {
      if (noneMatchHits(inm, x.etag)) return { status: 304 };
    } else {
      const since = Date.parse(headers.get('if-modified-since') ?? '');
      if (x.modified && !Number.isNaN(since) && since <= (x.now ?? Date.now()) && toSecond(x.modified) <= since) return { status: 304 };
    }
  }
  const range = headers.get('range');
  if (x.method !== 'GET' || x.size == null || range == null) return { status: 200 };
  const ifRange = headers.get('if-range');
  if (ifRange != null && !ifRangeHolds(ifRange, x.etag, x.modified)) return { status: 200 };
  const ask = parseRange(range, x.size);
  return ask.kind === 'partial' ? { status: 206, range: ask.range } : ask.kind === 'invalid' ? { status: 416 } : { status: 200 };
}

/**
 * Bytes `start` … `end` of a stream that holds the whole file: for a store that answered a range with the whole file.
 * Stops reading the source once the range is out.
 */
export function sliceStream(body: ReadableStream<Uint8Array>, { start, end }: ByteRange): ReadableStream<Uint8Array> {
  let pos = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, out) {
      const from = Math.max(start - pos, 0);
      const to = Math.min(end + 1 - pos, chunk.length);
      if (from < to) out.enqueue(chunk.subarray(from, to));
      pos += chunk.length;
      if (pos > end) out.terminate();
    },
  }));
}
