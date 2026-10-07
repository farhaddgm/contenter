import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AccessService } from '../../common/access';
import type { AuthUser } from '../../common/auth.decorators';
import type { AuditService } from '../audit/audit.service';
import type { AiJobsService } from '../ai/ai-jobs.service';
import type { ReviewsService } from '../reviews/reviews.service';
import { ContentsService } from './contents.module';
import { RepurposeContentRunner } from '../ai/runners/content.runners';
import { NonRetryableAiError } from '../ai/provider/ai-provider';
import type { AiExecutor } from '../ai/ai-executor.service';
import type { ContextLoader } from '../ai/context-loader.service';

const user: AuthUser = { id: 'u1', email: 'u@x.test', role: 'EDITOR' };
const audit = { log: vi.fn() } as unknown as AuditService;

const source = (over: Record<string, unknown> = {}) => ({
  id: 'src',
  topicId: 't1',
  title: 'سه اشتباه رایج',
  status: 'APPROVED',
  campaignId: 'k1',
  currentVersionId: 'v1',
  tags: [{ id: 'g1' }, { id: 'g2' }],
  ...over,
});

function makeService(found: unknown) {
  let n = 0;
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: `new${++n}`,
    ...data,
  }));
  const update = vi.fn(async () => ({}));
  const enqueue = vi.fn(async () => ({ id: `job${n}` }));
  const prisma = { content: { findUnique: async () => found, create, update } };
  const svc = new ContentsService(
    prisma as unknown as PrismaService,
    { enqueue } as unknown as AiJobsService,
    audit,
    {} as AccessService,
    {} as ReviewsService,
  );
  return { svc, create, update, enqueue };
}

describe('ContentsService.repurpose', () => {
  it('creates one empty content and one AI job per target', async () => {
    const { svc, create, enqueue } = makeService(source());
    const res = await svc.repurpose(
      'src',
      {
        targets: [{ platform: 'X' }, { platform: 'LINKEDIN', format: 'POST' }],
        notes: 'کوتاه‌تر و رسمی‌تر',
      },
      user,
    );
    expect(res.items).toEqual([
      { contentId: 'new1', jobId: 'job1', platform: 'X', format: 'THREAD' },
      { contentId: 'new2', jobId: 'job2', platform: 'LINKEDIN', format: 'POST' },
    ]);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]![0].data).toMatchObject({
      topicId: 't1',
      sourceContentId: 'src',
      platform: 'X',
      format: 'THREAD',
      status: 'GENERATING',
      brief: 'کوتاه‌تر و رسمی‌تر',
      campaignId: 'k1',
      createdById: 'u1',
      tags: { connect: [{ id: 'g1' }, { id: 'g2' }] },
    });
    expect(enqueue.mock.calls[0]![0]).toMatchObject({
      type: 'REPURPOSE_CONTENT',
      targetType: 'Content',
      targetId: 'new1',
      topicId: 't1',
      input: { platform: 'X', format: 'THREAD', sourceContentId: 'src' },
      userId: 'u1',
    });
  });

  it('records the job on the new content', async () => {
    const { svc, update } = makeService(source());
    await svc.repurpose('src', { targets: [{ platform: 'TELEGRAM' }] }, user);
    expect(update).toHaveBeenCalledWith({ where: { id: 'new1' }, data: { lastJobId: 'job1' } });
  });

  it('does not copy tags when the source has none', async () => {
    const { svc, create } = makeService(source({ tags: [] }));
    await svc.repurpose('src', { targets: [{ platform: 'X' }] }, user);
    expect(create.mock.calls[0]![0].data.tags).toBeUndefined();
  });

  it('adapts a published content too (publishing freezes edits, not copies)', async () => {
    const { svc } = makeService(source({ publishedAt: new Date() }));
    await expect(
      svc.repurpose('src', { targets: [{ platform: 'X' }] }, user),
    ).resolves.toBeDefined();
  });

  it('refuses a content with no finished draft', async () => {
    for (const over of [{ currentVersionId: null }, { status: 'GENERATING' }]) {
      const { svc, create } = makeService(source(over));
      await expect(svc.repurpose('src', { targets: [{ platform: 'X' }] }, user)).rejects.toThrow(
        BadRequestException,
      );
      expect(create).not.toHaveBeenCalled();
    }
  });

  it('404s for a missing content and rejects an empty target list', async () => {
    await expect(
      makeService(null).svc.repurpose('x', { targets: [{ platform: 'X' }] }, user),
    ).rejects.toThrow(NotFoundException);
    await expect(
      makeService(source()).svc.repurpose('src', { targets: [] }, user),
    ).rejects.toThrow();
  });
});

describe('RepurposeContentRunner', () => {
  const shell = (over: Record<string, unknown> = {}) => ({
    id: 'new1',
    topicId: 't1',
    platform: 'X',
    format: 'THREAD',
    topic: {
      id: 't1',
      title: 'سرمایه‌گذاری',
      description: 'توضیح',
      audience: '',
      platform: 'INSTAGRAM',
      language: 'fa',
    },
    source: {
      id: 'src',
      platform: null,
      format: 'POST',
      topic: { platform: 'INSTAGRAM' },
      currentVersion: {
        title: 'سه اشتباه',
        body: 'متن اصلی',
        hashtags: ['#یک'],
        cta: 'ذخیره کن',
        notes: '',
      },
    },
    ...over,
  });

  function makeRunner(content: unknown) {
    const tx = {
      contentVersion: { create: vi.fn(async () => ({ id: 'ver1' })) },
      content: { update: vi.fn(async () => ({})) },
    };
    const prisma = {
      content: { findUniqueOrThrow: async () => content },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    };
    const execute = vi.fn(async () => ({
      data: {
        title: '  سه اشتباه — رشتهٔ ایکس ',
        body: '۱/ ...',
        hashtags: [' #رشد '],
        cta: 'ریتوییت کن',
        notes: 'کاور ساده',
        selfCheck: { score: 14, principles: [], suggestions: [] },
      },
      model: 'm',
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      prompt: { key: 'repurpose_content', version: 0 },
    }));
    const ctx = {
      business: async () => null,
      principles: async () => [],
      activeProfile: async () => ({ id: 'p1', summary: '', styleGuide: '', traits: [] }),
      brandDocs: async () => [],
    };
    const runner = new RepurposeContentRunner(
      prisma as unknown as PrismaService,
      { execute } as unknown as AiExecutor,
      ctx as unknown as ContextLoader,
    );
    return { runner, execute, tx };
  }

  const job = { id: 'job1', targetId: 'new1', input: { notes: ' رسمی‌تر ' } } as never;

  it('writes the first version from the source draft for the target, and clamps the score', async () => {
    const { runner, execute, tx } = makeRunner(shell());
    const out = await runner.run(job);

    const args = execute.mock.calls[0]![0] as {
      task: string;
      promptKey: string;
      vars: Record<string, string>;
    };
    expect(args).toMatchObject({ task: 'REPURPOSE_CONTENT', promptKey: 'repurpose_content' });
    expect(args.vars).toMatchObject({
      language: 'fa',
      target_platform: 'X',
      target_format: 'THREAD',
      direction: 'رسمی‌تر',
    });
    // the topic block names the target platform, the source block the original one
    expect(args.vars.topic).toContain('Platform: X');
    expect(args.vars.source).toContain('Platform: INSTAGRAM');
    expect(args.vars.source).toContain('متن اصلی');

    expect(tx.contentVersion.create.mock.calls[0]![0].data).toMatchObject({
      contentId: 'new1',
      version: 1,
      source: 'AI',
      title: 'سه اشتباه — رشتهٔ ایکس',
      hashtags: ['#رشد'],
      feedback: 'رسمی‌تر',
    });
    expect(tx.content.update).toHaveBeenCalledWith({
      where: { id: 'new1' },
      data: {
        currentVersionId: 'ver1',
        title: 'سه اشتباه — رشتهٔ ایکس',
        status: 'DRAFT',
        profileId: 'p1',
      },
    });
    expect(out.output).toMatchObject({
      contentId: 'new1',
      sourceContentId: 'src',
      platform: 'X',
      format: 'THREAD',
      score: 14,
    });
  });

  it('falls back to the topic platform and "(none)" when nothing was asked', async () => {
    const { runner, execute } = makeRunner(shell({ platform: null }));
    await runner.run({ id: 'j', targetId: 'new1', input: {} } as never);
    const vars = (execute.mock.calls[0]![0] as { vars: Record<string, string> }).vars;
    expect(vars.target_platform).toBe('INSTAGRAM');
    expect(vars.direction).toBe('(none)');
  });

  it('fails for good when the source has no draft', async () => {
    const noDraft = shell();
    (noDraft.source as { currentVersion: unknown }).currentVersion = null;
    await expect(makeRunner(noDraft).runner.run(job)).rejects.toThrow(NonRetryableAiError);
    await expect(makeRunner(shell({ source: null })).runner.run(job)).rejects.toThrow(
      NonRetryableAiError,
    );
  });
});
