import { describe, expect, it, vi } from 'vitest';
import type { AccessService } from '../../common/access';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { StaleService } from './stale.module';
import { BusinessApi } from '../businesses/business-api';

const user = { id: 'u1', role: 'ADMIN' } as AuthUser;

function service(facts: unknown[], contents: unknown[]) {
  const findContents = vi.fn().mockResolvedValue(contents);
  const prisma = {
    businessFact: { findMany: vi.fn().mockResolvedValue(facts) },
    content: { findMany: findContents },
  } as unknown as PrismaService;
  const access = { visibleTopics: vi.fn().mockReturnValue(undefined) } as unknown as AccessService;
  return { svc: new StaleService(prisma, access, new BusinessApi(prisma)), findContents };
}

const row = (body: string) => ({
  id: 'c1',
  status: 'APPROVED',
  format: 'POST',
  platform: null,
  publishedAt: new Date('2026-05-01T00:00:00Z'),
  scheduledAt: null,
  topic: { id: 't1', title: 'پروژه', platform: 'INSTAGRAM' },
  currentVersion: { title: 'قیمت', body, hashtags: [], cta: '' },
});

describe('StaleService', () => {
  const facts = [{ label: 'قیمت اشتراک ماهانه', value: '۶۰۰ هزار تومان', validUntil: null }];

  it('reports a published content that quotes an old number', async () => {
    const { svc } = service(facts, [row('قیمت اشتراک ماهانه ۵۰۰ هزار تومان است.')]);
    const out = await svc.forBusiness('b1', user);
    expect(out.checked).toBe(1);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]!.platform).toBe('INSTAGRAM');
    expect(out.items[0]!.publishedAt).toBe('2026-05-01T00:00:00.000Z');
  });

  it('does not read any content when the business has no facts', async () => {
    const { svc, findContents } = service([], [row('x')]);
    expect(await svc.forBusiness('b1', user)).toEqual({ checked: 0, truncated: false, items: [] });
    expect(findContents).not.toHaveBeenCalled();
  });

  it('asks only for the topics the caller may see', async () => {
    const { svc, findContents } = service(facts, []);
    const access = { visibleTopics: vi.fn().mockReturnValue({ createdById: 'u1' }) };
    (svc as unknown as { access: unknown }).access = access;
    await svc.forBusiness('b1', { id: 'u1', role: 'EDITOR' } as AuthUser);
    expect(findContents.mock.calls[0]![0].where.topic).toEqual({
      AND: [{ businessId: 'b1' }, { createdById: 'u1' }],
    });
  });
});
