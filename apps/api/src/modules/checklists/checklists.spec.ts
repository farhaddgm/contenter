import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ChecklistTemplate } from '@contenter/shared';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { ChecklistsService } from './checklists.module';

const user = { id: 'u1', role: 'EDITOR' } as AuthUser;

const item = (id: string, text: string, required = false, auto: 'QUALITY_CLEAN' | null = null) => ({
  id,
  text,
  required,
  auto,
});

interface Opts {
  templates?: { platform: string | null; items: unknown }[];
  content?: unknown;
  ticks?: { itemId: string; createdAt: Date; checkedBy: { name: string } | null }[];
}

function setup(opts: Opts = {}) {
  const rows = (opts.templates ?? []).map((t, i) => ({
    id: `tpl${i}`,
    businessId: 'b1',
    createdAt: new Date(2026, 9, i + 1),
    ...t,
  }));
  const content =
    opts.content === undefined
      ? {
          platform: null,
          publishedAt: null,
          topic: { platform: 'INSTAGRAM', businessId: 'b1' },
          checklistTicks: opts.ticks ?? [],
        }
      : opts.content;
  const tx = {
    checklistTemplate: {
      findMany: vi.fn(async () => rows),
      delete: vi.fn(async () => undefined),
      update: vi.fn(async () => undefined),
      create: vi.fn(async () => undefined),
    },
  };
  const prisma = {
    checklistTemplate: { findMany: vi.fn(async () => rows) },
    content: { findUnique: vi.fn(async () => content) },
    contentChecklistTick: {
      upsert: vi.fn(async () => undefined),
      deleteMany: vi.fn(async () => undefined),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const audit = { log: vi.fn() };
  const service = new ChecklistsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { service, prisma, tx, audit };
}

const general = {
  platform: null,
  items: [item('g1', 'لینک بیو عوض شده؟', true), item('g2', 'تصویر مجوز دارد؟')],
};
const instagram = {
  platform: 'INSTAGRAM',
  items: [
    item('i1', 'کاور مربعی است؟', true),
    item('q1', 'بدون هشدار کیفیت', false, 'QUALITY_CLEAN'),
  ],
};

describe('ChecklistsService.forContent', () => {
  it('has no checklist for a content without a business or when the business wrote none', async () => {
    expect(
      await setup({
        content: { platform: null, topic: { platform: 'X', businessId: null }, checklistTicks: [] },
      }).service.forContent('c1'),
    ).toBeNull();
    expect(await setup({ templates: [] }).service.forContent('c1')).toBeNull();
  });

  it('lists the general points and those of the content’s platform, and counts the required ones still open', async () => {
    const { service } = setup({ templates: [general, instagram] });
    const list = await service.forContent('c1', { warnings: 1 });
    expect(list!.items.map((i) => [i.id, i.checked])).toEqual([
      ['g1', false],
      ['g2', false],
      ['i1', false],
      ['q1', false],
    ]);
    expect(list!.requiredOpen).toBe(2);
  });

  it('uses the platform of the content when it has its own, not the topic’s', async () => {
    const { service } = setup({
      templates: [
        general,
        instagram,
        { platform: 'X', items: [item('x1', 'کمتر از ۲۸۰ نویسه؟', true)] },
      ],
      content: {
        platform: 'X',
        topic: { platform: 'INSTAGRAM', businessId: 'b1' },
        checklistTicks: [],
      },
    });
    expect((await service.forContent('c1'))!.items.map((i) => i.id)).toEqual(['g1', 'g2', 'x1']);
  });

  it('shows who ticked a point and when, and counts it as done', async () => {
    const at = new Date('2026-10-14T08:00:00Z');
    const { service } = setup({
      templates: [general],
      ticks: [{ itemId: 'g1', createdAt: at, checkedBy: { name: 'سارا' } }],
    });
    const list = await service.forContent('c1');
    expect(list!.items[0]).toMatchObject({
      id: 'g1',
      checked: true,
      checkedAt: at.toISOString(),
      checkedByName: 'سارا',
    });
    expect(list!.requiredOpen).toBe(0);
  });

  it('ignores a tick whose point was removed from the checklist', async () => {
    const { service } = setup({
      templates: [general],
      ticks: [{ itemId: 'gone', createdAt: new Date(), checkedBy: null }],
    });
    expect((await service.forContent('c1'))!.items.every((i) => !i.checked)).toBe(true);
  });

  it('answers an automatic point from the quality report: done only with no warnings', async () => {
    const { service } = setup({ templates: [instagram] });
    const done = (await service.forContent('c1', { warnings: 0 }))!.items.find(
      (i) => i.id === 'q1',
    )!;
    const notDone = (await service.forContent('c1', { warnings: 2 }))!.items.find(
      (i) => i.id === 'q1',
    )!;
    const unknown = (await service.forContent('c1'))!.items.find((i) => i.id === 'q1')!;
    expect([done.checked, notDone.checked, unknown.checked]).toEqual([true, false, false]);
    // an automatic point never counts as an open required point
    expect((await service.forContent('c1', { warnings: 2 }))!.requiredOpen).toBe(1);
  });
});

describe('ChecklistsService.toggle', () => {
  it('ticks a point as the caller, and unticks it', async () => {
    const { service, prisma, audit } = setup({ templates: [general] });
    await service.toggle('c1', 'g1', { checked: true }, user);
    expect(prisma.contentChecklistTick.upsert).toHaveBeenCalledWith({
      where: { contentId_itemId: { contentId: 'c1', itemId: 'g1' } },
      create: { contentId: 'c1', itemId: 'g1', checkedById: 'u1' },
      update: {},
    });
    await service.toggle('c1', 'g1', { checked: false }, user);
    expect(prisma.contentChecklistTick.deleteMany).toHaveBeenCalledWith({
      where: { contentId: 'c1', itemId: 'g1' },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'content.checklist_check' }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'content.checklist_uncheck' }),
    );
  });

  it('refuses a point that is not in the content’s checklist, an automatic one, and a published content', async () => {
    const { service, prisma } = setup({ templates: [general, instagram] });
    await expect(service.toggle('c1', 'nope', { checked: true }, user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.toggle('c1', 'q1', { checked: true }, user)).rejects.toBeInstanceOf(
      ConflictException,
    );
    const published = setup({
      templates: [general],
      content: {
        platform: null,
        publishedAt: new Date(),
        topic: { platform: 'INSTAGRAM', businessId: 'b1' },
        checklistTicks: [],
      },
    });
    await expect(
      published.service.toggle('c1', 'g1', { checked: true }, user),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.contentChecklistTick.upsert).not.toHaveBeenCalled();
    expect(published.prisma.contentChecklistTick.upsert).not.toHaveBeenCalled();
  });

  it('a missing content is a 404', async () => {
    await expect(
      setup({ content: null }).service.toggle('c1', 'g1', { checked: true }, user),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ChecklistsService.assertReady', () => {
  it('passes without a checklist or with every required point ticked', async () => {
    await expect(setup({ templates: [] }).service.assertReady('c1')).resolves.toBeUndefined();
    await expect(
      setup({
        templates: [general],
        ticks: [{ itemId: 'g1', createdAt: new Date(), checkedBy: null }],
      }).service.assertReady('c1'),
    ).resolves.toBeUndefined();
  });

  it('answers 409 with the number of required points still open', async () => {
    const { service } = setup({ templates: [general, instagram] });
    await expect(service.assertReady('c1')).rejects.toThrow(/2 required checklist point/);
    await expect(service.assertReady('c1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ChecklistsService.save', () => {
  it('creates a checklist, giving new points an id and keeping the id of a point that has one', async () => {
    const { service, tx } = setup({ templates: [] });
    await service.save(
      'b1',
      {
        templates: [
          {
            platform: null,
            items: [
              { id: 'keep', text: 'لینک بیو عوض شده؟', required: true },
              { text: 'نکتهٔ تازه' },
            ],
          },
        ],
      },
      user,
    );
    const items = (
      tx.checklistTemplate.create.mock.calls[0]![0] as { data: { items: { id: string }[] } }
    ).data.items;
    expect(items[0]!.id).toBe('keep');
    expect(items[1]!.id).toMatch(/^[0-9a-f-]{8}$/);
  });

  it('updates the checklist of a platform that has one, removes those left out and those with no points', async () => {
    const { service, tx } = setup({
      templates: [general, instagram, { platform: 'X', items: [item('x1', 'نکته', false)] }],
    });
    await service.save(
      'b1',
      {
        templates: [
          { platform: null, items: [{ id: 'g1', text: 'لینک بیو عوض شده؟' }] },
          { platform: 'INSTAGRAM', items: [] },
        ],
      },
      user,
    );
    expect(tx.checklistTemplate.update).toHaveBeenCalledTimes(1);
    // Instagram had points but now has none; X was left out: both go
    expect(
      tx.checklistTemplate.delete.mock.calls
        .map((c) => (c[0] as { where: { id: string } }).where.id)
        .sort(),
    ).toEqual(['tpl1', 'tpl2']);
    expect(tx.checklistTemplate.create).not.toHaveBeenCalled();
  });

  it('refuses two points with one id', async () => {
    const { service } = setup();
    await expect(
      service.save(
        'b1',
        {
          templates: [
            {
              platform: null,
              items: [
                { id: 'a', text: 'نکتهٔ اول' },
                { id: 'a', text: 'نکتهٔ دوم' },
              ],
            },
          ],
        },
        user,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns the saved checklists and audits the change', async () => {
    const { service, audit } = setup({ templates: [general] });
    const saved: ChecklistTemplate[] = await service.save(
      'b1',
      { templates: [{ platform: null, items: [{ id: 'g1', text: 'لینک بیو عوض شده؟' }] }] },
      user,
    );
    expect(saved).toHaveLength(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'checklist.save', entityId: 'b1' }),
    );
  });
});

describe('ChecklistsService.clearTicks', () => {
  it('removes every tick of the content in the caller’s transaction', async () => {
    const { service } = setup();
    const deleteMany = vi.fn(async () => ({ count: 2 }));
    await service.clearTicks({ contentChecklistTick: { deleteMany } } as never, 'c1');
    expect(deleteMany).toHaveBeenCalledWith({ where: { contentId: 'c1' } });
  });
});
