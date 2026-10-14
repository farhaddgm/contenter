import { Injectable } from '@nestjs/common';
import type { AiJob } from '@prisma/client';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { NonRetryableAiError } from '../provider/ai-provider';
import { AiProviderRegistry } from '../provider/provider-registry';
import { chunkText, hashText } from '../semantic/chunking';
import type { AiRunner, RunnerResult } from './runner';

const EMPTY_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/**
 * Cuts a business reference into chunks (code) and stores an embedding of each (docs/44). The
 * model only turns text into numbers; which chunks a task gets is decided by code in
 * `SemanticRetriever`. Running it again on an unchanged reference does nothing and costs nothing.
 */
@Injectable()
export class EmbedReferenceRunner implements AiRunner {
  readonly type = 'EMBED_REFERENCE' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: AiProviderRegistry,
  ) {}

  async run(job: AiJob): Promise<RunnerResult> {
    const ref = await this.prisma.businessReference.findUniqueOrThrow({
      where: { id: job.targetId },
      select: { id: true, businessId: true, content: true },
    });
    const embedder = this.registry.embedder();
    if (!embedder) throw new NonRetryableAiError('No embeddings vendor is configured');
    const model = this.registry.isMock ? `mock/${embedder.model}` : embedder.model;
    const prompt = { key: 'embed_reference', version: 0 };

    const text = ref.content.trim();
    const chunks = chunkText(text);
    const contentHash = hashText(ref.content);
    if (!chunks.length) {
      await this.prisma.referenceChunk.deleteMany({ where: { referenceId: ref.id } });
      return { output: { chunks: 0, skipped: 'empty' }, model, usage: EMPTY_USAGE, prompt };
    }

    const current = await this.prisma.referenceChunk.count({
      where: { referenceId: ref.id, model: embedder.ref, contentHash },
    });
    if (current === chunks.length) {
      return { output: { chunks: current, skipped: 'unchanged' }, model, usage: EMPTY_USAGE, prompt };
    }

    const { vectors, usage } = await embedder.provider.embed(chunks, embedder.model);
    if (vectors.length !== chunks.length) {
      throw new NonRetryableAiError('The embeddings vendor returned the wrong number of vectors');
    }
    await this.prisma.$transaction([
      this.prisma.referenceChunk.deleteMany({ where: { referenceId: ref.id } }),
      this.prisma.referenceChunk.createMany({
        data: chunks.map((t, idx) => ({
          referenceId: ref.id,
          businessId: ref.businessId,
          idx,
          text: t,
          embedding: vectors[idx],
          model: embedder.ref,
          contentHash,
        })),
      }),
    ]);
    return { output: { chunks: chunks.length }, model, usage, prompt };
  }
}
