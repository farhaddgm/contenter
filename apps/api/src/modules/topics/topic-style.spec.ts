import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../common/auth.decorators';
import type { AccessService } from '../../common/access';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { BusinessApi } from '../businesses/business-api';
import { TopicsService } from './topics.module';

const user = { id: 'u1', role: 'ADMIN' } as AuthUser;

/** A topic linked to b1 with style s1; `usable` lists the (businessId, styleId) pairs the API accepts. */
function setup(usable: [string, string][]) {
  const update = vi.fn(async () => ({}));
  const styleForPrompt = vi.fn(async (b: string, s: string) =>
    usable.some(([ub, us]) => ub === b && us === s) ? { name: 'n', summary: '', guide: 'g', traits: [] } : null,
  );
  const svc = new TopicsService(
    {
      topic: { findUnique: async () => ({ businessId: 'b1', styleId: 's1' }), update },
    } as unknown as PrismaService,
    { log: vi.fn() } as unknown as AuditService,
    { accessTo: async () => 'EDIT' } as unknown as AccessService,
    { styleForPrompt } as unknown as BusinessApi,
  );
  return { svc, update, styleForPrompt };
}

describe('TopicsService.update style rules (docs/64)', () => {
  it('accepts a confirmed style of the same business', async () => {
    const { svc, update } = setup([['b1', 's2']]);
    await svc.update('t1', { styleId: 's2' }, user);
    expect(update.mock.calls[0]![0].data).toMatchObject({ styleId: 's2' });
  });

  it('refuses a style that is unknown, unbuilt or not confirmed', async () => {
    const { svc, update } = setup([]);
    await expect(svc.update('t1', { styleId: 's2' }, user)).rejects.toThrow(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('clears the style when it is set to null', async () => {
    const { svc, update, styleForPrompt } = setup([]);
    await svc.update('t1', { styleId: null }, user);
    expect(styleForPrompt).not.toHaveBeenCalled();
    expect(update.mock.calls[0]![0].data).toMatchObject({ styleId: null });
  });

  it('drops the style when the business changes and no new style is given', async () => {
    const { svc, update } = setup([['b1', 's1']]);
    await svc.update('t1', { businessId: 'b2' }, user);
    expect(update.mock.calls[0]![0].data).toMatchObject({ businessId: 'b2', styleId: null });
  });

  it("re-checks the current style against the new business (another business's style is refused)", async () => {
    const { svc, update } = setup([['b1', 's1']]);
    await expect(svc.update('t1', { businessId: 'b2', styleId: 's1' }, user)).rejects.toThrow(
      BadRequestException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('leaves the style alone when only other fields change', async () => {
    const { svc, update, styleForPrompt } = setup([]);
    await svc.update('t1', { title: 'عنوان تازه' }, user);
    expect(styleForPrompt).not.toHaveBeenCalled();
    expect(update.mock.calls[0]![0].data).not.toHaveProperty('styleId');
  });
});
