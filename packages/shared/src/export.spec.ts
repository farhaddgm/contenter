import { describe, expect, it } from 'vitest';
import {
  EXPORT_CSV_COLUMNS,
  EXPORT_MAX_ITEMS,
  ExportContentsSchema,
  contentToMarkdown,
  contentsToCsv,
  contentsToMarkdown,
  csvCell,
  exportFileName,
  exportSlug,
  type ExportRow,
} from './export';

const row = (over: Partial<ExportRow> = {}): ExportRow => ({
  id: 'c1',
  topic: 'آموزش قهوه',
  platform: 'INSTAGRAM',
  format: 'POST',
  status: 'APPROVED',
  version: 2,
  title: 'قهوهٔ تازه',
  body: 'قهوه را تازه آسیاب کنید.\n\nبا ۲ قاشق شکر، "عالی" می‌شود.',
  hashtags: ['قهوه', '#تازه'],
  cta: 'همین حالا سفارش بدهید',
  scheduledAt: '2026-12-01T09:00:00.000Z',
  publishedAt: null,
  createdAt: '2026-10-01T08:00:00.000Z',
  ...over,
});

describe('csvCell', () => {
  it('quotes, doubles inner quotes and keeps newlines inside the cell', () => {
    expect(csvCell('او گفت "سلام"\nخط دوم')).toBe('"او گفت ""سلام""\nخط دوم"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(3)).toBe('3');
  });

  it.each(['=SUM(A1)', '+1+1', '-2+3', '@cmd', '\t=1', '\r=1'])(
    'a cell that starts like a formula (%j) gets a leading apostrophe',
    (v) => {
      expect(csvCell(v)).toBe(`"'${v}"`);
    },
  );

  it('leaves ordinary text alone, even with a formula character inside', () => {
    expect(csvCell('قیمت = ۱۰ دلار')).toBe('"قیمت = ۱۰ دلار"');
    expect(csvCell('۱۲۳')).toBe('"۱۲۳"');
  });
});

describe('contentsToCsv', () => {
  it('starts with a BOM, uses CRLF, fixed columns, and writes Persian text and digits as they are', () => {
    const csv = contentsToCsv([row()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe(EXPORT_CSV_COLUMNS.map((c) => `"${c}"`).join(','));
    expect(csv).toContain('"قهوهٔ تازه"');
    expect(csv).toContain('با ۲ قاشق شکر');
    expect(csv).toContain('"#قهوه #تازه"');
    expect(csv).toContain(',2,');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('guards every text column, not only the title', () => {
    const csv = contentsToCsv([
      row({ title: '=HYPERLINK("x")', body: '@x', cta: '-1', topic: '+t' }),
    ]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(`"'@x"`);
    expect(csv).toContain(`"'-1"`);
    expect(csv).toContain(`"'+t"`);
  });

  it('an empty list is only the header, and the same input gives the same text', () => {
    expect(contentsToCsv([]).slice(1).split('\r\n')).toHaveLength(2);
    expect(contentsToCsv([row()])).toBe(contentsToCsv([row()]));
  });
});

describe('contentToMarkdown', () => {
  it('has YAML front matter, the title, the body, the call to action and the hashtags', () => {
    const md = contentToMarkdown(row());
    expect(md.startsWith('---\nid: "c1"\ntitle: "قهوهٔ تازه"\n')).toBe(true);
    expect(md).toContain('scheduledAt: "2026-12-01T09:00:00.000Z"');
    expect(md).toContain('publishedAt: null');
    expect(md).toContain('hashtags: ["#قهوه", "#تازه"]');
    expect(md).toContain('\n---\n\n# قهوهٔ تازه\n\nقهوه را تازه آسیاب کنید.');
    expect(md).toContain('\n\n👉 همین حالا سفارش بدهید\n\n#قهوه #تازه\n');
  });

  it('a quote or colon in a value cannot break the front matter', () => {
    const md = contentToMarkdown(row({ title: 'او گفت: "نه"\nخط', topic: "a: 'b'" }));
    expect(md).toContain('title: "او گفت: \\"نه\\"\\nخط"');
    const front = md.split('---')[1]!;
    expect(front.split('\n').filter((l) => l && !/^[a-zA-Z]+: /.test(l))).toEqual([]);
  });

  it('leaves out an empty call to action and no hashtags', () => {
    const md = contentToMarkdown(row({ cta: ' ', hashtags: [] }));
    expect(md).not.toContain('👉');
    expect(md).toContain('hashtags: []');
    expect(md.trimEnd().endsWith('می‌شود.')).toBe(true);
  });

  it('several contents are their documents one after the other', () => {
    const md = contentsToMarkdown([row({ id: 'a' }), row({ id: 'b' })]);
    expect(md.match(/^---\nid: /gm)).toHaveLength(2);
  });
});

describe('file names', () => {
  it('makes a Persian slug with one spelling, no punctuation and at most 60 characters', () => {
    expect(exportSlug('قهوهٔ تازه؟ كافه‌ي «ما»!')).toBe('قهوه-تازه-کافه-ی-ما');
    expect(exportSlug('  ')).toBe('content');
    expect(exportSlug('!!!')).toBe('content');
    expect([...exportSlug('الف '.repeat(40))].length).toBeLessThanOrEqual(60);
    expect(exportSlug('Hello, World 2026')).toBe('hello-world-2026');
  });

  it('numbers the files so equal titles stay distinct and the order is kept', () => {
    expect(exportFileName(0, 'قهوه', 'md')).toBe('001-قهوه.md');
    expect(exportFileName(11, 'قهوه', 'md')).toBe('012-قهوه.md');
  });
});

describe('ExportContentsSchema', () => {
  it('takes ids or a filter, never both or neither', () => {
    expect(ExportContentsSchema.safeParse({ ids: ['a'], format: 'csv' }).success).toBe(true);
    expect(
      ExportContentsSchema.safeParse({ filter: { topicId: 't1' }, format: 'zip' }).success,
    ).toBe(true);
    expect(ExportContentsSchema.safeParse({ format: 'csv' }).success).toBe(false);
    expect(ExportContentsSchema.safeParse({ ids: ['a'], filter: {}, format: 'csv' }).success).toBe(
      false,
    );
  });

  it('bounds the ids, knows only four formats and defaults onlyApproved to false', () => {
    const many = Array.from({ length: EXPORT_MAX_ITEMS + 1 }, (_, i) => `c${i}`);
    expect(ExportContentsSchema.safeParse({ ids: many, format: 'csv' }).success).toBe(false);
    expect(ExportContentsSchema.safeParse({ ids: [], format: 'csv' }).success).toBe(false);
    expect(ExportContentsSchema.safeParse({ ids: ['a'], format: 'pdf' }).success).toBe(false);
    expect(ExportContentsSchema.parse({ ids: ['a'], format: 'csv' }).onlyApproved).toBe(false);
  });
});
