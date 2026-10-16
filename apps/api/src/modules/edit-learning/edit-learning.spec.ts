import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AcceptLearningSuggestionSchema, MIN_EDIT_PAIRS } from '@contenter/shared';
import type { AiJob, LearningSuggestion as Row } from '@prisma/client';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AiExecutor } from '../ai/ai-executor.service';
import type { AiJobsService } from '../ai/ai-jobs.service';
import type { ContextLoader } from '../ai/context-loader.service';
import { LearnFromEditsRunner } from '../ai/runners/learn-from-edits.runner';
import { NonRetryableAiError } from '../ai/provider/ai-provider';
import type { AuditService } from '../audit/audit.service';
import { EditLearningService, toSuggestion } from './edit-learning.module';

const user = { id: 'u1', role: 'EDITOR' } as AuthUser;

const body = Array.from({ length: 40 }, (_, i) => `کلمه${i}`).join(' ');
const editedBody = body
  .replace('کلمه5', 'عبارت')
  .replace('کلمه9', 'جمله')
  .replace('کلمه20', 'واژه');
const version = (n: number, text: string) => ({
  version: n,
  title: 'عنوان',
  body: text,
  hashtags: [] as string[],
  cta: '',
});

const row = (over: Partial<Row> = {}): Row => ({
  id: 's1',
  topicId: 't1',
  runId: 'r1',
  kind: 'AVOID',
  category: 'OPENING',
  text: 'مقدمه را با احوال‌پرسی شروع نکن',
  rationale: 'چند بار حذف شده',
  evidence: [
    {
      contentId: 'c1',
      contentTitle: 'T',
      fromVersion: 1,
      toVersion: 2,
      changeRatio: 0.1,
      excerpt: '{-a-}',
    },
  ],
  status: 'PENDING',
  principleId: null,
  decidedById: null,
  decidedAt: null,
  createdAt: new Date('2026-10-13T10:00:00Z'),
  ...over,
});

describe('EditLearningService', () => {
  function setup(
    opts: {
      edited?: number;
      approved?: number;
      unedited?: number;
      running?: boolean;
      suggestion?: Row | null;
    } = {},
  ) {
    const counts = [opts.approved ?? 10, opts.edited ?? 8, opts.unedited ?? 2];
    let call = 0;
    const tx = {
      learningSuggestion: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => undefined),
      },
      principle: {
        count: vi.fn(async () => 3),
        create: vi.fn(async ({ data }: { data: object }) => ({ id: 'p1', ...data })),
      },
    };
    const prisma = {
      content: { count: vi.fn(async () => counts[call++ % 3]) },
      aiJob: {
        findFirst: vi.fn(async () => (opts.running ? { id: 'j1', status: 'RUNNING' } : null)),
      },
      editLearningRun: { findFirst: vi.fn(async () => null) },
      learningSuggestion: {
        findMany: vi.fn(async () => []),
        findUnique: vi.fn(async () => (opts.suggestion === undefined ? row() : opts.suggestion)),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const ai = { enqueue: vi.fn(async () => ({ id: 'job1' }) as AiJob) };
    const audit = { log: vi.fn() };
    const service = new EditLearningService(
      prisma as unknown as PrismaService,
      ai as unknown as AiJobsService,
      audit as unknown as AuditService,
    );
    return { service, prisma, tx, ai, audit };
  }

  it('counts approved, edited and unedited contents and says when there is enough to learn from', async () => {
    const { service } = setup({ approved: 10, edited: MIN_EDIT_PAIRS, unedited: 4 });
    const o = await service.overview('t1');
    expect(o.stats).toEqual({
      approved: 10,
      edited: MIN_EDIT_PAIRS,
      unedited: 4,
      uneditedShare: 0.4,
    });
    expect(o.eligible).toBe(true);
    expect(o.minPairs).toBe(MIN_EDIT_PAIRS);
    expect(o.activeJob).toBeNull();
  });

  it('is not eligible with too few edited contents, and the share is null with nothing approved', async () => {
    const { service } = setup({ approved: 0, edited: 0, unedited: 0 });
    const o = await service.overview('t1');
    expect(o.eligible).toBe(false);
    expect(o.stats.uneditedShare).toBeNull();
  });

  it('shows the analysis that is running', async () => {
    const { service } = setup({ running: true });
    expect((await service.overview('t1')).activeJob).toEqual({ id: 'j1', status: 'RUNNING' });
  });

  it('queues the analysis as a job for the topic', async () => {
    const { service, ai } = setup({ edited: MIN_EDIT_PAIRS });
    const accepted = await service.requestAnalysis('t1', user);
    expect(accepted).toEqual({ jobId: 'job1' });
    expect(ai.enqueue).toHaveBeenCalledWith({
      type: 'LEARN_FROM_EDITS',
      targetType: 'Topic',
      targetId: 't1',
      topicId: 't1',
      userId: 'u1',
    });
  });

  it('refuses when there are too few edited contents, or an analysis is already running', async () => {
    const few = setup({ edited: MIN_EDIT_PAIRS - 1 });
    await expect(few.service.requestAnalysis('t1', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(few.ai.enqueue).not.toHaveBeenCalled();
    const busy = setup({ edited: 9, running: true });
    await expect(busy.service.requestAnalysis('t1', user)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(busy.ai.enqueue).not.toHaveBeenCalled();
  });

  it('turns an accepted suggestion into a principle of the topic, at the end of the list', async () => {
    const { service, tx, audit } = setup();
    const p = await service.accept('s1', {}, user);
    expect(tx.principle.create).toHaveBeenCalledWith({
      data: { topicId: 't1', kind: 'AVOID', text: 'مقدمه را با احوال‌پرسی شروع نکن', order: 3 },
    });
    expect(tx.learningSuggestion.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { principleId: 'p1' },
    });
    expect(p).toMatchObject({ id: 'p1' });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'learning.accept', entityId: 's1' }),
    );
  });

  it('lets the admin reword the suggestion or change its kind when accepting', async () => {
    const { service, tx } = setup();
    await service.accept('s1', { text: '  مقدمه کوتاه  ', kind: 'PREFER' }, user);
    expect(tx.principle.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'PREFER', text: 'مقدمه کوتاه' }),
    });
  });

  it('does not create a second principle when the suggestion was decided meanwhile', async () => {
    const { service, tx } = setup();
    tx.learningSuggestion.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.accept('s1', {}, user)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.principle.create).not.toHaveBeenCalled();
  });

  it('refuses to decide twice, and a missing suggestion is a 404', async () => {
    await expect(
      setup({ suggestion: row({ status: 'ACCEPTED' }) }).service.accept('s1', {}, user),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      setup({ suggestion: row({ status: 'DISMISSED' }) }).service.dismiss('s1', user),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(setup({ suggestion: null }).service.accept('s1', {}, user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('dismisses a suggestion without creating a principle', async () => {
    const { service, prisma, tx, audit } = setup();
    await service.dismiss('s1', user);
    expect(prisma.learningSuggestion.updateMany).toHaveBeenCalledWith({
      where: { id: 's1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'DISMISSED', decidedById: 'u1' }),
    });
    expect(tx.principle.create).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'learning.dismiss' }));
  });

  it('shows a stored suggestion with its evidence and dates as the API returns it', () => {
    const s = toSuggestion(
      row({ status: 'ACCEPTED', principleId: 'p9', decidedAt: new Date('2026-10-14T00:00:00Z') }),
    );
    expect(s).toMatchObject({
      id: 's1',
      category: 'OPENING',
      principleId: 'p9',
      decidedAt: '2026-10-14T00:00:00.000Z',
    });
    expect(s.evidence[0]).toMatchObject({ contentId: 'c1', changeRatio: 0.1 });
  });
});

describe('AcceptLearningSuggestionSchema', () => {
  it('accepts nothing, or a reworded text and kind', () => {
    expect(AcceptLearningSuggestionSchema.parse({})).toEqual({});
    expect(AcceptLearningSuggestionSchema.parse({ text: ' abc ', kind: 'MUST' })).toEqual({
      text: 'abc',
      kind: 'MUST',
    });
  });
  it('rejects an empty text and an unknown kind', () => {
    expect(AcceptLearningSuggestionSchema.safeParse({ text: 'a' }).success).toBe(false);
    expect(AcceptLearningSuggestionSchema.safeParse({ kind: 'NEVER' }).success).toBe(false);
  });
});

describe('LearnFromEditsRunner', () => {
  const pairRow = (id: string) => ({
    id,
    title: `محتوا ${id}`,
    currentVersion: version(2, editedBody),
    versions: [version(1, body)],
  });

  function setup(
    opts: {
      contents?: number;
      answer?: unknown;
      principles?: { text: string }[];
      known?: { text: string; status: string }[];
    } = {},
  ) {
    const contents = Array.from({ length: opts.contents ?? 7 }, (_, i) => pairRow(`c${i + 1}`));
    const created: { suggestions: unknown[] } = { suggestions: [] };
    const tx = {
      editLearningRun: {
        create: vi.fn(async ({ data }: { data: object }) => ({ id: 'run1', ...data })),
      },
      learningSuggestion: {
        createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
          created.suggestions = data;
        }),
      },
    };
    const prisma = {
      topic: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: 't1',
          title: 'T',
          description: 'd',
          audience: '',
          platform: 'INSTAGRAM',
          language: 'fa',
        })),
      },
      content: { findMany: vi.fn(async () => contents) },
      learningSuggestion: { findMany: vi.fn(async () => opts.known ?? []) },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const execute = vi.fn(async () => ({
      data: opts.answer ?? {
        suggestions: [
          {
            kind: 'AVOID',
            category: 'OPENING',
            text: 'مقدمه را با احوال‌پرسی شروع نکن',
            rationale: 'r',
            evidence: ['P1', 'P2', 'P3'],
          },
        ],
      },
      model: 'm',
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      prompt: { key: 'learn_from_edits', version: 0 },
    }));
    const ctx = {
      business: vi.fn(async () => null),
      principles: vi.fn(async () => opts.principles ?? []),
    };
    const runner = new LearnFromEditsRunner(
      prisma as unknown as PrismaService,
      { execute } as unknown as AiExecutor,
      ctx as unknown as ContextLoader,
    );
    return { runner, execute, tx, created, prisma };
  }
  const job = { id: 'job1', targetId: 't1' } as AiJob;

  it('shows the model the changed passages, then stores only suggestions backed by real pairs', async () => {
    const { runner, execute, tx, created } = setup();
    const result = await runner.run(job);
    const call = (
      execute.mock.calls as unknown as [
        { promptKey: string; vars: Record<string, string | number> },
      ][]
    )[0]![0];
    expect(call.promptKey).toBe('learn_from_edits');
    expect(call.vars.pair_count).toBe(7);
    expect(String(call.vars.pairs)).toContain('<pair id="P1"');
    expect(String(call.vars.pairs)).toContain('{-کلمه5-} {+عبارت+}');
    expect(tx.editLearningRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ topicId: 't1', jobId: 'job1', pairCount: 7 }),
    });
    expect(created.suggestions).toHaveLength(1);
    expect(created.suggestions[0]).toMatchObject({
      runId: 'run1',
      kind: 'AVOID',
      category: 'OPENING',
    });
    expect(
      (created.suggestions[0] as { evidence: { contentId: string }[] }).evidence.map(
        (e) => e.contentId,
      ),
    ).toEqual(['c1', 'c2', 'c3']);
    expect(result.output).toMatchObject({ runId: 'run1', pairs: 7, suggestions: 1, dropped: 0 });
  });

  it('refuses without retrying when too few contents were really edited', async () => {
    const { runner, execute } = setup({ contents: MIN_EDIT_PAIRS - 1 });
    await expect(runner.run(job)).rejects.toBeInstanceOf(NonRetryableAiError);
    expect(execute).not.toHaveBeenCalled();
  });

  it('drops invented evidence and repeats of existing principles, and says how many', async () => {
    const answer = {
      suggestions: [
        {
          kind: 'AVOID',
          category: 'OPENING',
          text: 'مقدمه را با احوال‌پرسی شروع نکن',
          rationale: '',
          evidence: ['P1', 'P2'],
        },
        {
          kind: 'MUST',
          category: 'CTA',
          text: 'در پایان همیشه قیمت را بنویس',
          rationale: '',
          evidence: ['P1', 'P99'],
        },
        {
          kind: 'PREFER',
          category: 'LENGTH',
          text: 'جمله‌ها را کوتاه بنویس',
          rationale: '',
          evidence: ['P4', 'P5'],
        },
      ],
    };
    const { runner, created } = setup({ answer, principles: [{ text: 'جمله‌ها را کوتاه بنویس' }] });
    const result = await runner.run(job);
    expect(created.suggestions).toHaveLength(1);
    expect(result.output).toMatchObject({ suggestions: 1, dropped: 2 });
  });

  it('does not create a suggestion row when the model finds no pattern, but records the run', async () => {
    const { runner, tx } = setup({ answer: { suggestions: [] } });
    const result = await runner.run(job);
    expect(tx.learningSuggestion.createMany).not.toHaveBeenCalled();
    expect(tx.editLearningRun.create).toHaveBeenCalled();
    expect(result.output).toMatchObject({ suggestions: 0 });
  });

  it('tells the model what was already proposed or rejected', async () => {
    const { runner, execute } = setup({ known: [{ text: 'قاعدهٔ رد‌شده', status: 'DISMISSED' }] });
    await runner.run(job);
    const vars = (execute.mock.calls as unknown as [{ vars: Record<string, string> }][])[0]![0]
      .vars;
    expect(vars.known_suggestions).toContain('[DISMISSED] قاعدهٔ رد‌شده');
  });
});
