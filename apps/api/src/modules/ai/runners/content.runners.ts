import { Injectable } from '@nestjs/common';
import type { AiJob, Prisma } from '@prisma/client';
import { ContentDraftResultSchema, type ContentDraftResult } from '@contenter/shared';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { AiExecutor } from '../ai-executor.service';
import { ContextLoader } from '../context-loader.service';
import {
  clamp,
  formatBrandDocs,
  formatBusiness,
  formatIdea,
  formatPrinciples,
  formatProfile,
  formatTopic,
} from '../context';
import { NonRetryableAiError } from '../provider/ai-provider';
import type { AiRunner, RunnerResult } from './runner';

function normalizeDraft(d: ContentDraftResult) {
  return {
    title: d.title.trim(),
    body: d.body,
    hashtags: d.hashtags.map((h) => h.trim()).filter(Boolean),
    cta: d.cta,
    notes: d.notes,
    selfCheck: {
      ...d.selfCheck,
      score: clamp(d.selfCheck.score, 0, 10),
    } as unknown as Prisma.InputJsonValue,
  };
}

@Injectable()
export class GenerateContentRunner implements AiRunner {
  readonly type = 'GENERATE_CONTENT' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiExecutor,
    private readonly ctx: ContextLoader,
  ) {}

  async run(job: AiJob): Promise<RunnerResult> {
    const content = await this.prisma.content.findUniqueOrThrow({
      where: { id: job.targetId },
      include: { topic: true, idea: true },
    });
    const [business, principles, profile, brandDocs] = await Promise.all([
      this.ctx.business(content.topicId),
      this.ctx.principles(content.topicId),
      this.ctx.activeProfile(content.topicId),
      this.ctx.brandDocs(content.topicId),
    ]);

    const result = await this.ai.execute({
      task: this.type,
      promptKey: 'generate_content',
      schema: ContentDraftResultSchema,
      vars: {
        language: content.topic.language,
        format: content.format,
        topic: formatTopic({ ...content.topic, business }),
        business: formatBusiness(business),
        profile: formatProfile(profile),
        principles: formatPrinciples(principles),
        brand_docs: formatBrandDocs(brandDocs),
        idea: formatIdea(content.idea),
        brief: content.brief || '(none)',
      },
    });

    const draft = normalizeDraft(result.data);
    const version = await this.prisma.$transaction(async (tx) => {
      const last = await tx.contentVersion.findFirst({
        where: { contentId: content.id },
        orderBy: { version: 'desc' },
      });
      const v = await tx.contentVersion.create({
        data: {
          contentId: content.id,
          version: (last?.version ?? 0) + 1,
          source: 'AI',
          jobId: job.id,
          ...draft,
        },
      });
      await tx.content.update({
        where: { id: content.id },
        data: {
          currentVersionId: v.id,
          title: draft.title,
          status: 'DRAFT',
          profileId: profile?.id ?? null,
        },
      });
      if (content.ideaId)
        await tx.idea.update({ where: { id: content.ideaId }, data: { status: 'USED' } });
      return v;
    });

    return {
      output: {
        contentId: content.id,
        versionId: version.id,
        version: version.version,
        score: result.data.selfCheck.score,
      },
      model: result.model,
      usage: result.usage,
      prompt: result.prompt,
    };
  }

  async onFailure(job: AiJob) {
    const content = await this.prisma.content.findUnique({ where: { id: job.targetId } });
    if (!content) return;
    await this.prisma.content.update({
      where: { id: content.id },
      data: { status: content.currentVersionId ? 'DRAFT' : 'FAILED' },
    });
  }

  async onRetry(job: AiJob) {
    await this.prisma.content.updateMany({
      where: { id: job.targetId },
      data: { status: 'GENERATING' },
    });
  }
}

@Injectable()
export class ReviseContentRunner implements AiRunner {
  readonly type = 'REVISE_CONTENT' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiExecutor,
    private readonly ctx: ContextLoader,
  ) {}

  async run(job: AiJob): Promise<RunnerResult> {
    const { feedback } = (job.input ?? {}) as { feedback?: string };
    const content = await this.prisma.content.findUniqueOrThrow({
      where: { id: job.targetId },
      include: { topic: true, currentVersion: true },
    });
    if (!content.currentVersion) throw new NonRetryableAiError('Content has no draft to revise');
    if (!feedback) throw new NonRetryableAiError('Feedback is required');

    const [business, principles, profile, brandDocs] = await Promise.all([
      this.ctx.business(content.topicId),
      this.ctx.principles(content.topicId),
      this.ctx.activeProfile(content.topicId),
      this.ctx.brandDocs(content.topicId),
    ]);
    const cur = content.currentVersion;

    const result = await this.ai.execute({
      task: this.type,
      promptKey: 'revise_content',
      schema: ContentDraftResultSchema,
      vars: {
        language: content.topic.language,
        topic: formatTopic({ ...content.topic, business }),
        business: formatBusiness(business),
        profile: formatProfile(profile),
        principles: formatPrinciples(principles),
        brand_docs: formatBrandDocs(brandDocs),
        current_draft: [
          `Title: ${cur.title}`,
          `Body:\n${cur.body}`,
          `Hashtags: ${cur.hashtags.join(' ')}`,
          `CTA: ${cur.cta}`,
          `Notes: ${cur.notes}`,
        ].join('\n\n'),
        feedback,
      },
    });

    const draft = normalizeDraft(result.data);
    const version = await this.prisma.$transaction(async (tx) => {
      const last = await tx.contentVersion.findFirst({
        where: { contentId: content.id },
        orderBy: { version: 'desc' },
      });
      const v = await tx.contentVersion.create({
        data: {
          contentId: content.id,
          version: (last?.version ?? 0) + 1,
          source: 'AI',
          jobId: job.id,
          feedback,
          ...draft,
        },
      });
      await tx.content.update({
        where: { id: content.id },
        data: { currentVersionId: v.id, title: draft.title, status: 'DRAFT' },
      });
      return v;
    });

    return {
      output: {
        contentId: content.id,
        versionId: version.id,
        version: version.version,
        score: result.data.selfCheck.score,
      },
      model: result.model,
      usage: result.usage,
      prompt: result.prompt,
    };
  }

  async onFailure(job: AiJob) {
    await this.prisma.content.updateMany({
      where: { id: job.targetId, status: 'GENERATING' },
      data: { status: 'DRAFT' },
    });
  }

  async onRetry(job: AiJob) {
    await this.prisma.content.updateMany({
      where: { id: job.targetId },
      data: { status: 'GENERATING' },
    });
  }
}

/**
 * Writes the same content again for another platform/format. The new `Content` shell (with
 * `sourceContentId`, `platform` and `format`) was created in the request path; this fills it with
 * the first version, written from the source's current draft.
 */
@Injectable()
export class RepurposeContentRunner implements AiRunner {
  readonly type = 'REPURPOSE_CONTENT' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiExecutor,
    private readonly ctx: ContextLoader,
  ) {}

  async run(job: AiJob): Promise<RunnerResult> {
    const content = await this.prisma.content.findUniqueOrThrow({
      where: { id: job.targetId },
      include: {
        topic: true,
        source: { include: { currentVersion: true, topic: { select: { platform: true } } } },
      },
    });
    const source = content.source;
    if (!source?.currentVersion) {
      throw new NonRetryableAiError('The source content has no draft to adapt');
    }
    const targetPlatform = content.platform ?? content.topic.platform;
    const { notes } = (job.input ?? {}) as { notes?: string };

    const [business, principles, profile, brandDocs] = await Promise.all([
      this.ctx.business(content.topicId),
      this.ctx.principles(content.topicId),
      this.ctx.activeProfile(content.topicId),
      this.ctx.brandDocs(content.topicId),
    ]);
    const cur = source.currentVersion;

    const result = await this.ai.execute({
      task: this.type,
      promptKey: 'repurpose_content',
      schema: ContentDraftResultSchema,
      vars: {
        language: content.topic.language,
        target_platform: targetPlatform,
        target_format: content.format,
        // the topic block names the platform the new piece is for, not the topic's usual one
        topic: formatTopic({ ...content.topic, platform: targetPlatform, business }),
        business: formatBusiness(business),
        profile: formatProfile(profile),
        principles: formatPrinciples(principles),
        brand_docs: formatBrandDocs(brandDocs),
        source: [
          `Platform: ${source.platform ?? source.topic.platform}`,
          `Format: ${source.format}`,
          `Title: ${cur.title}`,
          `Body:\n${cur.body}`,
          `Hashtags: ${cur.hashtags.join(' ')}`,
          `CTA: ${cur.cta}`,
        ].join('\n\n'),
        direction: notes?.trim() || '(none)',
      },
    });

    const draft = normalizeDraft(result.data);
    const version = await this.prisma.$transaction(async (tx) => {
      const v = await tx.contentVersion.create({
        data: {
          contentId: content.id,
          version: 1,
          source: 'AI',
          jobId: job.id,
          feedback: notes?.trim() || null,
          ...draft,
        },
      });
      await tx.content.update({
        where: { id: content.id },
        data: {
          currentVersionId: v.id,
          title: draft.title,
          status: 'DRAFT',
          profileId: profile?.id ?? null,
        },
      });
      return v;
    });

    return {
      output: {
        contentId: content.id,
        sourceContentId: source.id,
        versionId: version.id,
        platform: targetPlatform,
        format: content.format,
        score: result.data.selfCheck.score,
      },
      model: result.model,
      usage: result.usage,
      prompt: result.prompt,
    };
  }

  async onFailure(job: AiJob) {
    const content = await this.prisma.content.findUnique({ where: { id: job.targetId } });
    if (!content) return;
    await this.prisma.content.update({
      where: { id: content.id },
      data: { status: content.currentVersionId ? 'DRAFT' : 'FAILED' },
    });
  }

  async onRetry(job: AiJob) {
    await this.prisma.content.updateMany({
      where: { id: job.targetId },
      data: { status: 'GENERATING' },
    });
  }
}
