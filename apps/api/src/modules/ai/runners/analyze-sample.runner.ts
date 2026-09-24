import { Injectable } from '@nestjs/common';
import type { AiJob, Prisma } from '@prisma/client';
import { SampleAnalysisResultSchema, type FetchedMedia } from '@contenter/shared';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { MediaFetcherService } from '../../samples/media-fetcher.service';
import { AiExecutor } from '../ai-executor.service';
import { formatSample, formatTopic } from '../context';
import { NonRetryableAiError } from '../provider/ai-provider';
import type { AiRunner, RunnerResult } from './runner';

const MAX_IMAGES = 4;

@Injectable()
export class AnalyzeSampleRunner implements AiRunner {
  readonly type = 'ANALYZE_SAMPLE' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiExecutor,
    private readonly fetcher: MediaFetcherService,
  ) {}

  async run(job: AiJob): Promise<RunnerResult> {
    let sample = await this.prisma.sampleContent.findUniqueOrThrow({
      where: { id: job.targetId },
      include: { topic: true },
    });

    // Code step: make sure the link has been fetched before the AI step.
    if (sample.fetchStatus === 'PENDING') {
      await this.fetcher.fetchAndStore(sample.id);
      sample = await this.prisma.sampleContent.findUniqueOrThrow({
        where: { id: sample.id },
        include: { topic: true },
      });
    }

    const fetched = sample.fetched as FetchedMedia | null;
    if (!sample.manualText && !fetched?.text && !fetched?.description && !fetched?.images?.length) {
      throw new NonRetryableAiError(
        'Nothing to analyze: the link returned no readable content. Add the text/caption manually.',
      );
    }

    const result = await this.ai.execute({
      task: this.type,
      promptKey: 'analyze_sample',
      schema: SampleAnalysisResultSchema,
      imageUrls: (fetched?.images ?? []).slice(0, MAX_IMAGES),
      vars: {
        language: 'fa',
        topic: formatTopic(sample.topic),
        sample: formatSample(sample),
      },
    });

    const data = result.data as unknown as Prisma.InputJsonValue;
    await this.prisma.$transaction([
      this.prisma.sampleAnalysis.upsert({
        where: { sampleId: sample.id },
        create: { sampleId: sample.id, summary: result.data.summary, result: data, jobId: job.id },
        update: { summary: result.data.summary, result: data, jobId: job.id },
      }),
      this.prisma.sampleContent.update({
        where: { id: sample.id },
        data: { analysisStatus: 'DONE' },
      }),
    ]);

    return {
      output: {
        sampleId: sample.id,
        traits: result.data.traits.length,
        summary: result.data.summary,
      },
      model: result.model,
      usage: result.usage,
      prompt: result.prompt,
    };
  }

  async onFailure(job: AiJob) {
    await this.prisma.sampleContent.updateMany({
      where: { id: job.targetId },
      data: { analysisStatus: 'FAILED' },
    });
  }

  async onRetry(job: AiJob) {
    await this.prisma.sampleContent.updateMany({
      where: { id: job.targetId },
      data: { analysisStatus: 'QUEUED' },
    });
  }
}
