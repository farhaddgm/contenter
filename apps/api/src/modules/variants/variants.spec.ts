import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { SettingsService } from '../settings/settings.module';
import { NOT_CHOSEN_NOTE, VariantsService } from './variants.module';

const user = { id: 'u1', role: 'EDITOR' } as AuthUser;

const TEXT =
  'قهوه را تازه آسیاب کنید و آب را کمی صبر بدهید تا از جوش بیفتد. بعد آرام روی قهوه بریزید و سی ثانیه صبر کنید. حالا یک فنجان قهوهٔ خوب دارید.';
const OTHER =
  'مسابقهٔ فوتبال شب گذشته با نتیجهٔ دو بر یک به پایان رسید و هواداران تا دیروقت در خیابان‌ها جشن گرفتند. داور بازی هم تحسین شد.';

const row = (id: string, status: string, body: string | null, angle: string | null = null) => ({
  id,
  status,
  platform: null,
  format: 'POST',
  variantAngle: angle,
  topic: { platform: 'INSTAGRAM' },
  currentVersion: body === null ? null : { title: `عنوان ${id}`, body, hashtags: [], cta: '' },
});

function setup(
  rows: ReturnType<typeof row>[],
  base: unknown = { id: 'a', topicId: 't1', variantGroupId: 'g1' },
) {
  const rowsNow = rows.map((r) => ({ ...r }));
  const txUpdate = vi.fn(async (a: { where: { id: string }; data: { status: string } }) => {
    const r = rowsNow.find((x) => x.id === a.where.id)!;
    r.status = a.data.status;
    return { currentVersionId: `v-${a.where.id}` };
  });
  const create = vi.fn(async (_a: unknown) => ({}));
  const findMany = vi.fn(async (_a: unknown) => rowsNow);
  const prisma = {
    content: { findUnique: async () => base, findMany },
    $transaction: async (fn: (t: unknown) => Promise<void>) =>
      fn({ content: { update: txUpdate }, contentReview: { create } }),
  };
  const log = vi.fn();
  const svc = new VariantsService(
    prisma as unknown as PrismaService,
    { log } as unknown as AuditService,
    {
      getReadability: async () => ({ extraPhrases: [], maxAvgSentenceWords: null }),
    } as unknown as SettingsService,
  );
  return { svc, txUpdate, create, log, findMany };
}

describe('VariantsService.group', () => {
  it('asks for the whole group of the content, and a lone content is a group of one', async () => {
    const a = setup([row('a', 'DRAFT', TEXT)]);
    await a.svc.group('a');
    expect(a.findMany.mock.calls[0]![0]).toMatchObject({
      where: { variantGroupId: 'g1', topicId: 't1' },
    });
    const b = setup([row('a', 'DRAFT', TEXT)], { id: 'a', topicId: 't1', variantGroupId: null });
    const g = await b.svc.group('a');
    expect(b.findMany.mock.calls[0]![0]).toMatchObject({ where: { id: 'a' } });
    expect(g.items).toHaveLength(1);
    expect(g.items[0]!.similarTo).toBeNull();
  });

  it('computes the numbers by code: length, warnings, readability and similarity between drafts', async () => {
    const { svc } = setup([
      row('a', 'DRAFT', TEXT, 'DIRECT'),
      row('b', 'DRAFT', TEXT.replace('کنید', 'کنین'), 'STORY'),
      row('c', 'DRAFT', OTHER, 'QUESTION'),
      row('d', 'GENERATING', null),
    ]);
    const g = await svc.group('a');
    const by = Object.fromEntries(g.items.map((i) => [i.id, i]));
    expect(by.a!.angle).toBe('DIRECT');
    expect(by.a!.length).toBeGreaterThan(50);
    expect(by.a!.maxChars).toBe(2200);
    expect(by.a!.avgSentenceWords).toBeGreaterThan(0);
    // a and b are the same draft with one word changed; c is unrelated
    expect(by.a!.similarTo).toBeGreaterThan(0.5);
    expect(by.c!.similarTo).toBeLessThan(0.2);
    // a draft still being written has no text and no numbers, and is not compared
    expect(by.d).toMatchObject({ body: '', length: 0, similarTo: null, warnings: 0 });
  });

  it('a missing content is a 404', async () => {
    await expect(setup([], null).svc.group('x')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('VariantsService.pick', () => {
  it('sends the other drafts to REJECTED with a history entry and keeps the chosen one', async () => {
    const { svc, txUpdate, create, log } = setup([
      row('a', 'DRAFT', TEXT),
      row('b', 'DRAFT', OTHER),
      row('c', 'FAILED', null),
    ]);
    await svc.pick('a', user);
    expect(txUpdate.mock.calls.map((c) => c[0].where.id)).toEqual(['b', 'c']);
    expect(txUpdate.mock.calls[0]![0].data).toMatchObject({
      status: 'REJECTED',
      reviewStage: null,
      scheduledAt: null,
    });
    expect(create.mock.calls[0]![0]).toMatchObject({
      data: { contentId: 'b', decision: 'REJECTED', actorId: 'u1', note: NOT_CHOSEN_NOTE },
    });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'content.variant_pick',
        meta: expect.objectContaining({ rejected: ['b', 'c'] }),
      }),
    );
  });

  it('leaves a draft someone already sent to review alone', async () => {
    const { svc, txUpdate, log } = setup([row('a', 'DRAFT', TEXT), row('b', 'IN_REVIEW', OTHER)]);
    await svc.pick('a', user);
    expect(txUpdate).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ kept: ['b'] }) }),
    );
  });

  it('refuses while another draft is being written, and for a chosen draft that is not a draft', async () => {
    const wait = setup([row('a', 'DRAFT', TEXT), row('b', 'GENERATING', null)]);
    await expect(wait.svc.pick('a', user)).rejects.toBeInstanceOf(ConflictException);
    expect(wait.txUpdate).not.toHaveBeenCalled();
    const notDraft = setup([row('a', 'APPROVED', TEXT), row('b', 'DRAFT', OTHER)]);
    await expect(notDraft.svc.pick('a', user)).rejects.toBeInstanceOf(ConflictException);
    expect(notDraft.txUpdate).not.toHaveBeenCalled();
  });
});
