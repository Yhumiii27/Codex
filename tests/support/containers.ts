import { crc32 } from 'node:zlib';

// Minimal but well-formed containers, to test what src/lib/filetypes.ts reads of them (zipEntries, cfbNames): a ZIP of
// stored entries, and a compound file (OLE2, MS-CFB) whose directory lists the given streams.

/** A ZIP whose entries are stored uncompressed; `zip64` writes the end records of a ZIP64 file. */
export function zip(entries: [name: string, content: string | Buffer][], { zip64 = false } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let at = 0;
  for (const [name, content] of entries) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const file = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(file.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(file.length, 28);
    central.writeUInt32LE(at, 42);
    locals.push(local, file, data);
    centrals.push(central, file);
    at += local.length + file.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  if (!zip64) {
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(at, 16);
    return Buffer.concat([...locals, directory, end]);
  }
  const record = Buffer.alloc(56);
  record.writeUInt32LE(0x06064b50, 0);
  record.writeBigUInt64LE(BigInt(44), 4);
  record.writeUInt16LE(45, 12);
  record.writeUInt16LE(45, 14);
  record.writeBigUInt64LE(BigInt(entries.length), 24);
  record.writeBigUInt64LE(BigInt(entries.length), 32);
  record.writeBigUInt64LE(BigInt(directory.length), 40);
  record.writeBigUInt64LE(BigInt(at), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(at + directory.length), 8);
  locator.writeUInt32LE(1, 16);
  end.writeUInt16LE(0xffff, 8);
  end.writeUInt16LE(0xffff, 10);
  end.writeUInt32LE(0xffffffff, 12);
  end.writeUInt32LE(0xffffffff, 16);
  return Buffer.concat([...locals, directory, record, locator, end]);
}

const FREE = 0xffffffff;
const END_OF_CHAIN = 0xfffffffe;
const FAT_SECTOR = 0xfffffffd;

/**
 * A compound file whose directory holds a root entry and one empty stream per name. `shift`: 9 (512-byte sectors,
 * version 3) or 12 (4096, version 4). `dirAt`: the directory's first sector; from 109 × (sector size / 4) on, the part of
 * the allocation table that chains it is found through a DIFAT sector rather than the header.
 */
export function cfb(names: string[], { shift = 9, dirAt = 1 }: { shift?: 9 | 12; dirAt?: number } = {}): Buffer {
  const size = 2 ** shift;
  const per = size / 4;
  const entries = ['Root Entry', ...names];
  const dirSectors = Math.ceil((entries.length * 128) / size);
  const part = Math.floor(dirAt / per);
  if (Math.floor((dirAt + dirSectors - 1) / per) !== part) throw new Error('directory across two parts of the table');
  // Sector 0 holds the part of the allocation table that chains the directory; sector 1, when needed, the DIFAT sector.
  const viaDifat = part >= 109;
  if (dirAt < (viaDifat ? 2 : 1)) throw new Error('directory over the table');
  const buf = Buffer.alloc((dirAt + dirSectors + 1) * size);
  const sector = (n: number) => (n + 1) * size;

  buf.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  buf.writeUInt16LE(0x3e, 0x18);
  buf.writeUInt16LE(shift === 9 ? 3 : 4, 0x1a);
  buf.writeUInt16LE(0xfffe, 0x1c);
  buf.writeUInt16LE(shift, 0x1e);
  buf.writeUInt16LE(6, 0x20);
  buf.writeUInt32LE(1, 0x2c);
  buf.writeUInt32LE(dirAt, 0x30);
  buf.writeUInt32LE(4096, 0x38);
  buf.writeUInt32LE(END_OF_CHAIN, 0x3c);
  for (let i = 0; i < 109; i++) buf.writeUInt32LE(FREE, 0x4c + 4 * i);
  if (viaDifat) {
    buf.writeUInt32LE(1, 0x44);
    buf.writeUInt32LE(1, 0x48);
    for (let i = 0; i < per; i++) buf.writeUInt32LE(FREE, sector(1) + 4 * i);
    buf.writeUInt32LE(0, sector(1) + 4 * (part - 109));
    buf.writeUInt32LE(END_OF_CHAIN, sector(1) + 4 * (per - 1));
  } else {
    buf.writeUInt32LE(END_OF_CHAIN, 0x44);
    buf.writeUInt32LE(0, 0x4c + 4 * part);
  }

  for (let i = 0; i < per; i++) buf.writeUInt32LE(FREE, sector(0) + 4 * i);
  if (part === 0) buf.writeUInt32LE(FAT_SECTOR, sector(0));
  for (let d = 0; d < dirSectors; d++) {
    const n = dirAt + d;
    buf.writeUInt32LE(d === dirSectors - 1 ? END_OF_CHAIN : n + 1, sector(0) + 4 * (n % per));
  }

  entries.forEach((name, i) => {
    const at = sector(dirAt) + 128 * i;
    buf.write(name, at, 'utf16le');
    buf.writeUInt16LE((name.length + 1) * 2, at + 0x40);
    buf[at + 0x42] = i === 0 ? 5 : 2;
    buf[at + 0x43] = 1;
    buf.writeUInt32LE(FREE, at + 0x44);
    buf.writeUInt32LE(i > 0 && i < entries.length - 1 ? i + 1 : FREE, at + 0x48);
    buf.writeUInt32LE(i === 0 && entries.length > 1 ? 1 : FREE, at + 0x4c);
    buf.writeUInt32LE(END_OF_CHAIN, at + 0x74);
  });
  return buf;
}
