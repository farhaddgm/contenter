/**
 * Bulk export of contents (docs/55-bulk-export.md): Markdown, CSV, DOCX and a ZIP of all of
 * them. Pure and deterministic — the same contents give the same bytes of text — and no model is
 * involved. This file holds the contract, the row shape and the text formats; the DOCX/ZIP
 * packaging is in the API.
 */
import { z } from 'zod';
import type { ContentFormat, ContentStatus, Platform } from './enums';
import { ContentListQuerySchema } from './schemas';
import { fold } from './search';

/** The most contents one export may hold (the whole file is built in memory). */
export const EXPORT_MAX_ITEMS = 200;

export const ExportFormat = ['markdown', 'csv', 'docx', 'zip'] as const;
export type ExportFormat = (typeof ExportFormat)[number];

/** The list filters of `GET /contents`, without paging: an export takes every match. */
export const ExportFilterSchema = ContentListQuerySchema.omit({ page: true, pageSize: true });

export const ExportContentsSchema = z
  .object({
    /** Exactly these contents, in this order… */
    ids: z.array(z.string().min(1).max(40)).min(1).max(EXPORT_MAX_ITEMS).optional(),
    /** …or every content the list filters match. */
    filter: ExportFilterSchema.optional(),
    format: z.enum(ExportFormat),
    /** Leave out everything that is not approved or published. */
    onlyApproved: z.boolean().default(false),
  })
  .refine((v) => (v.ids ? 1 : 0) + (v.filter ? 1 : 0) === 1, {
    message: 'Give either ids or filter',
    path: ['ids'],
  });
export type ExportContentsInput = z.input<typeof ExportContentsSchema>;
/** The request after validation (lists parsed, defaults filled): what the server works with. */
export type ExportContentsRequest = z.output<typeof ExportContentsSchema>;

/** One content as exported: its current version and the facts around it. */
export interface ExportRow {
  id: string;
  topic: string;
  platform: Platform;
  format: ContentFormat;
  status: ContentStatus;
  version: number;
  title: string;
  body: string;
  hashtags: string[];
  cta: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
}

/** The columns of the CSV, in this order, always. */
export const EXPORT_CSV_COLUMNS = [
  'id',
  'topic',
  'platform',
  'format',
  'status',
  'version',
  'title',
  'body',
  'hashtags',
  'cta',
  'scheduledAt',
  'publishedAt',
  'createdAt',
] as const satisfies readonly (keyof ExportRow)[];

// ───────────────────────────────── CSV ─────────────────────────────────

/** Cells a spreadsheet would run as a formula (OWASP "CSV injection"); also tab and carriage return. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One CSV cell: text that a spreadsheet could read as a formula gets a leading `'`, then the cell
 * is quoted. Numbers we produce ourselves are written as they are (a negative number is not text).
 */
export function csvCell(value: string | number | null): string {
  if (value === null) return '""';
  if (typeof value === 'number') return String(value);
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

const BOM = '﻿';

/** UTF-8 with a BOM (so Excel reads Persian and digits right), CRLF rows, every cell quoted. */
export function contentsToCsv(rows: readonly ExportRow[]): string {
  const lines = [EXPORT_CSV_COLUMNS.map((c) => csvCell(c)).join(',')];
  for (const r of rows) {
    lines.push(
      EXPORT_CSV_COLUMNS.map((c) => {
        const v = r[c];
        return csvCell(
          Array.isArray(v) ? v.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ') : v,
        );
      }).join(','),
    );
  }
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

// ───────────────────────────────── Markdown ─────────────────────────────────

const hashtag = (h: string) => (h.startsWith('#') ? h : `#${h}`);

/** YAML scalars are written as JSON strings, which YAML reads as quoted scalars. */
const yaml = (v: string | number | null) => (v === null ? 'null' : JSON.stringify(v));

/** One document: YAML front matter, the title, the body, the call to action and the hashtags. */
export function contentToMarkdown(r: ExportRow): string {
  const front = [
    '---',
    `id: ${yaml(r.id)}`,
    `title: ${yaml(r.title)}`,
    `topic: ${yaml(r.topic)}`,
    `platform: ${yaml(r.platform)}`,
    `format: ${yaml(r.format)}`,
    `status: ${yaml(r.status)}`,
    `version: ${yaml(r.version)}`,
    `scheduledAt: ${yaml(r.scheduledAt)}`,
    `publishedAt: ${yaml(r.publishedAt)}`,
    `createdAt: ${yaml(r.createdAt)}`,
    `hashtags: [${r.hashtags.map((h) => yaml(hashtag(h))).join(', ')}]`,
    '---',
  ].join('\n');
  const parts = [front, `# ${r.title}`, r.body.trim()];
  if (r.cta.trim()) parts.push(`👉 ${r.cta.trim()}`);
  if (r.hashtags.length) parts.push(r.hashtags.map(hashtag).join(' '));
  return `${parts.join('\n\n')}\n`;
}

/** Several contents in one file: their documents one after the other. */
export function contentsToMarkdown(rows: readonly ExportRow[]): string {
  return rows.map(contentToMarkdown).join('\n');
}

// ───────────────────────────────── file names ─────────────────────────────────

/**
 * A file-name part from a title: Persian and Arabic letters folded to one spelling (`fold`),
 * everything that is not a letter or digit becomes one `-`, at most 60 characters.
 */
export function exportSlug(title: string): string {
  const slug = fold(title)
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return [...slug].slice(0, 60).join('').replace(/-+$/g, '') || 'content';
}

/** `001-title.md`: the position keeps the order and makes equal titles distinct. */
export function exportFileName(index: number, title: string, ext: string): string {
  return `${String(index + 1).padStart(3, '0')}-${exportSlug(title)}.${ext}`;
}
