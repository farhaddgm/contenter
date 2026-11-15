import JSZip from 'jszip';

/** Most rows and columns read from one sheet; the rest is cut (a business document, not a database). */
export const XLSX_MAX_ROWS = 5000;
export const XLSX_MAX_COLS = 60;
/** Largest XML part (uncompressed) that is read; guards against a zip bomb. */
const MAX_PART_BYTES = 40_000_000;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** Text of every `<t>` in a shared string / inline string item (rich-text runs are joined). */
const textOf = (xml: string) =>
  [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1]!)).join('');

const attr = (tag: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

/** "AB12" → 27 (zero-based column of the cell reference). */
export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

async function part(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path);
  if (!file) return null;
  const size = (file as unknown as { _data?: { uncompressedSize?: number } })._data
    ?.uncompressedSize;
  if (typeof size === 'number' && size > MAX_PART_BYTES) {
    throw new Error('The spreadsheet is too large to read');
  }
  return file.async('string');
}

/** The rows of one sheet as arrays of cell text (empty cells kept inside, trailing ones dropped). */
export function sheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    if (rows.length >= XLSX_MAX_ROWS) break;
    const cells: string[] = [];
    for (const c of (rowMatch[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const head = c[1] ?? '';
      const body = c[2] ?? '';
      const col = columnIndex(attr(head, 'r') ?? '');
      if (col < 0 || col >= XLSX_MAX_COLS) continue;
      const type = attr(head, 't');
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = '';
      if (type === 'inlineStr') text = textOf(body);
      else if (v !== undefined) {
        if (type === 's') text = shared[Number(v)] ?? '';
        else if (type === 'b') text = v === '1' ? 'TRUE' : 'FALSE';
        else text = decode(v);
      }
      while (cells.length < col) cells.push('');
      cells[col] = text;
    }
    while (cells.length && cells[cells.length - 1] === '') cells.pop();
    rows.push(cells);
  }
  while (rows.length && !rows[rows.length - 1]!.length) rows.pop();
  return rows;
}

/**
 * Text of an .xlsx workbook (an uploaded Excel file, or a Google Sheet exported as xlsx): every
 * sheet, in workbook order, as `## name` followed by its rows as CSV. Formulas show their last
 * saved value. Pure code; throws when the file is not a readable workbook.
 */
export async function xlsxToText(buffer: Buffer | Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const workbook = await part(zip, 'xl/workbook.xml');
  if (!workbook) throw new Error('This is not an Excel workbook');
  const rels = (await part(zip, 'xl/_rels/workbook.xml.rels')) ?? '';
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = attr(m[1]!, 'Id');
    const t = attr(m[1]!, 'Target');
    if (id && t) target.set(id, t.startsWith('/') ? t.slice(1) : `xl/${t}`);
  }
  const sst = await part(zip, 'xl/sharedStrings.xml');
  const shared = sst
    ? [...sst.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!))
    : [];

  const out: string[] = [];
  for (const s of workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const name = decode(attr(s[1]!, 'name') ?? '');
    const rid = attr(s[1]!, 'r:id');
    const path = rid ? target.get(rid) : undefined;
    const xml = path ? await part(zip, path) : null;
    if (!xml) continue;
    const rows = sheetRows(xml, shared);
    if (!rows.length) continue;
    out.push(`## ${name}\n${rows.map((r) => r.map(csvCell).join(',')).join('\n')}`);
  }
  return out.join('\n\n');
}
