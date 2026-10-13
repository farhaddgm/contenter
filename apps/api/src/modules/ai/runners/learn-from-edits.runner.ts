import { Injectable } from '@nestjs/common';
import type { AiJob, Prisma } from '@prisma/client';
import { EditLearningResultSchema, MIN_EDIT_PAIRS } from '@contenter/shared';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import {
  averageChange,
  collectEditPairs,
  formatPairs,
  resolveSuggestions,
} from '../../edit-learning/edit-pairs';
import { AiExecutor } from '../ai-executor.service';
import { ContextLoader } from '../context-loader.service';
import { formatBusiness, formatPrinciples, formatTopic } from '../context';
import { NonRetryableAiError } from '../provider/ai-provider';
import type { AiRunner, RunnerResult } from './runner';

/** How many earlier suggestions (pending or dismissed) are shown to the model, so it does not repeat them. */
const KNOWN_SHOWN = 30;

/**
 * Finds the patterns in the edits editors made to a topic's AI drafts (docs/30-learn-from-edits.md).
 * Code finds the pairs and computes every diff; the model only names patterns and points at pair
 * ids; code checks each suggestion against the real pairs before storing it. Nothing becomes a
 * principle here: the admin accepts or dismisses each suggestion.
 */
@Injectable()
export class LearnFromEditsRunner implements AiRunner {
  readonly type = 'LEARN_FROM_EDITS' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiExecutor,
    private readonly ctx: ContextLoader,
  ) {}

  async run(job: AiJob): Promise<RunnerResult> {
    const topicId = job.targetId;
    const topic = await this.prisma.topic.findUniqueOrThrow({ where: { id: topicId } });
    const pairs = await collectEditPairs(this.prisma, topicId);
    if (pairs.length < MIN_EDIT_PAIRS) {
      // retrying cannot create edits that are not there
      throw new NonRetryableAiError(
        `Only ${pairs.length} approved contents were really edited by an editor; ${MIN_EDIT_PAIRS} are needed`,
      );
    }

    const [business, principles, known] = await Promise.all([
      this.ctx.business(topicId),
      this.ctx.principles(topicId),
      this.prisma.learningSuggestion.findMany({
        where: { topicId, status: { in: ['PENDING', 'DISMISSED'] } },
        orderBy: { createdAt: 'desc' },
        take: KNOWN_SHOWN,
        select: { text: true, status: true },
      }),
    ]);
    const average = averageChange(pairs);

    const result = await this.ai.execute({
      task: this.type,
      promptKey: 'learn_from_edits',
      schema: EditLearningResultSchema,
      vars: {
        language: topic.language,
        pair_count: pairs.length,
        average_change: `${Math.round(average * 100)}%`,
        topic: formatTopic({ ...topic, business }),
        business: formatBusiness(business),
        principles: formatPrinciples(principles),
        known_suggestions: known.length
          ? known.map((k) => `- [${k.status}] ${k.text}`).join('\n')
          : '(none)',
        pairs: formatPairs(pairs),
      },
    });

    const kept = resolveSuggestions(result.data, pairs, [
      ...principles.map((p) => p.text),
      ...known.map((k) => k.text),
    ]);
    const run = await this.prisma.$transaction(async (tx) => {
      const created = await tx.editLearningRun.create({
        data: { topicId, jobId: job.id, pairCount: pairs.length, avgChangeRatio: average },
      });
      if (kept.length) {
        await tx.learningSuggestion.createMany({
          data: kept.map((k) => ({
            topicId,
            runId: created.id,
            kind: k.kind,
            category: k.category,
            text: k.text,
            rationale: k.rationale,
            evidence: k.evidence as unknown as Prisma.InputJsonValue,
          })),
        });
      }
      return created;
    });

    return {
      output: {
        runId: run.id,
        pairs: pairs.length,
        suggestions: kept.length,
        // proposed by the model but without enough real evidence, or a repeat
        dropped: result.data.suggestions.length - kept.length,
      },
      model: result.model,
      usage: result.usage,
      prompt: result.prompt,
    };
  }
}
