import { Injectable } from '@nestjs/common';
import { Prisma, type AiJob } from '@prisma/client';
import {
  BUSINESS_OFFERING_LIMIT,
  OFFERING_VARIANTS_EXTRACT_MAX,
  OfferingsExtractSchema,
  offeringParentProblem,
  resolveOfferingProposals,
} from '@contenter/shared';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { BUSINESS_PROMPT_INCLUDE } from '../../businesses/business-api';
import { AiExecutor } from '../ai-executor.service';
import { formatBusiness } from '../context';
import { NonRetryableAiError } from '../provider/ai-provider';
import type { AiRunner, RunnerResult } from './runner';
import { sourceBlocks } from './source-material';

/**
 * Proposes catalog rows for a business from its stored material (docs/67-business-catalog.md): the
 * products & services section, the key facts and the readable references. The model only names
 * what it finds; `resolveOfferingProposals` (code) keeps a row only when its quote really occurs in
 * the text the model was given, and keeps a price only when that quote states it. Rows are saved
 * inactive and unverified: they reach no prompt, check or export until the admin confirms them.
 * With `input.parentId` it proposes only the variants of that offering (docs/73), saved under it.
 */
@Injectable()
export class BusinessOfferingsExtractRunner implements AiRunner {
  readonly type = 'BUSINESS_OFFERINGS_EXTRACT' as const;

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

    // the line whose variants are asked for: it must still be an offering of this business with room under it
    const { parentId } = (job.input ?? {}) as { parentId?: string };
    const [existing, facts, refs] = await Promise.all([
      this.prisma.businessOffering.findMany({
        where: { businessId: b.id },
        select: { id: true, parentId: true, name: true, aliases: true, summary: true, features: true },
      }),
      this.prisma.businessFact.findMany({
        where: { businessId: b.id, isActive: true },
        orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
        select: { label: true, value: true },
      }),
      this.prisma.businessReference.findMany({
        where: { businessId: b.id, status: 'READY', isActive: true, content: { not: '' } },
        orderBy: { createdAt: 'asc' },
        select: { title: true, url: true, content: true },
      }),
    ]);
    const parent = parentId ? existing.find((o) => o.id === parentId) : undefined;
    if (parentId) {
      if (!parent) throw new NonRetryableAiError('The offering to add variants to no longer exists');
      const problem = offeringParentProblem({ parentId, rows: existing });
      if (problem) throw new NonRetryableAiError(problem);
    }
    const room = Math.min(
      BUSINESS_OFFERING_LIMIT - existing.length,
      parentId ? OFFERING_VARIANTS_EXTRACT_MAX : Infinity,
    );
    if (room <= 0) throw new NonRetryableAiError('The catalog is full');

    // each source is cut before it is sent, and the evidence is checked against the cut text
    const { blocks, texts: sourceTexts } = sourceBlocks({
      sections: [
        {
          title: 'Products & services section of the profile',
          text: b.sections.find((s) => s.key === 'SERVICES')?.content ?? '',
        },
      ],
      facts,
      references: refs,
    });
    if (!sourceTexts.length) throw new NonRetryableAiError('There is nothing to read yet');

    const result = await this.ai.execute({
      task: this.type,
      promptKey: 'business_offerings_extract',
      schema: OfferingsExtractSchema,
      vars: {
        language: b.language,
        business: formatBusiness(b, { budget: 8_000 }),
        existing: existing.length
          ? existing.map((o) => [o.name, ...o.aliases].join(' | ')).join('\n')
          : '(none)',
        sources: blocks.join('\n\n'),
        scope: parent
          ? `Only the VARIANTS of "${parent.name}" (its types, plans, tiers or versions that the sources name)${
              parent.summary ? `. About it: ${parent.summary}` : ''
            }. Never list "${parent.name}" itself or any other offering.`
          : '(all offerings of the business)',
      },
    });

    const resolved = resolveOfferingProposals({
      proposals: result.data.offerings,
      sources: sourceTexts,
      existing: existing.flatMap((o) => [o.name, ...o.aliases]),
      room,
    });

    let saved = 0;
    for (const [index, row] of resolved.rows.entries()) {
      try {
        await this.prisma.businessOffering.create({
          data: {
            businessId: b.id,
            name: row.name,
            aliases: row.aliases,
            kind: row.kind,
            summary: row.summary,
            features: row.features,
            priceAmount: row.priceAmount,
            priceCurrency: row.priceCurrency,
            priceFrom: row.priceFrom,
            priceUnit: row.priceUnit,
            evidence: row.evidence,
            parentId: parent?.id ?? null,
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
        // the same exact name appeared meanwhile; the admin's row wins
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      }
    }
    return {
      output: {
        businessId: b.id,
        proposed: result.data.offerings.length,
        saved,
        dropped: resolved.dropped.length,
        priceDropped: resolved.priceDropped.length,
      },
      model: result.model,
      usage: result.usage,
      prompt: result.prompt,
    };
  }
}
