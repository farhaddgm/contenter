import { Injectable } from '@nestjs/common';
import { Prisma, type AiJob } from '@prisma/client';
import {
  BUSINESS_SEGMENT_LIMIT,
  OFFERING_SEGMENTS_MAX,
  SegmentsProposeSchema,
  resolveSegmentProposals,
} from '@contenter/shared';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { BUSINESS_PROMPT_INCLUDE } from '../../businesses/business-api';
import { AiExecutor } from '../ai-executor.service';
import { formatBusiness } from '../context';
import { NonRetryableAiError } from '../provider/ai-provider';
import type { AiRunner, RunnerResult } from './runner';
import { sourceBlocks } from './source-material';

/**
 * Proposes audiences (markets and personas) for a business from its stored material (docs/73): the
 * target-market and persona sections, the key facts and the readable references. The model only
 * names what it finds and which catalog offerings each is for; `resolveSegmentProposals` (code)
 * keeps a row only when its quote really occurs in the text the model was given, and links only
 * offerings that exist. Rows are saved inactive and unverified: they reach no prompt, coverage
 * report or export until the admin confirms them.
 */
@Injectable()
export class BusinessSegmentsProposeRunner implements AiRunner {
  readonly type = 'BUSINESS_SEGMENTS_PROPOSE' as const;

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

    const [existing, offerings, facts, refs] = await Promise.all([
      this.prisma.businessSegment.findMany({ where: { businessId: b.id }, select: { name: true } }),
      this.prisma.businessOffering.findMany({
        where: { businessId: b.id, isActive: true, verified: true },
        orderBy: [{ push: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, aliases: true },
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
    const room = BUSINESS_SEGMENT_LIMIT - existing.length;
    if (room <= 0) throw new NonRetryableAiError('The audience list is full');

    const text = (key: string) => b.sections.find((s) => s.key === key)?.content ?? '';
    const { blocks, texts } = sourceBlocks({
      sections: [
        { title: 'Target market section of the profile', text: text('TARGET_MARKET') },
        { title: 'Personas section of the profile', text: text('PERSONAS') },
      ],
      facts,
      references: refs,
    });
    if (!texts.length) throw new NonRetryableAiError('There is nothing to read yet');

    const result = await this.ai.execute({
      task: this.type,
      promptKey: 'business_segments_propose',
      schema: SegmentsProposeSchema,
      vars: {
        language: b.language,
        business: formatBusiness(b, { budget: 8_000 }),
        existing: existing.length ? existing.map((s) => s.name).join('\n') : '(none)',
        catalog: offerings.length ? offerings.map((o) => o.name).join('\n') : '(none)',
        sources: blocks.join('\n\n'),
      },
    });

    const resolved = resolveSegmentProposals({
      proposals: result.data.segments,
      sources: texts,
      existing: existing.map((s) => s.name),
      offerings,
      room,
    });

    // an offering has room for a few audiences only; the links beyond that are left out
    const linked = await this.prisma.offeringSegment.groupBy({
      by: ['offeringId'],
      where: { offeringId: { in: offerings.map((o) => o.id) } },
      _count: { _all: true },
    });
    const load = new Map(linked.map((l) => [l.offeringId, l._count._all]));

    let saved = 0;
    let links = 0;
    for (const [index, row] of resolved.rows.entries()) {
      try {
        const segment = await this.prisma.businessSegment.create({
          data: {
            businessId: b.id,
            kind: row.kind,
            name: row.name,
            summary: row.summary,
            goals: row.goals,
            pains: row.pains,
            objections: row.objections,
            channels: row.channels,
            messageAngle: row.messageAngle,
            evidence: row.evidence,
            // AI-proposed: unused until the admin confirms it
            source: 'AI',
            verified: false,
            isActive: false,
            sortOrder: existing.length + index,
            jobId: job.id,
          },
          select: { id: true },
        });
        saved++;
        const data = row.links
          .filter((l) => (load.get(l.offeringId) ?? 0) < OFFERING_SEGMENTS_MAX)
          .map((l) => ({ offeringId: l.offeringId, segmentId: segment.id, fit: l.fit }));
        if (data.length) {
          await this.prisma.offeringSegment.createMany({ data });
          for (const l of data) load.set(l.offeringId, (load.get(l.offeringId) ?? 0) + 1);
          links += data.length;
        }
      } catch (err) {
        // the same exact name appeared meanwhile; the admin's row wins
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      }
    }
    return {
      output: {
        businessId: b.id,
        proposed: result.data.segments.length,
        saved,
        links,
        dropped: resolved.dropped.length,
        unknownOfferings: resolved.unknownOfferings.length,
      },
      model: result.model,
      usage: result.usage,
      prompt: result.prompt,
    };
  }
}
