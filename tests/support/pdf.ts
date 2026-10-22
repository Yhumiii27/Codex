// Reads back a PDF written by src/lib/pdf.ts the way a reader does: header, cross-reference table (each offset must
// point at its object), trailer, catalog, page tree (its count must match its kids), then the content stream of each
// page; the strings shown with Tj are decoded from WinAnsi and grouped into rows by baseline, left to right. Only
// uncompressed streams are read, which is what lib/pdf.ts writes.

/** WinAnsi bytes 0x80-0x9F that differ from Latin-1. */
const HIGH: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž',
  0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

export type PdfRead = {
  /** Rows of text of each page, top to bottom; the pieces of a row (label and value) joined by a space. */
  pages: string[][];
  /** Every row of every page, joined by line breaks. */
  text: string;
  title: string | null;
  /** Font of each piece of text, by its text: F1 regular, F2 bold. */
  fonts: Map<string, string>;
};

function fail(message: string): never {
  throw new Error(`readPdf: ${message}`);
}

/** Decodes a literal string of a content stream (the part between the parentheses). */
function literal(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    let ch = raw[i];
    if (ch === '\\') {
      const next = raw[++i];
      const oct = /^[0-7]{1,3}/.exec(raw.slice(i));
      if (oct) {
        ch = String.fromCharCode(parseInt(oct[0], 8));
        i += oct[0].length - 1;
      } else {
        ch = ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<string, string>)[next] ?? next;
      }
    }
    const code = ch.charCodeAt(0);
    out += HIGH[code] ?? ch;
  }
  return out;
}

export function readPdf(buf: Buffer): PdfRead {
  const src = buf.toString('latin1');
  if (!src.startsWith('%PDF-1.')) fail('no PDF header');
  const start = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(src);
  if (!start) fail('no startxref');
  const xrefAt = Number(start[1]);
  const xref = /^xref\s+0 (\d+)\s+/.exec(src.slice(xrefAt));
  if (!xref) fail('startxref does not point at the xref table');
  const count = Number(xref[1]);
  const offsets: number[] = [];
  const table = src.slice(xrefAt + xref[0].length);
  for (let n = 0; n < count; n++) {
    const entry = table.slice(n * 20, n * 20 + 20);
    if (!/^\d{10} \d{5} [fn] \n$/.test(entry)) fail(`bad xref entry ${n}`);
    offsets.push(Number(entry.slice(0, 10)));
  }
  const trailer = src.slice(src.indexOf('trailer', xrefAt));
  const ref = (body: string, key: string) => {
    const m = new RegExp(`/${key} (\\d+) 0 R`).exec(body);
    return m ? Number(m[1]) : null;
  };
  const obj = (n: number) => {
    if (n <= 0 || n >= count) fail(`object ${n} out of the xref table`);
    const head = `${n} 0 obj\n`;
    if (!src.startsWith(head, offsets[n])) fail(`xref offset of object ${n} is wrong`);
    const from = offsets[n] + head.length;
    return src.slice(from, src.indexOf('\nendobj', from));
  };

  const root = ref(trailer, 'Root') ?? fail('no Root');
  const pagesRef = ref(obj(root), 'Pages') ?? fail('no Pages');
  const tree = obj(pagesRef);
  const kids = [...(/\/Kids \[([^\]]*)\]/.exec(tree)?.[1] ?? '').matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
  const declared = Number(/\/Count (\d+)/.exec(tree)?.[1] ?? -1);
  if (declared !== kids.length) fail(`page count ${declared} for ${kids.length} pages`);

  const fonts = new Map<string, string>();
  const pages = kids.map((k) => {
    const contents = ref(obj(k), 'Contents') ?? fail(`page ${k} without contents`);
    const body = obj(contents);
    const length = Number(/\/Length (\d+)/.exec(body)?.[1] ?? fail('stream without length'));
    const from = body.indexOf('stream\n') + 'stream\n'.length;
    const stream = body.slice(from, from + length);
    if (!body.slice(from + length).startsWith('\nendstream')) fail('stream length is wrong');
    const runs: { x: number; y: number; text: string }[] = [];
    let read = 0;
    for (const op of stream.matchAll(/BT [\d.]+ [\d.]+ [\d.]+ rg \/(F\d) [\d.]+ Tf ([\d.]+) ([\d.]+) Td \(((?:\\.|[^\\)])*)\) Tj ET\n/g)) {
      if (op.index !== read) fail(`unreadable content at ${read}: ${stream.slice(read, read + 80)}`);
      read += op[0].length;
      const text = literal(op[4]);
      fonts.set(text, op[1]);
      runs.push({ x: Number(op[2]), y: Number(op[3]), text });
    }
    if (read !== stream.length) fail(`unreadable content at ${read}: ${stream.slice(read, read + 80)}`);
    const rows = new Map<number, { x: number; text: string }[]>();
    for (const r of runs) rows.set(r.y, [...(rows.get(r.y) ?? []), r]);
    return [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, row]) => row.sort((a, b) => a.x - b.x).map((r) => r.text).join(' '));
  });

  const info = ref(trailer, 'Info');
  const hex = info ? /\/Title <([0-9A-F]+)>/.exec(obj(info))?.[1] : undefined;
  const title = hex ? Buffer.from(hex.slice(4), 'hex').swap16().toString('utf16le') : null;
  return { pages, text: pages.map((p) => p.join('\n')).join('\n'), title, fonts };
}
