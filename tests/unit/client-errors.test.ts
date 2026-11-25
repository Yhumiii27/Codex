import { describe, expect, it } from 'vitest';
import { clientReport, isClientRef, newClientRef, readClientReport } from '@/lib/client-errors';
import { errorRef } from '@/lib/errors';

// Errors of the browser (lib/client-errors.ts, point 49 of docs/reste-a-faire.md): a reference of their own, and a report
// that carries the error's name, the first line of its message, its frames and the page's path, never its query string.

describe('client error reports', () => {
  it('a reference of 16 hexadecimal digits, readable as a reference by the error screens', () => {
    const ref = newClientRef((a) => a.fill(0xab));
    expect(ref).toBe('nav-abababababababab');
    expect(isClientRef(ref)).toBe(true);
    expect(errorRef({ digest: ref })).toBe(ref);
    expect(newClientRef()).not.toBe(newClientRef());
    expect(isClientRef('nav-xyz')).toBe(false);
  });

  it('keeps the name, the first line of the message, the frames and the path without its query string', () => {
    const err = new TypeError('Cannot read properties of undefined\nsecond line with what the page showed');
    err.stack = 'TypeError: Cannot read…\n    at render (http://codex.test/_next/static/chunks/app.js:1:200)\n    at x (http://codex.test/a.js:2:3)\nnot a frame';
    const r = clientReport(err, 'nav-0000000000000001', '/documents/PRO-QUA-0001?tab=history#top');
    expect(r).toEqual({
      ref: 'nav-0000000000000001', name: 'TypeError', message: 'Cannot read properties of undefined', path: '/documents/PRO-QUA-0001',
      frames: ['at render (http://codex.test/_next/static/chunks/app.js:1:200)', 'at x (http://codex.test/a.js:2:3)'],
    });
    // WebKit and Firefox write their frames « f@url:line:column ».
    expect(clientReport({ name: 'Error', message: 'x', stack: 'f@http://codex.test/a.js:3:4' }, 'nav-0000000000000001', '/').frames).toEqual(['f@http://codex.test/a.js:3:4']);
  });

  it('reads again what a browser sends: refuses a report without a valid reference, cuts the rest', () => {
    expect(readClientReport(null)).toBeNull();
    expect(readClientReport({ ref: 'anything' })).toBeNull();
    const r = readClientReport({ ref: 'nav-0123456789abcdef', name: '', message: 'm'.repeat(1000), path: '//evil.example/x', frames: ['at a', 3, ...Array(20).fill('at b')], extra: 'dropped' });
    expect(r).not.toBeNull();
    expect(r!.name).toBe('Error');
    expect(r!.message.length).toBeLessThanOrEqual(301);
    expect(r!.path).toBe('/');
    expect(r!.frames.length).toBe(8);
    expect(Object.keys(r!).sort()).toEqual(['frames', 'message', 'name', 'path', 'ref']);
  });
});
