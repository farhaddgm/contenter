import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { describe, expect, it, vi } from 'vitest';
import {
  EXPORT_MAX_ITEMS,
  ExportContentsSchema,
  type ExportContentsInput,
  type ExportRow,
} from '@contenter/shared';
import type { AccessService } from '../../common/access';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { contentsToDocx, xmlText } from './docx';
import { ExportService } from './export.service';

const admin = { id: 'a', role: 'ADMIN' } as AuthUser;
const editor = { id: 'e', role: 'EDITOR' } as AuthUser;

const row = (over: Partial<ExportRow> = {}): ExportRow => ({
  id: 'c1',
  topic: 'آموزش قهوه',
  platform: 'INSTAGRAM',
  format: 'POST',
  status: 'APPROVED',
  version: 1,
  title: 'قهوهٔ تازه',
  body: 'قهوه را تازه آسیاب کنید.\n\nبا ۲ قاشق شکر، عالی می‌شود.',
  hashtags: ['قهوه'],
  cta: 'همین حالا سفارش بدهید',
  scheduledAt: null,
  publishedAt: null,
  createdAt: '2026-10-01T08:00:00.000Z',
  ...over,
});

describe('contentsToDocx', () => {
  it('is a package Word can open: the required parts, right-to-left Persian paragraphs, a heading', async () => {
    const zip = await JSZip.loadAsync(await contentsToDocx([row()]));
    expect(Object.keys(zip.files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/_rels/document.xml.rels',
      'word/document.xml',
      'word/styles.xml',
    ]);
    const doc = await zip.file('word/document.xml')!.async('string');
    expect(doc).toContain('<w:bidi/>');
    expect(doc).toContain('<w:rtl/>');
    expect(doc).toContain('w:bidi="fa-IR"');
    expect(doc).toContain('<w:pStyle w:val="Heading1"/>');
    expect(doc).toContain('w:cs="Tahoma"');
  });

  it('reads back through a real DOCX reader with the Persian text, digits and order intact', async () => {
    const buf = await contentsToDocx([
      row(),
      row({ id: 'c2', title: 'چای', body: 'چای داغ.', cta: '', hashtags: [] }),
    ]);
    const text = (await mammoth.extractRawText({ buffer: buf })).value;
    expect(text.indexOf('قهوهٔ تازه')).toBeGreaterThanOrEqual(0);
    expect(text).toContain('با ۲ قاشق شکر، عالی می‌شود.');
    expect(text).toContain('👉 همین حالا سفارش بدهید');
    expect(text).toContain('#قهوه');
    expect(text.indexOf('قهوهٔ تازه')).toBeLessThan(text.indexOf('چای داغ.'));
  });

  it('each content after the first starts on a new page; a Latin-only text is left to right', async () => {
    const doc = await (
      await JSZip.loadAsync(
        await contentsToDocx([
          row(),
          row({ id: 'c2', title: 'Hello', body: 'Plain english text' }),
        ]),
      )
    )
      .file('word/document.xml')!
      .async('string');
    expect(doc.match(/<w:pageBreakBefore\/>/g)).toHaveLength(1);
    const second = doc.slice(doc.indexOf('Hello') - 400);
    expect(second.slice(0, second.indexOf('Hello'))).not.toContain('<w:bidi/><w:pageBreakBefore/>');
    const latin = doc.slice(doc.indexOf('Plain english') - 300, doc.indexOf('Plain english'));
    expect(latin).not.toContain('<w:rtl/>');
  });

  it('escapes markup and drops characters XML cannot hold', async () => {
    expect(xmlText('a<b>&"c"\u0001\u000bd')).toBe('a&lt;b&gt;&amp;&quot;c&quot;d');
    const buf = await contentsToDocx([
      row({ title: '<script>x</script> & "q"', body: 'a\u0000b' }),
    ]);
    const doc = await (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string');
    expect(doc).not.toContain('<script>');
    expect(doc).toContain('&lt;script&gt;x&lt;/script&gt; &amp; &quot;q&quot;');
    expect(doc).not.toContain('\u0000');
  });

  it('gives the same bytes for the same rows', async () => {
    const a = await contentsToDocx([row()]);
    const b = await contentsToDocx([row()]);
    expect(a.equals(b)).toBe(true);
  });
});

/** What the controller's validation pipe hands the service: lists parsed, defaults filled. */
const req = (input: unknown) => ExportContentsSchema.parse(input as ExportContentsInput);

interface DbRow {
  id: string;
  status: string;
  format: string;
  platform: string | null;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  topic: { title: string; platform: string };
  currentVersion: {
    version: number;
    title: string;
    body: string;
    hashtags: string[];
    cta: string;
  } | null;
}
const db = (id: string, over: Partial<DbRow> = {}): DbRow => ({
  id,
  status: 'APPROVED',
  format: 'POST',
  platform: null,
  scheduledAt: null,
  publishedAt: null,
  createdAt: new Date('2026-10-01T08:00:00Z'),
  topic: { title: 'آموزش قهوه', platform: 'INSTAGRAM' },
  currentVersion: {
    version: 3,
    title: `عنوان ${id}`,
    body: `متن ${id}`,
    hashtags: ['الف'],
    cta: '',
  },
  ...over,
});

function setup(rows: DbRow[], opts: { visibleFound?: number } = {}) {
  const findMany = vi.fn(async (a: { select: Record<string, unknown>; where: unknown }) =>
    'currentVersion' in a.select
      ? rows
      : rows.slice(0, opts.visibleFound ?? rows.length).map((r) => ({ id: r.id })),
  );
  const log = vi.fn();
  const svc = new ExportService(
    { content: { findMany } } as unknown as PrismaService,
    {
      visibleTopics: (u: AuthUser) => (u.role === 'ADMIN' ? undefined : { createdById: u.id }),
    } as unknown as AccessService,
    { log } as unknown as AuditService,
  );
  return { svc, findMany, log };
}

describe('ExportService', () => {
  it('exports ids in the order asked for, as CSV with the effective platform, and audits it with the count', async () => {
    const { svc, log } = setup([db('b'), db('a', { platform: 'X' })]);
    const f = await svc.export(admin, req({ ids: ['a', 'b'], format: 'csv' }));
    const text = f.data.toString('utf8');
    expect(text.indexOf('عنوان a')).toBeLessThan(text.indexOf('عنوان b'));
    expect(text).toContain('"X"');
    expect(text).toContain('"INSTAGRAM"');
    expect(f.contentType).toContain('text/csv');
    expect(f.fileName).toBe('contenter-contents.csv');
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'contents.export',
        meta: { count: 2, format: 'csv', by: 'ids', onlyApproved: false },
      }),
    );
  });

  it('is all-or-nothing for ids: one that is missing or hidden makes it a 404, the same for both', async () => {
    const { svc } = setup([db('a')], { visibleFound: 1 });
    await expect(
      svc.export(editor, req({ ids: ['a', 'zzz'], format: 'csv' })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('limits what it reads to topics the caller can see', async () => {
    const { svc, findMany } = setup([db('a')]);
    await svc.export(editor, req({ ids: ['a'], format: 'markdown' }));
    const where = JSON.stringify(findMany.mock.calls[0]![0].where);
    expect(where).toContain('"createdById":"e"');
    const adminRun = setup([db('a')]);
    await adminRun.svc.export(admin, req({ ids: ['a'], format: 'markdown' }));
    expect(JSON.stringify(adminRun.findMany.mock.calls[0]![0].where)).not.toContain('createdById');
  });

  it('"only approved" keeps approved and published contents out of the rest', async () => {
    const { svc, findMany } = setup([db('a')]);
    await svc.export(admin, req({ ids: ['a'], format: 'csv', onlyApproved: true }));
    const where = JSON.stringify(findMany.mock.calls[1]![0].where);
    expect(where).toContain('"status":"APPROVED"');
    expect(where).toContain('"publishedAt":{"not":null}');
    expect(where).toContain('"currentVersionId":{"not":null}');
  });

  it('a filter uses the list filters and the list order, and refuses more than the cap', async () => {
    const { svc, findMany } = setup([db('a')]);
    await svc.export(
      admin,
      req({
        filter: { topicId: 't1', statuses: 'APPROVED', sort: 'title', order: 'asc' } as never,
        format: 'csv',
      }),
    );
    const call = findMany.mock.calls[0]![0] as unknown as {
      where: unknown;
      orderBy: unknown;
      take: number;
    };
    expect(JSON.stringify(call.where)).toContain('"topicId":"t1"');
    expect(call.orderBy).toEqual([{ title: 'asc' }, { id: 'asc' }]);
    expect(call.take).toBe(EXPORT_MAX_ITEMS + 1);

    const many = Array.from({ length: EXPORT_MAX_ITEMS + 1 }, (_, i) => db(`c${i}`));
    await expect(
      setup(many).svc.export(admin, req({ filter: {}, format: 'csv' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('nothing with a draft means 409, and a content without a current version is skipped', async () => {
    await expect(
      setup([db('a', { currentVersion: null })]).svc.export(
        admin,
        req({ ids: ['a'], format: 'csv' }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    const f = await setup([db('a'), db('b', { currentVersion: null })]).svc.export(
      admin,
      req({
        filter: {},
        format: 'csv',
      }),
    );
    expect(f.data.toString('utf8')).not.toContain('عنوان b');
  });

  it('a single content is named after its title; a ZIP holds one .md per content plus the CSV and the DOCX', async () => {
    const one = await setup([db('a')]).svc.export(admin, req({ ids: ['a'], format: 'markdown' }));
    expect(one.fileName).toBe('عنوان-a.md');
    expect(one.asciiName).toBe('contenter-contents.md');

    const z = await setup([db('a'), db('b')]).svc.export(
      admin,
      req({ ids: ['a', 'b'], format: 'zip' }),
    );
    expect(z.fileName).toBe('contenter-export.zip');
    const zip = await JSZip.loadAsync(z.data);
    expect(Object.keys(zip.files).sort()).toEqual([
      '001-عنوان-a.md',
      '002-عنوان-b.md',
      'contents.csv',
      'contents.docx',
    ]);
    const docx = await zip.file('contents.docx')!.async('nodebuffer');
    expect((await mammoth.extractRawText({ buffer: docx })).value).toContain('متن b');
    const again = await setup([db('a'), db('b')]).svc.export(
      admin,
      req({
        ids: ['a', 'b'],
        format: 'zip',
      }),
    );
    expect(again.data.equals(z.data)).toBe(true);
  });
});
