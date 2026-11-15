import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AiExecutor } from '../ai/ai-executor.service';
import type { AiJobsService } from '../ai/ai-jobs.service';
import type { ContextLoader } from '../ai/context-loader.service';
import type { AuditService } from '../audit/audit.service';
import {
  BusinessChatRunner,
  cleanPoints,
  formatTranscript,
} from '../ai/runners/business-chat.runner';
import { BusinessChatService } from './business-chat.service';
import type { BusinessNotesService } from './notes-assets.service';

const user = { id: 'u1', role: 'ADMIN' } as AuthUser;
const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
const msg = (role: string, text: string, status = 'DONE') => ({ role, text, status });

describe('formatTranscript', () => {
  it('labels the speakers and skips pending or failed messages', () => {
    const out = formatTranscript([
      msg('USER', 'قیمت جدید ۵۰۰ هزار تومان است'),
      msg('ASSISTANT', 'متوجه شدم'),
      msg('USER', 'سؤال بعدی'),
      msg('ASSISTANT', '', 'PENDING'),
      msg('ASSISTANT', 'x', 'FAILED'),
    ]);
    expect(out).toBe('ADMIN: قیمت جدید ۵۰۰ هزار تومان است\n\nASSISTANT: متوجه شدم\n\nADMIN: سؤال بعدی');
  });

  it('keeps the newest messages when over budget and says so', () => {
    const old = msg('USER', 'a'.repeat(100));
    const recent = msg('USER', 'b'.repeat(100));
    const out = formatTranscript([old, recent], 130);
    expect(out).toContain('[earlier messages left out]');
    expect(out).toContain('b'.repeat(100));
    expect(out).not.toContain('a'.repeat(100));
  });
});

describe('cleanPoints', () => {
  it('drops empty points, orders sections by the profile and removes repeats', () => {
    const out = cleanPoints([
      { point: '  ', kind: 'FACT', sections: ['OVERVIEW'] },
      { point: ' قیمت ', kind: 'CORRECTION', sections: ['FAQ', 'SERVICES', 'FAQ'] },
    ]);
    expect(out).toEqual([{ point: 'قیمت', kind: 'CORRECTION', sections: ['SERVICES', 'FAQ'] }]);
  });
});

function runnerEnv(opts: { messages?: ReturnType<typeof msg>[]; reply?: unknown; digest?: unknown } = {}) {
  const updates: { message?: Record<string, unknown>; chat?: Record<string, unknown> } = {};
  const messages = (opts.messages ?? [msg('USER', 'ما از این ماه ارسال رایگان نداریم')]).map(
    (m, i) => ({ id: `m${i}`, ...m }),
  );
  const prisma = {
    businessChat: {
      findUnique: async () => ({ id: 'c1', businessId: 'b1', messages }),
      update: async ({ data }: { data: Record<string, unknown> }) => (updates.chat = data),
    },
    businessChatMessage: {
      findUnique: async () => ({ id: 'slot' }),
      update: async ({ data }: { data: Record<string, unknown> }) => (updates.message = data),
    },
    business: {
      findUniqueOrThrow: async () => ({
        id: 'b1',
        name: 'Acme',
        tagline: '',
        industry: '',
        website: '',
        location: '',
        language: 'fa',
        gaps: [],
        sections: [],
        facts: [],
        terms: [],
        assets: [],
        offerings: [],
      }),
    },
  };
  const execute = vi.fn(async (args: { promptKey: string }) => ({
    data: args.promptKey === 'business_chat_digest' ? opts.digest : opts.reply,
    model: 'm',
    usage,
    prompt: { key: args.promptKey, version: 1 },
  }));
  const ctx = { standingNotes: async () => [] };
  const runner = new BusinessChatRunner(
    prisma as unknown as PrismaService,
    { execute } as unknown as AiExecutor,
    ctx as unknown as ContextLoader,
  );
  return { runner, updates, execute };
}

describe('BusinessChatRunner', () => {
  it('fills the reply slot and never touches the profile', async () => {
    const { runner, updates, execute } = runnerEnv({
      reply: {
        reply: 'پس ارسال رایگان حذف شد؛ آیا آستانهٔ خرید هم عوض می‌شود؟',
        understood: [
          { point: 'ارسال رایگان حذف شد', kind: 'CORRECTION', sections: ['SERVICES', 'FAQ'] },
        ],
        questions: ['a', 'b', 'c'],
        conflicts: [],
      },
    });
    await runner.run({ id: 'j', targetId: 'b1', input: { chatId: 'c1', messageId: 'slot', mode: 'REPLY' } } as never);
    expect(execute.mock.calls[0]![0].promptKey).toBe('business_chat');
    expect(updates.message).toMatchObject({ status: 'DONE', questions: ['a', 'b'] });
    expect(updates.chat).toBeUndefined();
  });

  it('turns the transcript into a digest and remembers how many messages it covers', async () => {
    const { runner, updates } = runnerEnv({
      messages: [msg('USER', 'الف'), msg('ASSISTANT', 'ب'), msg('USER', 'ج')],
      digest: {
        summary: 'خلاصه',
        noteText: 'ارسال رایگان حذف شد.',
        points: [{ point: 'ارسال رایگان حذف شد', kind: 'CORRECTION', sections: ['SERVICES'] }],
        openQuestions: [' ', 'آستانهٔ خرید؟'],
      },
    });
    await runner.run({ id: 'j', targetId: 'b1', input: { chatId: 'c1', mode: 'DIGEST' } } as never);
    expect(updates.chat).toMatchObject({ digestStatus: 'DONE', digestUpTo: 3 });
    expect((updates.chat!.digest as { openQuestions: string[] }).openQuestions).toEqual(['آستانهٔ خرید؟']);
  });

  it('marks the right thing failed', async () => {
    const calls: Record<string, unknown>[] = [];
    const prisma = {
      businessChat: { updateMany: async (a: unknown) => calls.push({ chat: a }) },
      businessChatMessage: { updateMany: async (a: unknown) => calls.push({ message: a }) },
    };
    const runner = new BusinessChatRunner(prisma as never, {} as never, {} as never);
    await runner.onFailure({ input: { chatId: 'c1', mode: 'DIGEST' } } as never, 'boom');
    await runner.onFailure({ input: { chatId: 'c1', messageId: 'slot', mode: 'REPLY' } } as never, 'boom');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toHaveProperty('chat');
    expect(calls[1]).toHaveProperty('message');
  });
});

describe('BusinessChatService', () => {
  function serviceEnv(chat: Record<string, unknown> | null) {
    const created: Record<string, unknown>[] = [];
    const prisma = {
      business: { findUnique: async () => ({ id: 'b1' }) },
      businessChat: {
        findFirst: async () => chat,
        findUnique: async () => chat,
        create: async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'c-new',
          messages: [],
          ...data,
        }),
        update: vi.fn(async () => ({})),
        delete: vi.fn(async () => ({})),
      },
      businessChatMessage: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: `m${created.length}`, ...data };
        },
        update: async () => ({}),
        delete: async () => ({}),
      },
    };
    const enqueue = vi.fn(async (_a: unknown) => ({ id: 'job1' }));
    const noteCreate = vi.fn(async (_b: string, _i: unknown, _u: unknown) => ({ id: 'n1', jobId: 'j2' }));
    const service = new BusinessChatService(
      prisma as unknown as PrismaService,
      { log: vi.fn() } as unknown as AuditService,
      { enqueue } as unknown as AiJobsService,
      { create: noteCreate } as unknown as BusinessNotesService,
    );
    return { service, prisma, created, enqueue, noteCreate };
  }

  it('starts a conversation, stores the message and queues one reply job', async () => {
    const { service, created, enqueue } = serviceEnv(null);
    await service.send('b1', { text: 'سلام' }, user);
    expect(created.map((c) => c.role)).toEqual(['USER', 'ASSISTANT']);
    expect(enqueue.mock.calls[0]![0]).toMatchObject({
      type: 'BUSINESS_CHAT',
      input: { chatId: 'c-new', mode: 'REPLY' },
    });
  });

  it('refuses a message while AI is still answering', async () => {
    const { service } = serviceEnv({ id: 'c1', digestStatus: 'NONE', messages: [{ status: 'PENDING' }] });
    await expect(service.send('b1', { text: 'x' }, user)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('applies only a finished digest, through a normal note, and closes the conversation', async () => {
    const open = { id: 'c1', businessId: 'b1', state: 'OPEN', messages: [] };
    const noDigest = serviceEnv({ ...open, digestStatus: 'NONE', digest: null });
    await expect(
      noDigest.service.apply('c1', { noteText: 'متن یادداشت', apply: 'DIRECT' }, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(noDigest.noteCreate).not.toHaveBeenCalled();

    const ready = serviceEnv({
      ...open,
      digestStatus: 'DONE',
      digest: { summary: 's', noteText: 'متن', points: [], openQuestions: [] },
    });
    await ready.service.apply('c1', { noteText: 'متن ویرایش‌شده', apply: 'SUGGEST', scope: 'NONE' }, user);
    expect(ready.noteCreate.mock.calls[0]![1]).toMatchObject({ text: 'متن ویرایش‌شده', apply: 'SUGGEST' });
    expect(ready.prisma.businessChat.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { state: 'APPLIED', noteId: 'n1' },
    });
  });

  it('leaves the conversation open when the note is refused', async () => {
    const env = serviceEnv({
      id: 'c1',
      businessId: 'b1',
      state: 'OPEN',
      messages: [],
      digestStatus: 'DONE',
      digest: { summary: 's', noteText: 'متن', points: [], openQuestions: [] },
    });
    env.noteCreate.mockRejectedValueOnce(new BadRequestException('A build is running'));
    await expect(
      env.service.apply('c1', { noteText: 'متن یادداشت', apply: 'DIRECT' }, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(env.prisma.businessChat.update).not.toHaveBeenCalled();
  });
});
