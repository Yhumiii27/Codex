import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { compareFile, hashStream, verifiedStream } from '@/lib/integrity-core.mjs';

// The rules of the integrity check (lib/integrity-core.mjs, point 31 of docs/reste-a-faire.md): what counts as altered,
// when a missing fingerprint may be recorded, and how a whole download is checked on the way.

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const chunks = (...parts: string[]) => new ReadableStream<Uint8Array>({
  start(c) {
    for (const p of parts) c.enqueue(new TextEncoder().encode(p));
    c.close();
  },
});

/** Reads a stream to its end or its error: the bytes received, and the error if any. */
async function drain(stream: ReadableStream<Uint8Array>) {
  const got: string[] = [];
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { got, error: null };
      got.push(new TextDecoder().decode(value));
    }
  } catch (error) {
    return { got, error };
  }
}

describe('compareFile', () => {
  it('compares with the recorded fingerprint when there is one, whatever the size says', () => {
    expect(compareFile({ sha256: sha('a'), size: 1 }, { sha256: sha('a'), size: 1 })).toBe('ok');
    expect(compareFile({ sha256: sha('a'), size: 1 }, { sha256: sha('b'), size: 1 })).toBe('altered');
  });

  it('records a missing fingerprint only when nothing tells the bytes changed: same size, or no size recorded', () => {
    expect(compareFile({ sha256: null, size: 3 }, { sha256: sha('abc'), size: 3 })).toBe('fill');
    expect(compareFile({ sha256: null, size: null }, { sha256: sha('abc'), size: 3 })).toBe('fill');
    expect(compareFile({ sha256: null, size: 4 }, { sha256: sha('abc'), size: 3 })).toBe('altered');
  });
});

describe('hashStream', () => {
  it('gives the SHA-256 and size of the whole stream', async () => {
    expect(await hashStream(Readable.from([Buffer.from('ab'), Buffer.from('c')]))).toEqual({ sha256: sha('abc'), size: 3 });
  });
});

describe('verifiedStream', () => {
  it('passes every byte of a file that matches', async () => {
    const onMismatch = vi.fn(async () => {});
    expect(await drain(verifiedStream(chunks('ab', 'cd', 'ef'), sha('abcdef'), onMismatch))).toEqual({ got: ['ab', 'cd', 'ef'], error: null });
    expect(onMismatch).not.toHaveBeenCalled();
  });

  it('holds back the last chunk of an altered file and fails, so that it never arrives whole', async () => {
    const onMismatch = vi.fn(async () => {});
    const { got, error } = await drain(verifiedStream(chunks('ab', 'cd', 'ef'), sha('abcdeX'), onMismatch));
    expect(got).toEqual(['ab', 'cd']);
    expect(error).toBeInstanceOf(Error);
    expect(onMismatch).toHaveBeenCalledOnce();
  });

  it('fails even when the journal cannot be written', async () => {
    const { got, error } = await drain(verifiedStream(chunks('x'), sha('y'), async () => { throw new Error('journal down'); }));
    expect(got).toEqual([]);
    expect(String(error)).toContain('altered');
  });

  it('checks an empty file too', async () => {
    expect(await drain(verifiedStream(chunks(), sha(''), async () => {}))).toEqual({ got: [], error: null });
    expect((await drain(verifiedStream(chunks(), sha('x'), async () => {}))).error).toBeInstanceOf(Error);
  });
});
