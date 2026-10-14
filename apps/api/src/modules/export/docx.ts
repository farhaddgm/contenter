import JSZip from 'jszip';
import { persianShare, type ExportRow } from '@contenter/shared';

/**
 * A minimal Word document (docs/55-bulk-export.md): the parts Word needs and nothing else, so
 * there is no layout library to trust. Persian text gets right-to-left paragraphs, complex-script
 * runs and a font that has Persian letters; Latin text keeps left-to-right. Markdown in a body is
 * written as plain text, not rendered. The bytes are the same for the same rows.
 */

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const FONT = 'Tahoma';
const FIXED_DATE = new Date(Date.UTC(2000, 0, 1));

/** Characters XML 1.0 can hold: tab, line feed, carriage return and everything from space up (minus U+FFFE/U+FFFF). */
function xmlAllowed(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code !== 0xfffe && code !== 0xffff)
  );
}

/** Drops what XML cannot hold and escapes the five markup characters. */
export function xmlText(s: string): string {
  let out = '';
  for (const ch of s) {
    if (!xmlAllowed(ch.codePointAt(0)!)) continue;
    out +=
      ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : ch;
  }
  return out;
}

function run(
  text: string,
  rtl: boolean,
  o: { bold?: boolean; sizeHalfPt?: number; color?: string } = {},
) {
  const size = o.sizeHalfPt ?? 24;
  const props = [
    `<w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/>`,
    o.bold ? '<w:b/><w:bCs/>' : '',
    o.color ? `<w:color w:val="${o.color}"/>` : '',
    `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`,
    rtl ? '<w:rtl/><w:lang w:bidi="fa-IR"/>' : '',
  ].join('');
  return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${xmlText(text)}</w:t></w:r>`;
}

function paragraph(
  text: string,
  rtl: boolean,
  o: {
    style?: string;
    pageBreakBefore?: boolean;
    bold?: boolean;
    sizeHalfPt?: number;
    color?: string;
  } = {},
) {
  const ppr = [
    o.style ? `<w:pStyle w:val="${o.style}"/>` : '',
    o.pageBreakBefore ? '<w:pageBreakBefore/>' : '',
    // no explicit alignment: a bidi paragraph starts on the right, a Latin one on the left
    rtl ? '<w:bidi/>' : '',
  ].join('');
  return `<w:p><w:pPr>${ppr}</w:pPr>${text ? run(text, rtl, o) : ''}</w:p>`;
}

const hashtag = (h: string) => (h.startsWith('#') ? h : `#${h}`);

function documentXml(rows: readonly ExportRow[]): string {
  const body: string[] = [];
  rows.forEach((r, i) => {
    // a mostly-Persian content is written right to left; a mostly-Latin one is not
    const rtl = persianShare(`${r.title}\n${r.body}`) >= 0.3;
    const meta = [r.topic, r.platform, r.format, r.status].join(' · ');
    body.push(
      paragraph(r.title, rtl, {
        style: 'Heading1',
        pageBreakBefore: i > 0,
        bold: true,
        sizeHalfPt: 32,
      }),
      // the facts are Latin codes and a topic name: keep this line left-to-right so they do not reorder
      paragraph(meta, false, { sizeHalfPt: 18, color: '666666' }),
    );
    for (const line of r.body.replace(/\r\n?/g, '\n').split('\n'))
      body.push(paragraph(line.trimEnd(), rtl));
    if (r.cta.trim()) body.push(paragraph(`👉 ${r.cta.trim()}`, rtl, { bold: true }));
    if (r.hashtags.length)
      body.push(paragraph(r.hashtags.map(hashtag).join(' '), rtl, { color: '1F4E79' }));
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US" w:bidi="fa-IR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="320" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style></w:styles>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

export async function contentsToDocx(rows: readonly ExportRow[]): Promise<Buffer> {
  const zip = new JSZip();
  const opts = { date: FIXED_DATE, createFolders: false };
  zip.file('[Content_Types].xml', CONTENT_TYPES, opts);
  zip.file('_rels/.rels', ROOT_RELS, opts);
  zip.file('word/document.xml', documentXml(rows), opts);
  zip.file('word/styles.xml', STYLES, opts);
  zip.file('word/_rels/document.xml.rels', DOC_RELS, opts);
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
