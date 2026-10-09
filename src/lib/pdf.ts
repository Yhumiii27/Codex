// Minimal single-page PDF writer, used to hand out a stand-in file for records that have no stored file yet
// (the seeded demo documents). Text is set in Helvetica with WinAnsi encoding.

const WIN_ANSI: Record<string, number> = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, 'œ': 0x9c, 'Œ': 0x8c, '›': 0x9b, '‹': 0x8b };

function encode(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const code = WIN_ANSI[ch] ?? ch.charCodeAt(0);
    const byte = code <= 0xff ? code : 0x3f; // '?' for anything outside WinAnsi
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out.push(0x5c);
    out.push(byte);
  }
  return out;
}

export type PdfLine = { text: string; size?: number; gap?: number; grey?: boolean };

export function simplePdf(lines: PdfLine[]): Buffer {
  const chunks: number[][] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (bytes: number[]) => { chunks.push(bytes); length += bytes.length; };
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

  // Page content stream.
  const content: number[] = [];
  let y = 770;
  for (const l of lines) {
    const size = l.size ?? 11;
    y -= l.gap ?? size * 1.6;
    content.push(...ascii(`BT ${l.grey ? '0.45 0.47 0.55 rg' : '0.16 0.17 0.19 rg'} /F1 ${size} Tf 64 ${y.toFixed(1)} Td (`), ...encode(l.text), ...ascii(') Tj ET\n'));
  }

  const objects: number[][] = [
    ascii('<< /Type /Catalog /Pages 2 0 R >>'),
    ascii('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    ascii('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'),
    ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
    [...ascii(`<< /Length ${content.length} >>\nstream\n`), ...content, ...ascii('\nendstream')],
  ];

  push([...ascii('%PDF-1.4\n'), 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);
  objects.forEach((body, i) => {
    offsets.push(length);
    push([...ascii(`${i + 1} 0 obj\n`), ...body, ...ascii('\nendobj\n')]);
  });
  const xref = length;
  push(ascii(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`));
  push(ascii(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return Buffer.from(chunks.flat());
}
