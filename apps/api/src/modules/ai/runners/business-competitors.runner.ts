import { Injectable } from '@nestjs/common';
import { Prisma, type AiJob } from '@prisma/client';
import {
  BUSINESS_COMPETITOR_LIMIT,
  CompetitorsProposeSchema,
  resolveCompetitorProposals,
} from '@contenter/shared';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { BUSINESS_PROMPT_INCLUDE } from '../../businesses/business-api';
import { AiExecutor } from '../ai-executor.service';
import { formatBusiness } from '../context';
import { NonRetryableAiError } from '../provider/ai-provider';
import type { AiRunner, RunnerResult } from './runner';
import { sourceBlocks } from './source-material';

/**
 * Proposes competitor cards from what the admin already stored (docs/70 §11): the COMPETITORS
 * section, the key facts and the readable references. It reads no competitor source snapshot and
 * does no web search, and the model never describes a rival from its own knowledge — the prompt
 * forbids it and `resolveCompetitorProposals` (code) keeps a card only when its quote occurs in
 * the text the model was given and names the competitor. Cards are saved inactive and unverified,
 * so they reach no profile text until the admin confirms them.
 */
@Injectable()
export class BusinessCompetitorsProposeRunner implements AiRunner {
  readonly type = 'BUSINESS_COMPETITORS_PROPOSE' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiExecutor,
  ) {}

  async run(job: AiJob): Promise<RunnerResult> {
    const b = await this.prisma.business.findUnique({
      where: { id: job.targetId },
      include: BUSINESS_PROMPT_INCLUDE,
    });
    if (!b) throw new NonRetryableAiError('The business no longer exists');

    const [existing, facts, refs] = await Promise.all([
      this.prisma.businessCompetitor.findMany({
        where: { businessId: b.id },
        select: { name: true },
      }),
      this.prisma.businessFact.findMany({
        where: { businessId: b.id, isActive: true },
        orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
        select: { label: true, value: true },
      }),
      this.prisma.businessReference.findMany({
        where: { businessId: b.id, status: 'READY', isActive: true, content: { not: '' }, audience: { not: 'APPS' } },
        orderBy: { createdAt: 'asc' },
        select: { title: true, url: true, content: true },
      }),
    ]);
    const room = BUSINESS_COMPETITOR_LIMIT - existing.length;
    if (room <= 0) throw new NonRetryableAiError('The competitor list is full');

    const text = (key: string) => b.sections.find((s) => s.key === key)?.content ?? '';
    const { blocks, texts } = sourceBlocks({
      sections: [{ title: 'Competitors section of the profile', text: text('COMPETITORS') }],
      facts,
      references: refs,
    });
    if (!texts.length) throw new NonRetryableAiError('There is nothing to read yet');

    const result = await this.ai.execute({
      task: this.type,
      promptKey: 'business_competitors_propose',
      schema: CompetitorsProposeSchema,
      vars: {
        language: b.language,
        business: formatBusiness(b, { budget: 8_000 }),
        existing: existing.length ? existing.map((c) => c.name).join('\n') : '(none)',
        sources: blocks.join('\n\n'),
      },
    });

    const resolved = resolveCompetitorProposals({
      proposals: result.data.competitors,
      sources: texts,
      existing: existing.map((c) => c.name),
      ownName: b.name,
      room,
    });

    let saved = 0;
    for (const [index, row] of resolved.rows.entries()) {
      try {
        await this.prisma.businessCompetitor.create({
          data: {
            businessId: b.id,
            ...row,
            // AI-proposed: unused until the admin confirms it
            source: 'AI',
            verified: false,
            isActive: false,
            sortOrder: existing.length + index,
            jobId: job.id,
          },
        });
        saved++;
      } catch (err) {
        // the same name appeared meanwhile; the admin's card wins
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      }
    }
    return {
      output: {
        businessId: b.id,
        proposed: result.data.competitors.length,
        saved,
        dropped: resolved.dropped.length,
      },
      model: result.model,
      usage: result.usage,
      prompt: result.prompt,
    };
  }
}
