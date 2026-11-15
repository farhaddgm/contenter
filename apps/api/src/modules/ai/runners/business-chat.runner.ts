import { Injectable } from '@nestjs/common';
import type { AiJob, Prisma } from '@prisma/client';
import {
  BUSINESS_CHAT_TRANSCRIPT_CHARS,
  BUSINESS_NOTE_MAX_CHARS,
  BusinessChatDigestSchema,
  BusinessChatReplySchema,
  BusinessSectionKey,
  type ChatPoint,
} from '@contenter/shared';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { BUSINESS_PROMPT_INCLUDE } from '../../businesses/business-api';
import { AiExecutor } from '../ai-executor.service';
import { formatBusiness, formatSectionSpec, formatStandingNotes } from '../context';
import { ContextLoader } from '../context-loader.service';
import { NonRetryableAiError } from '../provider/ai-provider';
import type { AiRunner, RunnerResult } from './runner';

const MAX_POINTS = 40;
const MAX_QUESTIONS = 2;
const MAX_CONFLICTS = 6;

export type ChatJobInput = { chatId?: string; messageId?: string; mode?: 'REPLY' | 'DIGEST' };

const asJson = (v: unknown) => v as Prisma.InputJsonValue;

/**
 * Transcript for the prompt: oldest to newest, the newest messages kept when over budget.
 * Only finished messages count (a pending reply or a failed one is not part of the talk).
 */
export function formatTranscript(
  messages: { role: string; text: string; status: string }[],
  budget = BUSINESS_CHAT_TRANSCRIPT_CHARS,
): string {
  const done = messages.filter((m) => m.status === 'DONE' && m.text.trim());
  const lines: string[] = [];
  let left = budget;
  for (let i = done.length - 1; i >= 0; i--) {
    const m = done[i]!;
    const line = `${m.role === 'USER' ? 'ADMIN' : 'ASSISTANT'}: ${m.text.trim()}`;
    if (line.length > left && lines.length) break;
    lines.unshift(line.length > left ? line.slice(0, left) : line);
    left -= line.length;
    if (left <= 0) break;
  }
  const cut = lines.length < done.length;
  return [cut ? '[earlier messages left out]' : '', ...lines].filter(Boolean).join('\n\n');
}

/** Keeps the model's points usable: non-empty, known sections once each, bounded. */
export function cleanPoints(points: ChatPoint[]): ChatPoint[] {
  return points
    .map((p) => ({
      point: p.point.trim(),
      kind: p.kind,
      sections: BusinessSectionKey.filter((k) => p.sections.includes(k)),
    }))
    .filter((p) => p.point)
    .slice(0, MAX_POINTS);
}

const cleanList = (items: string[], max: number) =>
  items
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);

/**
 * The admin's conversation about a business profile (docs/75). A REPLY job answers one message
 * and keeps the running list of what it understood; a DIGEST job closes the conversation into
 * the note text the admin reviews. Neither writes to the profile — applying the digest creates a
 * BusinessNote, which BUSINESS_REVISE applies (locks, history and suggestions as for any note).
 */
@Injectable()
export class BusinessChatRunner implements AiRunner {
  readonly type = 'BUSINESS_CHAT' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiExecutor,
    private readonly ctx: ContextLoader,
  ) {}

  async run(job: AiJob): Promise<RunnerResult> {
    const input = (job.input ?? {}) as ChatJobInput;
    const chat = await this.prisma.businessChat.findUnique({
      where: { id: input.chatId ?? '' },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!chat) throw new NonRetryableAiError('The conversation no longer exists');
    const b = await this.prisma.business.findUniqueOrThrow({
      where: { id: chat.businessId },
      include: { ...BUSINESS_PROMPT_INCLUDE, sections: true },
    });
    const profile = formatBusiness(b, { includeEmpty: true });
    const transcript = formatTranscript(chat.messages);
    if (!transcript) throw new NonRetryableAiError('The conversation is empty');

    if (input.mode === 'DIGEST') {
      const result = await this.ai.execute({
        task: this.type,
        promptKey: 'business_chat_digest',
        schema: BusinessChatDigestSchema,
        vars: {
          language: b.language,
          sections_spec: formatSectionSpec(),
          business: profile,
          transcript,
        },
      });
      const d = result.data;
      const noteText = d.noteText.trim().slice(0, BUSINESS_NOTE_MAX_CHARS);
      await this.prisma.businessChat.update({
        where: { id: chat.id },
        data: {
          digest: asJson({
            summary: d.summary.trim(),
            noteText,
            points: cleanPoints(d.points),
            openQuestions: cleanList(d.openQuestions, MAX_POINTS),
          }),
          digestStatus: 'DONE',
          digestError: null,
          digestUpTo: chat.messages.filter((m) => m.status !== 'PENDING').length,
        },
      });
      return {
        output: { chatId: chat.id, businessId: b.id, mode: 'DIGEST', chars: noteText.length },
        model: result.model,
        usage: result.usage,
        prompt: result.prompt,
      };
    }

    const message = await this.prisma.businessChatMessage.findUnique({
      where: { id: input.messageId ?? '' },
    });
    if (!message) throw new NonRetryableAiError('The reply slot no longer exists');
    const result = await this.ai.execute({
      task: this.type,
      promptKey: 'business_chat',
      schema: BusinessChatReplySchema,
      vars: {
        language: b.language,
        sections_spec: formatSectionSpec(),
        business: profile,
        standing_notes: formatStandingNotes(await this.ctx.standingNotes(b.id)) || '(none)',
        transcript,
      },
    });
    const d = result.data;
    const points = cleanPoints(d.understood);
    await this.prisma.businessChatMessage.update({
      where: { id: message.id },
      data: {
        text: d.reply.trim(),
        understood: asJson(points),
        questions: cleanList(d.questions, MAX_QUESTIONS),
        conflicts: cleanList(d.conflicts, MAX_CONFLICTS),
        status: 'DONE',
        error: null,
      },
    });
    return {
      output: { chatId: chat.id, businessId: b.id, mode: 'REPLY', points: points.length },
      model: result.model,
      usage: result.usage,
      prompt: result.prompt,
    };
  }

  async onFailure(job: AiJob, error: string) {
    const { chatId, messageId, mode } = (job.input ?? {}) as ChatJobInput;
    if (mode === 'DIGEST' && chatId) {
      await this.prisma.businessChat.updateMany({
        where: { id: chatId },
        data: { digestStatus: 'FAILED', digestError: error.slice(0, 2000) },
      });
    } else if (messageId) {
      await this.prisma.businessChatMessage.updateMany({
        where: { id: messageId },
        data: { status: 'FAILED', error: error.slice(0, 2000) },
      });
    }
  }

  async onRetry(job: AiJob) {
    const { chatId, messageId, mode } = (job.input ?? {}) as ChatJobInput;
    if (mode === 'DIGEST' && chatId) {
      await this.prisma.businessChat.updateMany({
        where: { id: chatId },
        data: { digestStatus: 'PENDING', digestError: null },
      });
    } else if (messageId) {
      await this.prisma.businessChatMessage.updateMany({
        where: { id: messageId },
        data: { status: 'PENDING', error: null },
      });
    }
  }
}
