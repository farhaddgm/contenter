import { Injectable } from '@nestjs/common';
import type { AiJob } from '@prisma/client';
import { IdeationResultSchema } from '@contenter/shared';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { AiExecutor } from '../ai-executor.service';
import { ContextLoader } from '../context-loader.service';
import {
  clamp,
  formatBrandDocs,
  formatBusiness,
  formatPrinciples,
  formatProfile,
  formatTopic,
} from '../context';
import type { AiRunner, RunnerResult } from './runner';

const EXISTING_IDEAS_LIMIT = 150;

@Injectable()
export class IdeateRunner implements AiRunner {
  readonly type = 'IDEATE' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiExecutor,
    private readonly ctx: ContextLoader,
  ) {}

  async run(job: AiJob): Promise<RunnerResult> {
    const request = await this.prisma.ideationRequest.findUniqueOrThrow({
      where: { id: job.targetId },
      include: { topic: true },
    });
    const [business, principles, profile, brandDocs, existing] = await Promise.all([
      this.ctx.business(request.topicId),
      this.ctx.principles(request.topicId),
      this.ctx.activeProfile(request.topicId),
      this.ctx.brandDocs(request.topicId),
      this.prisma.idea.findMany({
        where: { topicId: request.topicId, status: { not: 'REJECTED' } },
        select: { title: true },
        orderBy: { createdAt: 'desc' },
        take: EXISTING_IDEAS_LIMIT,
      }),
    ]);

    const result = await this.ai.execute({
      task: this.type,
      promptKey: 'ideate',
      schema: IdeationResultSchema,
      vars: {
        language: request.topic.language,
        count: request.count,
        format: request.format ?? 'any (choose the best)',
        direction: request.direction || '(no specific direction)',
        topic: formatTopic({ ...request.topic, business }),
        business: formatBusiness(business),
        profile: formatProfile(profile),
        principles: formatPrinciples(principles),
        brand_docs: formatBrandDocs(brandDocs),
        existing_ideas: existing.length ? existing.map((i) => `- ${i.title}`).join('\n') : '(none)',
      },
    });

    // Code enforces the requested count/format regardless of what the model returned.
    const ideas = result.data.ideas.slice(0, request.count);
    await this.prisma.idea.createMany({
      data: ideas.map((i) => ({
        topicId: request.topicId,
        requestId: request.id,
        title: i.title,
        angle: i.angle,
        hook: i.hook,
        format: request.format ?? i.format,
        outline: i.outline,
        rationale: i.rationale,
        score: clamp(i.score, 0, 10),
      })),
    });

    return {
      output: { requestId: request.id, ideas: ideas.length, usedProfileId: profile?.id ?? null },
      model: result.model,
      usage: result.usage,
      prompt: result.prompt,
    };
  }
}
