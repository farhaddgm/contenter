import { Injectable } from '@nestjs/common';
import type { AiJob, Prisma } from '@prisma/client';
import { StyleBuildSchema, STYLE_SOURCES_PROMPT_CHARS } from '@contenter/shared';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { BUSINESS_PROMPT_INCLUDE } from '../../businesses/business-api';
import { AiExecutor } from '../ai-executor.service';
import { formatBusiness } from '../context';
import { NonRetryableAiError } from '../provider/ai-provider';
import type { AiRunner, RunnerResult } from './runner';

const asJson = (v: unknown) => v as Prisma.InputJsonValue;

/**
 * Reads the sources of an imitation style (pages of OTHER brands, already read by code into text
 * snapshots) and writes the style guide adapted to the business (docs/64-business-styles.md). The
 * result stays unreviewed until the admin confirms or edits it.
 */
@Injectable()
export class BusinessStyleBuildRunner implements AiRunner {
  readonly type = 'BUSINESS_STYLE_BUILD' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiExecutor,
  ) {}

  async run(job: AiJob): Promise<RunnerResult> {
    const style = await this.prisma.businessStyle.findUnique({
      where: { id: job.targetId },
      include: {
        business: { include: BUSINESS_PROMPT_INCLUDE },
        sources: {
          where: { status: 'READY', content: { not: '' } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!style) throw new NonRetryableAiError('The style no longer exists');
    if (!style.sources.length) {
      throw new NonRetryableAiError('Add at least one source that was read successfully');
    }

    const share = Math.max(1_500, Math.floor(STYLE_SOURCES_PROMPT_CHARS / style.sources.length));
    const sources = style.sources
      .map((s, i) => {
        const text = s.content.trim();
        const head = `[S${i + 1}] ${s.kind} — ${s.title || s.url || 'Untitled'}${s.url ? ` — ${s.url}` : ''}`;
        return `${head}\n${text.length > share ? `${text.slice(0, share)}\n[truncated]` : text}`;
      })
      .join('\n\n');

    const result = await this.ai.execute({
      task: this.type,
      promptKey: 'business_style_build',
      schema: StyleBuildSchema,
      vars: {
        language: style.business.language,
        business: formatBusiness(style.business, { budget: 12_000 }),
        style_name: style.name,
        direction: style.direction || '(none)',
        sources,
      },
    });

    await this.prisma.businessStyle.update({
      where: { id: style.id },
      data: {
        summary: result.data.summary,
        traits: asJson(result.data.traits),
        guide: result.data.guide,
        caveats: result.data.caveats,
        buildState: 'READY',
        buildError: null,
        builtAt: new Date(),
        // AI-written: the admin has to confirm it before a project can use it
        reviewedAt: null,
      },
    });
    return {
      output: { styleId: style.id, businessId: style.businessId, sources: style.sources.length },
      model: result.model,
      usage: result.usage,
      prompt: result.prompt,
    };
  }

  async onFailure(job: AiJob, error: string) {
    await this.prisma.businessStyle.updateMany({
      where: { id: job.targetId },
      data: { buildState: 'FAILED', buildError: error.slice(0, 2000) },
    });
  }

  async onRetry(job: AiJob) {
    await this.prisma.businessStyle.updateMany({
      where: { id: job.targetId },
      data: { buildState: 'BUILDING', buildError: null },
    });
  }
}
