import { Injectable } from '@nestjs/common';
import type { AiJob } from '@prisma/client';
import { SmartReplySchema, type WalkerStepKey } from '@contenter/shared';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { SmartContextBuilder } from '../../smart/smart-context.service';
import { AiExecutor } from '../ai-executor.service';
import { NonRetryableAiError } from '../provider/ai-provider';
import type { AiRunner, RunnerResult } from './runner';

const MAX_TRANSCRIPT_MESSAGES = 30;

/**
 * Answers the admin inside the Smart assistant (Walker chat or error chat).
 * Reads a code-built context snapshot (DB state, logs, errors); it cannot act on the app.
 */
@Injectable()
export class SmartChatRunner implements AiRunner {
  readonly type = 'SMART_CHAT' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiExecutor,
    private readonly context: SmartContextBuilder,
  ) {}

  async run(job: AiJob): Promise<RunnerResult> {
    const target = await this.prisma.smartMessage.findUniqueOrThrow({
      where: { id: job.targetId },
      include: { conversation: true },
    });
    const conv = target.conversation;
    const history = await this.prisma.smartMessage.findMany({
      where: { conversationId: conv.id, createdAt: { lt: target.createdAt }, status: 'DONE' },
      orderBy: { createdAt: 'desc' },
      take: MAX_TRANSCRIPT_MESSAGES,
    });
    history.reverse();
    if (!history.some((m) => m.role === 'USER')) throw new NonRetryableAiError('Nothing to answer');

    const ctx = (target.context ?? {}) as {
      route?: string;
      topicId?: string;
      walkerStep?: WalkerStepKey;
    };
    const snapshot = await this.context.build({
      userId: conv.userId,
      route: ctx.route ?? conv.route,
      topicId: ctx.topicId ?? conv.topicId,
      walkerStep: ctx.walkerStep ?? null,
      errorId: conv.errorId,
    });
    const transcript = history
      .map(
        (m) =>
          `<message role="${m.role === 'USER' ? 'admin' : 'assistant'}">\n${m.content}\n</message>`,
      )
      .join('\n');

    const result = await this.ai.execute({
      task: this.type,
      promptKey: 'smart_chat',
      schema: SmartReplySchema,
      vars: {
        mode: conv.kind === 'ERROR' ? 'error_analysis' : 'walker',
        context: snapshot,
        transcript,
      },
    });

    await this.prisma.$transaction([
      this.prisma.smartMessage.update({
        where: { id: target.id },
        data: { content: result.data.reply.trim(), status: 'DONE' },
      }),
      this.prisma.smartConversation.update({
        where: { id: conv.id },
        data: { updatedAt: new Date() },
      }),
    ]);

    return {
      output: { conversationId: conv.id, messageId: target.id, chars: result.data.reply.length },
      model: result.model,
      usage: result.usage,
      prompt: result.prompt,
    };
  }

  async onFailure(job: AiJob, error: string) {
    await this.prisma.smartMessage.updateMany({
      where: { id: job.targetId },
      data: { status: 'FAILED', content: error.slice(0, 2000) },
    });
  }

  async onRetry(job: AiJob) {
    await this.prisma.smartMessage.updateMany({
      where: { id: job.targetId },
      data: { status: 'PENDING', content: '' },
    });
  }
}
