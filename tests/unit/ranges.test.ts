import { describe, expect, it } from 'vitest';
import { fileAnswer, ifRangeHolds, noneMatchHits, parseRange, sliceStream } from '@/lib/ranges';

// Byte ranges and conditional requests of the file route (src/lib/ranges.ts, RFC 9110 §13-14; point 46 of
// docs/reste-a-faire.md). tests/integration/file-stream.test.ts covers the route itself.

describe('parseRange', () => {
  it('reads one range: closed, open, suffix; clamps its end to the last byte', () => {
    expect(parseRange('bytes=0-9', 100)).toEqual({ kind: 'partial', range: { start: 0, end: 9 } });
    expect(parseRange('bytes=90-', 100)).toEqual({ kind: 'partial', range: { start: 90, end: 99 } });
    expect(parseRange('bytes=-10', 100)).toEqual({ kind: 'partial', range: { start: 90, end: 99 } });
    expect(parseRange('bytes=-500', 100)).toEqual({ kind: 'partial', range: { start: 0, end: 99 } });
    expect(parseRange('bytes=50-5000', 100)).toEqual({ kind: 'partial', range: { start: 50, end: 99 } });
    expect(parseRange('bytes=99-99', 100)).toEqual({ kind: 'partial', range: { start: 99, end: 99 } });
    expect(parseRange(' Bytes = 1-2 ', 100)).toEqual({ kind: 'partial', range: { start: 1, end: 2 } });
  });

  it('serves the whole file without Range, for another unit, or for several ranges', () => {
    expect(parseRange(null, 100)).toEqual({ kind: 'full' });
    expect(parseRange('items=0-9', 100)).toEqual({ kind: 'full' });
    expect(parseRange('bytes=0-9,20-29', 100)).toEqual({ kind: 'full' });
    expect(parseRange('bytes=0-9, -5', 100)).toEqual({ kind: 'full' });
  });

  it('refuses a malformed range or one that starts beyond the file', () => {
    for (const h of ['bytes=100-', 'bytes=100-200', 'bytes=9-3', 'bytes=-0', 'bytes=abc', 'bytes=1.5-2', 'bytes=', 'bytes=,', 'bytes=--1', 'bytes', '0-9', `bytes=${'9'.repeat(30)}-`]) {
      expect(parseRange(h, 100), h).toEqual({ kind: 'invalid' });
    }
  });

  it('has no range of an empty file', () => {
    expect(parseRange('bytes=0-', 0)).toEqual({ kind: 'invalid' });
    expect(parseRange('bytes=-1', 0)).toEqual({ kind: 'invalid' });
  });
});

describe('validators', () => {
  const tag = '"abc"';
  const modified = new Date('2026-09-05T10:00:00.750Z');

  it('compares If-None-Match weakly, in a list, with *', () => {
    expect(noneMatchHits('"abc"', tag)).toBe(true);
    expect(noneMatchHits('W/"abc"', tag)).toBe(true);
    expect(noneMatchHits('"x", "abc"', tag)).toBe(true);
    expect(noneMatchHits('*', tag)).toBe(true);
    expect(noneMatchHits('"abcd"', tag)).toBe(false);
    expect(noneMatchHits('abc', tag)).toBe(false);
  });

  it('compares If-Range strongly: a weak tag or another date does not hold', () => {
    expect(ifRangeHolds('"abc"', tag, modified)).toBe(true);
    expect(ifRangeHolds('W/"abc"', tag, modified)).toBe(false);
    expect(ifRangeHolds('"x"', tag, modified)).toBe(false);
    // HTTP dates have whole seconds.
    expect(ifRangeHolds('Sat, 05 Sep 2026 10:00:00 GMT', tag, modified)).toBe(true);
    expect(ifRangeHolds('Sat, 05 Sep 2026 10:00:01 GMT', tag, modified)).toBe(false);
    expect(ifRangeHolds('Sat, 05 Sep 2026 10:00:00 GMT', tag, null)).toBe(false);
    expect(ifRangeHolds('not a date', tag, modified)).toBe(false);
  });
});

describe('fileAnswer', () => {
  const NOW = Date.parse('2026-10-15T08:00:00Z');
  type Ask = Parameters<typeof fileAnswer>[1];
  const base: Ask = { method: 'GET', size: 100, etag: '"abc"', modified: new Date('2026-09-05T10:00:00Z'), conditional: true, now: NOW };
  const ask = (h: Record<string, string>, x: Partial<Ask> = {}) => fileAnswer(new Headers(h), { ...base, ...x });

  it('answers 304 to a current copy: If-None-Match first, else If-Modified-Since', () => {
    expect(ask({ 'If-None-Match': '"abc"' })).toEqual({ status: 304 });
    expect(ask({ 'If-Modified-Since': 'Sat, 05 Sep 2026 10:00:00 GMT' })).toEqual({ status: 304 });
    expect(ask({ 'If-Modified-Since': 'Fri, 04 Sep 2026 10:00:00 GMT' })).toEqual({ status: 200 });
    // If-None-Match present and not matching: If-Modified-Since is ignored.
    expect(ask({ 'If-None-Match': '"x"', 'If-Modified-Since': 'Sat, 05 Sep 2026 10:00:00 GMT' })).toEqual({ status: 200 });
    // A date in the future, or no Last-Modified, never gives 304.
    expect(ask({ 'If-Modified-Since': 'Sun, 01 Nov 2026 00:00:00 GMT' })).toEqual({ status: 200 });
    expect(ask({ 'If-Modified-Since': 'Sat, 05 Sep 2026 10:00:00 GMT' }, { modified: null })).toEqual({ status: 200 });
  });

  it('never answers 304 when the answer is not conditional (a download, a file the browser must not keep)', () => {
    expect(ask({ 'If-None-Match': '"abc"' }, { conditional: false })).toEqual({ status: 200 });
    expect(ask({ 'If-Modified-Since': 'Sat, 05 Sep 2026 10:00:00 GMT' }, { conditional: false })).toEqual({ status: 200 });
    expect(ask({ 'If-None-Match': '"abc"', Range: 'bytes=0-1' }, { conditional: false })).toEqual({ status: 206, range: { start: 0, end: 1 } });
  });

  it('gives 206 or 416 for a GET with a range, the whole file to a HEAD or when the size is unknown', () => {
    expect(ask({ Range: 'bytes=10-19' })).toEqual({ status: 206, range: { start: 10, end: 19 } });
    expect(ask({ Range: 'bytes=100-' })).toEqual({ status: 416 });
    expect(ask({ Range: 'bytes=10-19' }, { method: 'HEAD' })).toEqual({ status: 200 });
    expect(ask({ Range: 'bytes=10-19' }, { size: null })).toEqual({ status: 200 });
    // 304 comes before the range.
    expect(ask({ Range: 'bytes=10-19', 'If-None-Match': '"abc"' })).toEqual({ status: 304 });
  });

  it('applies the range only while If-Range holds', () => {
    expect(ask({ Range: 'bytes=10-19', 'If-Range': '"abc"' })).toEqual({ status: 206, range: { start: 10, end: 19 } });
    expect(ask({ Range: 'bytes=10-19', 'If-Range': '"old"' })).toEqual({ status: 200 });
    expect(ask({ Range: 'bytes=500-', 'If-Range': '"old"' })).toEqual({ status: 200 });
  });
});

describe('sliceStream', () => {
  const chunks = (parts: number[][]) => new ReadableStream<Uint8Array>({
    start(c) {
      parts.forEach((p) => c.enqueue(Uint8Array.from(p)));
      c.close();
    },
  });
  const read = async (s: ReadableStream<Uint8Array>) => [...new Uint8Array(await new Response(s).arrayBuffer())];

  it('keeps the bytes of the range across chunk boundaries', async () => {
    const src = chunks([[0, 1, 2], [3, 4, 5, 6], [7, 8, 9]]);
    expect(await read(sliceStream(src, { start: 2, end: 7 }))).toEqual([2, 3, 4, 5, 6, 7]);
    expect(await read(sliceStream(chunks([[0, 1, 2, 3]]), { start: 0, end: 0 }))).toEqual([0]);
    expect(await read(sliceStream(chunks([[0, 1], [2, 3]]), { start: 3, end: 3 }))).toEqual([3]);
  });

  it('stops reading its source once the range is out', async () => {
    let pulled = 0;
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(4).fill(pulled));
      },
      cancel() {
        cancelled = true;
      },
    });
    expect(await read(sliceStream(endless, { start: 2, end: 5 }))).toEqual([1, 1, 2, 2]);
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(10);
  });
});
