import { crc32, deflateRawSync } from 'node:zlib';

// Minimal Office Open XML and OpenDocument files for the tests of the text comparison (src/lib/text-extract.ts): a ZIP
// written here (deflated entries, central directory), holding only the parts the extraction reads.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A ZIP of these entries, each deflated (or stored with `stored`). */
export function zip(entries: Record<string, string | Buffer>, opts: { stored?: boolean } = {}): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const packed = opts.stored ? data : deflateRawSync(data);
    const method = opts.stored ? 0 : 8;
    const fname = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fname.length, 26);
    locals.push(local, fname, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(packed.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(fname.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, fname);
    offset += 30 + fname.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

const TYPES = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>';

const DOCX_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const DOCX_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';

/** A Word document LibreOffice and Word open: one paragraph per string (a tab as w:tab). */
export function docx(paragraphs: string[]): Buffer {
  const body = paragraphs.map((p) => `<w:p><w:pPr><w:jc w:val="left"/></w:pPr>${p.split('\t').map((part, i) => `${i ? '<w:r><w:tab/></w:r>' : ''}<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${esc(part)}</w:t></w:r>`).join('')}</w:p>`).join('');
  return zip({
    '[Content_Types].xml': DOCX_TYPES,
    '_rels/.rels': DOCX_RELS,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:p><w:r><w:delText>supprimé</w:delText></w:r><w:r><w:instrText> PAGE </w:instrText></w:r></w:p><w:sectPr/></w:body></w:document>`,
  });
}

/** A workbook: sheets by name, each a list of rows (strings as shared strings, numbers as values). */
export function xlsx(sheets: Record<string, (string | number)[][]>): Buffer {
  const shared: string[] = [];
  const entries: Record<string, string> = { '[Content_Types].xml': TYPES };
  const names = Object.keys(sheets);
  names.forEach((name, i) => {
    const rows = sheets[name].map((row, r) => `<row r="${r + 1}">${row.map((v, c) => {
      const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
      if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
      shared.push(v);
      return `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`;
    }).join('')}</row>`).join('');
    entries[`xl/worksheets/sheet${i + 1}.xml`] = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  });
  entries['xl/sharedStrings.xml'] = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${shared.map((v) => `<si><t>${esc(v)}</t></si>`).join('')}</sst>`;
  entries['xl/workbook.xml'] = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  entries['xl/_rels/workbook.xml.rels'] = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`;
  return zip(entries);
}

/** A presentation: one slide per list of paragraphs. */
export function pptx(slides: string[][]): Buffer {
  const entries: Record<string, string> = { '[Content_Types].xml': TYPES, 'ppt/presentation.xml': '<p:presentation xmlns:p="p"/>' };
  slides.forEach((paras, i) => {
    entries[`ppt/slides/slide${i + 1}.xml`] = `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:txBody>${paras.map((t) => `<a:p><a:r><a:t>${esc(t)}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  });
  return zip(entries);
}

/** An OpenDocument text: one paragraph per string. */
export function odt(paragraphs: string[]): Buffer {
  return zip({
    mimetype: 'application/vnd.oasis.opendocument.text',
    'content.xml': `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="o" xmlns:text="t"><office:body><office:text>${paragraphs.map((p) => `<text:p text:style-name="P1">${esc(p).replace(/ {2}/g, ' <text:s/>')}</text:p>`).join('')}</office:text></office:body></office:document-content>`,
    'META-INF/manifest.xml': '<manifest:manifest xmlns:manifest="m"/>',
  });
}
