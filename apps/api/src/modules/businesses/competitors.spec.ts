import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { BUSINESS_COMPETITOR_LIMIT } from '@contenter/shared';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { BUSINESS_PROMPT_INCLUDE, EXPORT_INCLUDE } from './business-api';
import { CompetitorsService } from './competitors.service';

const user = { id: 'u1', role: 'ADMIN' } as AuthUser;

const row = {
  id: 'c1',
  businessId: 'b1',
  name: 'برند الف',
  kind: 'DIRECT',
  website: '',
  instagram: '',
  positioning: 'ارزان',
  pricing: '',
  strengths: ['سریع'],
  weaknesses: [],
  difference: '',
  note: 'internal',
  isActive: true,
  sortOrder: 0,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-02T00:00:00Z'),
};

function setup(opts: { count?: number; clash?: boolean; business?: boolean; section?: { content: string; lock: string } | null } = {}) {
  const created: Record<string, unknown>[] = [];
  const sectionWrites: Record<string, unknown>[] = [];
  const existing = opts.section === undefined ? { content: 'متن دستی' } : opts.section;
  const tx = {
    businessSection: {
      findUnique: async () => (existing ? { id: 's1', lock: 'NONE', ...existing } : null),
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        sectionWrites.push(data);
        return { count: 1 };
      },
      findUniqueOrThrow: async () => ({ key: 'COMPETITORS', content: String(sectionWrites.at(-1)?.content ?? '') }),
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        sectionWrites.push(create);
        return { key: 'COMPETITORS', content: String(create.content) };
      },
    },
    businessSectionRevision: { create: vi.fn() },
  };
  const prisma = {
    business: { findUnique: async () => (opts.business === false ? null : { id: 'b1' }) },
    businessCompetitor: {
      count: async () => opts.count ?? 0,
      findFirst: async () => (opts.clash ? { id: 'other' } : null),
      findUnique: async () => row,
      findMany: async () => [row],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { ...row, ...data, id: 'new' };
      },
      update: async ({ data }: { data: Record<string, unknown> }) => ({ ...row, ...data }),
      delete: vi.fn(),
    },
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    ...tx,
  };
  const audit = { log: vi.fn() };
  const svc = new CompetitorsService(prisma as unknown as PrismaService, audit as unknown as AuditService);
  return { svc, created, sectionWrites, audit };
}

describe('CompetitorsService', () => {
  it('creates a card and keeps the internal note out of the audit log', async () => {
    const { svc, created, audit } = setup();
    const out = await svc.create('b1', { name: 'برند الف', note: 'internal' }, user);
    expect(created[0]).toMatchObject({ businessId: 'b1', name: 'برند الف', kind: 'DIRECT', updatedById: 'u1' });
    expect(out.id).toBe('new');
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain('internal');
  });

  it('refuses a duplicate name, more than the limit and a missing business', async () => {
    await expect(setup({ clash: true }).svc.create('b1', { name: 'x' }, user)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      setup({ count: BUSINESS_COMPETITOR_LIMIT }).svc.create('b1', { name: 'x' }, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup({ business: false }).svc.create('b1', { name: 'x' }, user)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('writes the active cards into COMPETITORS through writeSection, keeping the admin text', async () => {
    const { svc, sectionWrites } = setup();
    await svc.addToProfile('b1', user);
    const content = String(sectionWrites[0]!.content);
    expect(content.startsWith('متن دستی')).toBe(true);
    expect(content).toContain('برند الف');
    expect(sectionWrites[0]).toMatchObject({ source: 'ADMIN' });
  });

  it('respects the section lock: an editor cannot write an ADMIN_ONLY section', async () => {
    const { svc } = setup({ section: { content: '', lock: 'ADMIN_ONLY' } });
    await expect(svc.addToProfile('b1', { id: 'u2', role: 'EDITOR' } as AuthUser)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('competitor cards never reach a prompt or an export on their own (docs/70 §4.5)', () => {
  it('is not part of the prompt include nor the export include', () => {
    expect(Object.keys(BUSINESS_PROMPT_INCLUDE)).not.toContain('competitors');
    expect(Object.keys(EXPORT_INCLUDE)).not.toContain('competitors');
  });
});
