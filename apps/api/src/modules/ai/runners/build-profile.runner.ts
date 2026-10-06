import { Injectable } from '@nestjs/common';
import type { AiJob } from '@prisma/client';
import { ProfileBuildResultSchema, type SampleAnalysisResult } from '@contenter/shared';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { AiExecutor } from '../ai-executor.service';
import { ContextLoader } from '../context-loader.service';
import {
  clamp,
  formatAnalyses,
  formatBrandDocs,
  formatBusiness,
  formatPrinciples,
  formatProfile,
  formatTopic,
} from '../context';
import { NonRetryableAiError } from '../provider/ai-provider';
import type { AiRunner, RunnerResult } from './runner';

@Injectable()
export class BuildProfileRunner implements AiRunner {
  readonly type = 'BUILD_PROFILE' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiExecutor,
    private readonly ctx: ContextLoader,
  ) {}

  async run(job: AiJob): Promise<RunnerResult> {
    const topicId = job.targetId;
    const { sampleIds } = (job.input ?? {}) as { sampleIds?: string[] };
    const topic = await this.prisma.topic.findUniqueOrThrow({ where: { id: topicId } });

    const samples = await this.prisma.sampleContent.findMany({
      where: {
        topicId,
        analysisStatus: 'DONE',
        ...(sampleIds?.length ? { id: { in: sampleIds } } : {}),
      },
      include: { analysis: true },
      orderBy: { createdAt: 'asc' },
    });
    const analyzed = samples.filter((s) => s.analysis);
    const [business, principles, previous, brandDocs] = await Promise.all([
      this.ctx.business(topicId),
      this.ctx.principles(topicId),
      this.ctx.activeProfile(topicId),
      this.ctx.brandDocs(topicId),
    ]);
    const businessHasContent =
      !!business?.sections.some((s) => s.content.trim()) || !!business?.documents?.length;
    if (!analyzed.length && !brandDocs.length && !businessHasContent) {
      throw new NonRetryableAiError(
        'Nothing to build from. Analyze at least one sample, add an active brand document, or link a business with a filled profile or reference documents first.',
      );
    }

    const result = await this.ai.execute({
      task: this.type,
      promptKey: 'build_profile',
      schema: ProfileBuildResultSchema,
      vars: {
        language: 'fa',
        topic: formatTopic({ ...topic, business }),
        business: formatBusiness(business),
        principles: formatPrinciples(principles),
        brand_docs: formatBrandDocs(brandDocs),
        previous_profile: previous ? formatProfile(previous) : '(none)',
        analyses: analyzed.length
          ? formatAnalyses(
              analyzed.map((s) => ({
                url: s.url,
                result: s.analysis!.result as unknown as SampleAnalysisResult,
              })),
            )
          : '(none — build the profile from the brand guidelines, the business profile and the business documents)',
      },
    });

    const profile = await this.prisma.$transaction(async (tx) => {
      const last = await tx.contentProfile.findFirst({
        where: { topicId },
        orderBy: { version: 'desc' },
      });
      return tx.contentProfile.create({
        data: {
          topicId,
          version: (last?.version ?? 0) + 1,
          status: 'DRAFT',
          summary: result.data.summary,
          styleGuide: result.data.styleGuide,
          sampleIds: analyzed.map((s) => s.id),
          brandDocIds: brandDocs.map((d) => d.id),
          jobId: job.id,
          traits: {
            create: result.data.traits.map((t) => ({
              category: t.category,
              name: t.name,
              description: t.description,
              evidence: t.evidence,
              confidence: clamp(t.confidence, 0, 1),
              status: 'PROPOSED' as const,
              source: 'AI' as const,
            })),
          },
        },
      });
    });

    return {
      output: {
        profileId: profile.id,
        version: profile.version,
        traits: result.data.traits.length,
      },
      model: result.model,
      usage: result.usage,
      prompt: result.prompt,
    };
  }
}
