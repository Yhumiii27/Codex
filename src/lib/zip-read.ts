import { inflateRawSync } from 'node:zlib';

// Reading entries of a ZIP file (Office Open XML, OpenDocument) for the text comparison of versions (lib/text-extract.ts).
// Only what those files use: stored (0) and deflated (8) entries, from the central directory; no ZIP64, no encryption.
// Every entry read is bounded: what it unpacks to (`maxBytes`), whatever its header claims (a "ZIP bomb" stops there).

/** The ZIP cannot be read: not a ZIP, damaged, encrypted, ZIP64, or an entry beyond the bound. */
export class ZipReadError extends Error {
  constructor(readonly reason: 'not_zip' | 'damaged' | 'unsupported' | 'too_large') {
    super(`zip: ${reason}`);
  }
}

type Entry = { name: string; method: number; flags: number; compressed: number; size: number; local: number };

const u16 = (b: Buffer, at: number) => (at + 2 <= b.length ? b.readUInt16LE(at) : -1);
const u32 = (b: Buffer, at: number) => (at + 4 <= b.length ? b.readUInt32LE(at) : -1);

/** The entries of the central directory, by name. */
export function zipDirectory(buf: Buffer): Map<string, Entry> {
  if (u32(buf, 0) !== 0x04034b50) throw new ZipReadError('not_zip');
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (u32(buf, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new ZipReadError('damaged');
  const count = u16(buf, end + 10);
  let at = u32(buf, end + 16);
  if (count === 0xffff || at === 0xffffffff) throw new ZipReadError('unsupported');
  const out = new Map<string, Entry>();
  const utf8 = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (u32(buf, at) !== 0x02014b50) throw new ZipReadError('damaged');
    const flags = u16(buf, at + 8), method = u16(buf, at + 10);
    const compressed = u32(buf, at + 20), size = u32(buf, at + 24);
    const len = u16(buf, at + 28), extra = u16(buf, at + 30), comment = u16(buf, at + 32);
    const local = u32(buf, at + 42);
    if (len < 0 || extra < 0 || comment < 0 || local < 0 || at + 46 + len > buf.length) throw new ZipReadError('damaged');
    const name = utf8.decode(buf.subarray(at + 46, at + 46 + len));
    out.set(name, { name, method, flags, compressed, size, local });
    at += 46 + len + extra + comment;
  }
  return out;
}

/**
 * The bytes of one entry, at most `maxBytes` once unpacked; null when the ZIP has no such entry. Throws ZipReadError
 * when it cannot be read.
 */
export function zipEntry(buf: Buffer, dir: Map<string, Entry>, name: string, maxBytes: number): Buffer | null {
  const e = dir.get(name);
  if (!e) return null;
  if (e.flags & 0x1) throw new ZipReadError('unsupported');
  if (e.size > maxBytes) throw new ZipReadError('too_large');
  if (u32(buf, e.local) !== 0x04034b50) throw new ZipReadError('damaged');
  const start = e.local + 30 + u16(buf, e.local + 26) + u16(buf, e.local + 28);
  const end = start + e.compressed;
  if (start < 0 || end > buf.length) throw new ZipReadError('damaged');
  const raw = buf.subarray(start, end);
  if (e.method === 0) return raw;
  if (e.method !== 8) throw new ZipReadError('unsupported');
  try {
    return inflateRawSync(raw, { maxOutputLength: maxBytes });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE' || err instanceof RangeError) throw new ZipReadError('too_large');
    throw new ZipReadError('damaged');
  }
}
