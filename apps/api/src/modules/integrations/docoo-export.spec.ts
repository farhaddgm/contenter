import { NotFoundException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  BusinessSectionKey,
  DOCOO_EXPORT_EXCERPT_CHARS,
  DOCOO_EXPORT_SCHEMA_VERSION,
} from '@contenter/shared';
import type { Env } from '../../config/env';
import { buildDocooExport, type ExportRow } from './docoo-export.builder';
import { DocooExportService } from './docoo-export.service';
import { IntegrationTokenGuard, safeEqual } from './integration-token.guard';

const at = (day: number) => new Date(`2026-10-0${day}T08:00:00.000Z`);

function row(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    id: 'biz1',
    name: 'ویپاد',
    tagline: 'پرداخت آسان',
    industry: 'فین‌تک',
    website: 'https://example.com',
    location: 'تهران',
    language: 'fa',
    keyword: 'پرداخت',
    status: 'ACTIVE',
    origin: 'RESEARCH',
    buildState: 'READY',
    buildError: null,
    lastJobId: null,
    sources: [{ url: 'https://example.com/a', title: 'A' }, { nope: 1 }, 'x'],
    gaps: ['نرخ کارمزد تأیید نشد'],
    researchedAt: at(2),
    createdById: 'person-77',
    createdAt: at(1),
    updatedAt: at(3),
    sections: [
      {
        id: 's1',
        businessId: 'biz1',
        key: 'OVERVIEW',
        content: 'ویپاد شعبهٔ دیجیتال است.',
        source: 'AI',
        updatedById: 'person-77',
        reviewedAt: null,
        reviewedById: null,
        createdAt: at(1),
        updatedAt: at(2),
      },
      {
        id: 's2',
        businessId: 'biz1',
        key: 'GUIDELINES',
        content: 'ادعای سود قطعی ممنوع.',
        source: 'ADMIN',
        updatedById: 'person-77',
        reviewedAt: at(2),
        reviewedById: 'person-77',
        createdAt: at(1),
        updatedAt: at(2),
      },
    ],
    facts: [
      {
        id: 'f1',
        businessId: 'biz1',
        label: 'سقف تسهیلات',
        value: '۵۰۰ میلیون تومان',
        category: 'PRICING',
        sourceUrl: 'https://example.com/loan',
        note: 'داخلی',
        source: 'ADMIN',
        verified: true,
        validUntil: at(9),
        isActive: true,
        updatedById: 'person-77',
        createdAt: at(1),
        updatedAt: at(2),
      },
    ],
    terms: [
      {
        id: 't1',
        businessId: 'biz1',
        term: 'ویپاد',
        kind: 'USE',
        alternatives: ['وی پاد', 'WePod'],
        note: '',
        isActive: true,
        createdAt: at(1),
        updatedAt: at(1),
      },
    ],
    notes: [
      {
        id: 'n1',
        businessId: 'biz1',
        text: 'نام را همیشه یکپارچه بنویس.',
        apply: 'DIRECT',
        scope: 'NONE',
        status: 'APPLIED',
        summary: 'نام اصلاح شد',
        changedKeys: ['BRAND_BOOK'],
        error: null,
        isActive: true,
        jobId: null,
        createdById: 'person-77',
        createdAt: at(2),
        updatedAt: at(2),
      },
    ],
    references: [
      {
        id: 'r1',
        businessId: 'biz1',
        kind: 'URL',
        url: 'https://example.com/about',
        title: 'دربارهٔ ما',
        content: 'ا'.repeat(DOCOO_EXPORT_EXCERPT_CHARS + 500),
        status: 'READY',
        error: null,
        isActive: true,
        fetchedAt: at(2),
        googleAccountId: null,
        createdById: 'person-77',
        createdAt: at(1),
        updatedAt: at(2),
      },
    ],
    assets: [
      {
        id: 'a1',
        businessId: 'biz1',
        kind: 'BANNER',
        title: 'بنر نوروز',
        description: 'کمپین نوروز',
        url: '',
        text: 'متن روی بنر',
        fileName: 'banner.png',
        mimeType: 'image/png',
        size: 1234,
        storageKey: 'uploads/secret-key',
        previews: ['uploads/preview-secret'],
        remoteImages: [],
        analysisStatus: 'READY',
        analysis: { summary: 'گرم و صمیمی' },
        analysisError: null,
        lastJobId: null,
        isActive: true,
        createdById: 'person-77',
        createdAt: at(2),
        updatedAt: at(2),
      },
    ],
    audits: [
      {
        id: 'au1',
        businessId: 'biz1',
        status: 'READY',
        score: 71,
        summary: 'پروفایل نسبتاً کامل است',
        strengths: ['لحن روشن'],
        issues: [
          {
            severity: 'HIGH',
            status: 'OPEN',
            type: 'MISSING',
            target: 'PERSONAS',
            title: 'پرسونا ندارد',
          },
          { severity: 'LOW', status: 'DISMISSED', type: 'VAGUE', target: 'GENERAL', title: 'کلی' },
        ],
        error: null,
        jobId: null,
        createdById: 'person-77',
        createdAt: at(3),
        updatedAt: at(3),
      },
    ],
    topics: [{ id: 'tp1', title: 'کمپین نوروز', status: 'ACTIVE' }],
    _count: { suggestions: 2 },
    ...overrides,
  } as unknown as ExportRow;
}

describe('Docoo export (docs/18)', () => {
  it('gives every section of the registry, in order, empty ones included', () => {
    const out = buildDocooExport(row(), at(5));
    expect(out.schemaVersion).toBe(DOCOO_EXPORT_SCHEMA_VERSION);
    expect(out.exportedAt).toBe(at(5).toISOString());
    expect(out.sections.map((s) => s.key)).toEqual([...BusinessSectionKey]);
    const overview = out.sections[0]!;
    expect(overview).toMatchObject({ key: 'OVERVIEW', source: 'AI', reviewedAt: null });
    const services = out.sections.find((s) => s.key === 'SERVICES')!;
    expect(services).toMatchObject({ content: '', reviewedAt: null, updatedAt: null });
    expect(out.sections.find((s) => s.key === 'GUIDELINES')!.reviewedAt).toBe(at(2).toISOString());
  });

  it('carries the base fields, facts, terms, notes, references, assets, audit and health', () => {
    const out = buildDocooExport(row(), at(5));
    expect(out.business).toMatchObject({
      id: 'biz1',
      name: 'ویپاد',
      language: 'fa',
      gaps: ['نرخ کارمزد تأیید نشد'],
      sources: [{ url: 'https://example.com/a', title: 'A' }],
    });
    expect(out.facts).toEqual([
      expect.objectContaining({
        label: 'سقف تسهیلات',
        verified: true,
        validUntil: at(9).toISOString(),
      }),
    ]);
    expect(out.terms[0]).toMatchObject({
      term: 'ویپاد',
      kind: 'USE',
      alternatives: ['وی پاد', 'WePod'],
    });
    expect(out.notes[0]).toMatchObject({ status: 'APPLIED', changedKeys: ['BRAND_BOOK'] });
    expect(out.audit).toMatchObject({ score: 71, strengths: ['لحن روشن'] });
    expect(out.audit?.issues).toHaveLength(2);
    expect(out.topics).toEqual([{ id: 'tp1', title: 'کمپین نوروز', status: 'ACTIVE' }]);
    expect(out.pendingSuggestions).toBe(2);
    expect(out.health.total).toBe(BusinessSectionKey.length);
    expect(out.health.filled).toBe(2);
    expect(out.health.score).toBeGreaterThan(0);
    // an open HIGH issue lowers the audit points
    const clean = buildDocooExport(
      row({ audits: [{ ...row().audits[0]!, issues: [] }] as never }),
      at(5),
    );
    expect(clean.health.score).toBeGreaterThan(out.health.score);
  });

  it('cuts long reference and asset text to an excerpt and never exports files or people', () => {
    const out = buildDocooExport(row(), at(5));
    const reference = out.references[0]!;
    expect(reference.excerpt).toHaveLength(DOCOO_EXPORT_EXCERPT_CHARS);
    expect(reference.contentChars).toBe(DOCOO_EXPORT_EXCERPT_CHARS + 500);
    expect(out.assets[0]).toMatchObject({
      hasFile: true,
      fileName: 'banner.png',
      excerpt: 'متن روی بنر',
    });
    const text = JSON.stringify(out);
    for (const secret of [
      'uploads/secret-key',
      'uploads/preview-secret',
      'person-77',
      'updatedById',
      'storageKey',
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it('is deterministic apart from the export time', () => {
    const a = buildDocooExport(row(), at(5));
    const b = buildDocooExport(row(), at(6));
    expect({ ...a, exportedAt: '' }).toEqual({ ...b, exportedAt: '' });
  });
});

describe('integration token guard', () => {
  const context = (authorization?: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers: authorization ? { authorization } : {} }),
      }),
    }) as unknown as ExecutionContext;
  const guard = (token?: string) => new IntegrationTokenGuard({ INTEGRATION_TOKEN: token } as Env);
  const token = 'a'.repeat(40);

  it('does not exist without a configured token', () => {
    expect(() => guard().canActivate(context(`Bearer ${token}`))).toThrow(NotFoundException);
  });

  it('accepts only the exact bearer token', () => {
    expect(guard(token).canActivate(context(`Bearer ${token}`))).toBe(true);
    for (const bad of [
      undefined,
      'Bearer ',
      'Bearer nope',
      `Basic ${token}`,
      `Bearer ${token}x`,
      token,
    ]) {
      expect(() => guard(token).canActivate(context(bad))).toThrow(UnauthorizedException);
    }
  });

  it('compares without leaking length', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('DocooExportService', () => {
  const audit = { log: vi.fn() };

  it('lists light rows with filled-section counts and pages them', async () => {
    const prisma = {
      business: {
        findMany: vi.fn().mockResolvedValue([
          {
            ...row(),
            _count: { topics: 3 },
            sections: [{ content: 'متن' }, { content: '  ' }, { content: 'متن دیگر' }],
          },
        ]),
        count: vi.fn().mockResolvedValue(1),
      },
      $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const service = new DocooExportService(prisma as never, audit as never);
    const page = await service.list({ page: 1, pageSize: 20, q: 'وی' });
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      id: 'biz1',
      name: 'ویپاد',
      filledSections: 2,
      totalSections: BusinessSectionKey.length,
      topics: 3,
    });
    expect(prisma.business.findMany.mock.calls[0]![0].where.OR).toBeTruthy();
    expect(JSON.stringify(page)).not.toContain('createdById');
  });

  it('exports one business and records the access, or says it was not found', async () => {
    const prisma = {
      business: { findUnique: vi.fn().mockResolvedValueOnce(row()).mockResolvedValueOnce(null) },
    };
    const service = new DocooExportService(prisma as never, audit as never);
    const out = await service.export('biz1', '10.0.0.1');
    expect(out.business.id).toBe('biz1');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'integration.docoo_export',
        entityId: 'biz1',
        ip: '10.0.0.1',
      }),
    );
    await expect(service.export('missing', null)).rejects.toThrow(NotFoundException);
  });
});
