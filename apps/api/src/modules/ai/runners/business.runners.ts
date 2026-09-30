import { Injectable } from '@nestjs/common';
import type { AiJob, Prisma } from '@prisma/client';
import {
  BusinessBuildResultSchema,
  BusinessDiscoveryResultSchema,
  BusinessSectionKey,
  BusinessSuggestResultSchema,
  isSourceBlocked,
  sourceBlockValue,
  suggestScope,
  type ResearchScope,
  type WebSource,
} from '@contenter/shared';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { cleanUrl, writeSection } from '../../businesses/section-writer';
import { AiExecutor } from '../ai-executor.service';
import { usableWhere } from '../../businesses/references.service';
import { clamp, formatBusiness, formatReferences, formatSectionSpec } from '../context';
import {
  mergeSources,
  NonRetryableAiError,
  sumUsage,
  type ResearchResult,
} from '../provider/ai-provider';
import { filterSources, loadBlocklist, type BlockRule } from '../source-blocklist';
import type { AiRunner, RunnerResult } from './runner';

/** Web searches allowed per research step. */
const SEARCHES = { discover: 10, build: 12, suggest: 6 } as const;
const NO_RESEARCH = '(no web research for this request — rely on the business profile)';
/** Rationale of a build suggestion that sits next to admin-written text, in the business language. */
const BUILD_KEPT_NOTE: Record<string, string> = {
  fa: 'ساخته‌شده از تحقیق وب. متن خودتان حفظ شد؛ مقایسه کنید و تصمیم بگیرید.',
  en: 'Built from web research. Your own text was kept; compare and decide.',
};

const REFERENCES_ONLY =
  '(No web research was done for this request. Rely only on the admin references above and the known information; do not add facts from memory. Report what the references do not cover as gaps.)';

const asJson = (v: unknown) => v as Prisma.InputJsonValue;

type Reference = { kind: string; title: string; url: string; content: string };

/** Hosts a REFERENCE_SITES search may use: the sites of link references and the business's own. */
export function referenceSites(
  refs: Pick<Reference, 'kind' | 'url'>[],
  website: string,
  blocked: BlockRule[],
): string[] {
  const urls = [...refs.filter((r) => r.kind === 'URL').map((r) => r.url), website];
  const hosts = urls
    .map((u) => (u ? sourceBlockValue(u, 'DOMAIN') : null))
    .filter((h): h is string => !!h && !isSourceBlocked(`https://${h}`, blocked));
  return [...new Set(hosts)];
}

/**
 * Collects what a build/suggestion may consult, according to the research scope: the admin's
 * references (text snapshots) and/or web research. Returns the text for the `research` prompt
 * variable and the research call (null when no web search ran).
 */
async function consult(
  prisma: PrismaService,
  ai: AiExecutor,
  args: {
    task: 'BUSINESS_BUILD' | 'BUSINESS_SUGGEST';
    scope: ResearchScope;
    business: { id: string; website: string; language: string };
    referenceIds?: string[];
    maxSearches: number;
    /** Research goal lines and the known-information block for the web step. */
    goal: (string | null)[];
    known: string;
  },
): Promise<{
  notes: string;
  research: ResearchResult | null;
  blocked: BlockRule[];
  references: number;
}> {
  const { scope, business } = args;
  if (scope === 'NONE') return { notes: NO_RESEARCH, research: null, blocked: [], references: 0 };

  const refs: Reference[] = await prisma.businessReference.findMany({
    where: usableWhere(business.id, args.referenceIds),
    orderBy: { createdAt: 'asc' },
    select: { kind: true, title: true, url: true, content: true },
  });
  const blocked = scope === 'REFERENCES' ? [] : await loadBlocklist(prisma);
  const sites = scope === 'REFERENCE_SITES' ? referenceSites(refs, business.website, blocked) : [];
  const searchWeb = scope === 'WEB' || sites.length > 0;
  if (!refs.length && !searchWeb) {
    throw new NonRetryableAiError(
      'No readable reference is available. Add a link, a Google Doc or a text to the business references (or fix the failed ones), or choose web research.',
    );
  }

  const research = searchWeb
    ? await ai.research({
        task: args.task,
        promptKey: 'business_research',
        maxSearches: args.maxSearches,
        blocked,
        allowedDomains: scope === 'REFERENCE_SITES' ? sites : undefined,
        vars: {
          language: business.language,
          goal: [
            ...args.goal,
            refs.length
              ? `The admin already supplied these reference documents (the writer receives their full text): ${refs
                  .slice(0, 20)
                  .map((r) => `"${r.title || r.url}"`)
                  .join(', ')}. Use the web to verify and complement them, not to repeat them.`
              : null,
          ]
            .filter(Boolean)
            .join('\n'),
          business: args.known,
        },
      })
    : null;

  const notes = [
    formatReferences(refs),
    research
      ? refs.length
        ? `<web_research_notes>\n${research.text}\n</web_research_notes>`
        : research.text
      : REFERENCES_ONLY,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { notes, research, blocked, references: refs.length };
}

/**
 * Keyword → web research → real business candidates. The admin then picks one
 * (BusinessesService.selectCandidate), which creates the business and queues BUSINESS_BUILD.
 */
@Injectable()
export class BusinessDiscoverRunner implements AiRunner {
  readonly type = 'BUSINESS_DISCOVER' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiExecutor,
  ) {}

  async run(job: AiJob): Promise<RunnerResult> {
    const d = await this.prisma.businessDiscovery.findUniqueOrThrow({
      where: { id: job.targetId },
    });
    const where = d.location ? ` in or serving "${d.location}"` : '';
    const blocked = await loadBlocklist(this.prisma);

    const research = await this.ai.research({
      task: this.type,
      promptKey: 'business_research',
      maxSearches: SEARCHES.discover,
      blocked,
      vars: {
        language: d.language,
        goal: [
          `Find real, currently operating businesses that match the keyword "${d.keyword}"${where}.`,
          `Identify up to ${d.count * 2} of the most relevant and best-documented ones. For each: official name, official website, location, what it does, and why it matches the keyword.`,
          d.notes ? `Admin notes: ${d.notes}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        business: '(none yet — this research looks for businesses matching the keyword)',
      },
    });

    const result = await this.ai.execute({
      task: this.type,
      promptKey: 'business_discover',
      schema: BusinessDiscoveryResultSchema,
      vars: {
        language: d.language,
        count: d.count,
        keyword: d.keyword,
        location: d.location || '(any)',
        notes: d.notes || '(none)',
        research: research.text,
      },
    });

    const candidates = result.data.candidates
      .filter((c) => c.name.trim())
      .slice(0, d.count)
      .map((c) => ({
        ...c,
        name: c.name.trim(),
        website: cleanUrl(c.website),
        confidence: clamp(c.confidence, 0, 1),
        sourceUrls: c.sourceUrls.map(cleanUrl).filter((u) => u && !isSourceBlocked(u, blocked)),
      }));

    await this.prisma.businessDiscovery.update({
      where: { id: d.id },
      data: {
        status: 'READY',
        summary: result.data.summary,
        candidates: asJson(candidates),
        sources: asJson(research.sources),
        error: null,
      },
    });

    return {
      output: {
        discoveryId: d.id,
        candidates: candidates.length,
        sources: research.sources.length,
      },
      model: result.model,
      usage: sumUsage(research.usage, result.usage),
      prompt: result.prompt,
    };
  }

  async onFailure(job: AiJob, error: string) {
    await this.prisma.businessDiscovery.updateMany({
      where: { id: job.targetId },
      data: { status: 'FAILED', error: error.slice(0, 2000) },
    });
  }

  async onRetry(job: AiJob) {
    await this.prisma.businessDiscovery.updateMany({
      where: { id: job.targetId },
      data: { status: 'RESEARCHING', error: null },
    });
  }
}

/**
 * Researches one real business on the web and writes its whole profile. Sections the admin
 * wrote by hand are never overwritten — the AI version becomes a suggestion instead.
 */
@Injectable()
export class BusinessBuildRunner implements AiRunner {
  readonly type = 'BUSINESS_BUILD' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiExecutor,
  ) {}

  async run(job: AiJob): Promise<RunnerResult> {
    const {
      instruction = '',
      scope = 'WEB',
      referenceIds,
    } = (job.input ?? {}) as {
      instruction?: string;
      scope?: ResearchScope;
      referenceIds?: string[];
    };
    const b = await this.prisma.business.findUniqueOrThrow({
      where: { id: job.targetId },
      include: { sections: true },
    });
    const known = formatBusiness(b);
    const identity = [
      `"${b.name}"`,
      b.website ? `(website: ${b.website})` : null,
      b.location ? `located in ${b.location}` : null,
      b.keyword ? `— found for the keyword "${b.keyword}"` : null,
    ]
      .filter(Boolean)
      .join(' ');
    const { notes, research, blocked, references } = await consult(this.prisma, this.ai, {
      task: this.type,
      scope,
      business: b,
      referenceIds,
      maxSearches: SEARCHES.build,
      goal: [
        `Research the real business ${identity} in depth, for a complete business profile covering:`,
        formatSectionSpec(),
        'Make sure you are researching this exact business, not a namesake.',
        instruction ? `Admin instruction: ${instruction}` : null,
      ],
      known,
    });

    const result = await this.ai.execute({
      task: this.type,
      promptKey: 'business_build',
      schema: BusinessBuildResultSchema,
      vars: {
        language: b.language,
        business_name: b.name,
        sections_spec: formatSectionSpec(),
        business: known,
        instruction: instruction || '(none)',
        research: notes,
      },
    });
    const data = result.data;

    const byKey = new Map(b.sections.map((s) => [s.key, s]));
    const seen = new Set<string>();
    let written = 0;
    let suggested = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const s of data.sections) {
        const content = s.content.trim();
        if (!content || seen.has(s.key)) continue;
        seen.add(s.key);
        const existing = byKey.get(s.key);
        if (existing?.content.trim() && existing.source === 'ADMIN') {
          if (existing.content.trim() === content) continue;
          await tx.businessSuggestion.updateMany({
            where: { businessId: b.id, key: s.key, status: 'PENDING' },
            data: { status: 'DISMISSED', decidedAt: new Date() },
          });
          await tx.businessSuggestion.create({
            data: {
              businessId: b.id,
              key: s.key,
              content,
              rationale: BUILD_KEPT_NOTE[b.language] ?? BUILD_KEPT_NOTE.en!,
              jobId: job.id,
            },
          });
          suggested++;
        } else {
          await writeSection(tx, {
            businessId: b.id,
            key: s.key,
            content,
            source: 'AI',
            userId: null,
          });
          written++;
        }
      }
      await tx.business.update({
        where: { id: b.id },
        data: {
          // Core fields the admin already filled win over research.
          tagline: b.tagline || data.tagline.trim(),
          industry: b.industry || data.industry.trim(),
          website: b.website || cleanUrl(data.website),
          location: b.location || data.location.trim(),
          ...(research
            ? {
                sources: asJson(
                  filterSources(
                    mergeSources(b.sources as unknown as WebSource[], research.sources),
                    blocked,
                  ),
                ),
              }
            : {}),
          gaps: data.gaps.map((g) => g.trim()).filter(Boolean),
          buildState: 'READY',
          buildError: null,
          researchedAt: new Date(),
        },
      });
    });

    return {
      output: {
        businessId: b.id,
        sectionsWritten: written,
        suggestions: suggested,
        scope,
        references,
        sources: research?.sources.length ?? 0,
      },
      model: result.model,
      usage: research ? sumUsage(research.usage, result.usage) : result.usage,
      prompt: result.prompt,
    };
  }

  async onFailure(job: AiJob, error: string) {
    await this.prisma.business.updateMany({
      where: { id: job.targetId },
      data: { buildState: 'FAILED', buildError: error.slice(0, 2000) },
    });
  }

  async onRetry(job: AiJob) {
    await this.prisma.business.updateMany({
      where: { id: job.targetId },
      data: { buildState: 'BUILDING', buildError: null },
    });
  }
}

/** Proposes content for selected sections from everything already written (± web research). */
@Injectable()
export class BusinessSuggestRunner implements AiRunner {
  readonly type = 'BUSINESS_SUGGEST' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiExecutor,
  ) {}

  async run(job: AiJob): Promise<RunnerResult> {
    const input = (job.input ?? {}) as {
      keys?: string[];
      instruction?: string;
      scope?: ResearchScope;
      referenceIds?: string[];
      useWebSearch?: boolean;
    };
    const scope = suggestScope(input);
    const keys = BusinessSectionKey.filter((k) => input.keys?.includes(k));
    if (!keys.length) throw new NonRetryableAiError('No sections were requested');
    const b = await this.prisma.business.findUniqueOrThrow({
      where: { id: job.targetId },
      include: { sections: true },
    });

    const { notes, research, blocked, references } = await consult(this.prisma, this.ai, {
      task: this.type,
      scope,
      business: b,
      referenceIds: input.referenceIds,
      maxSearches: SEARCHES.suggest,
      goal: [
        `Research the real business "${b.name}"${b.website ? ` (website: ${b.website})` : ''} to write these profile sections:`,
        formatSectionSpec(keys),
        input.instruction ? `Admin instruction: ${input.instruction}` : null,
      ],
      known: formatBusiness(b),
    });

    const result = await this.ai.execute({
      task: this.type,
      promptKey: 'business_suggest',
      schema: BusinessSuggestResultSchema,
      vars: {
        language: b.language,
        business: formatBusiness(b, { includeEmpty: true }),
        requested_sections: formatSectionSpec(keys),
        instruction: input.instruction || '(none)',
        research: notes,
      },
    });

    const picked = new Map<
      string,
      { key: BusinessSectionKey; content: string; rationale: string }
    >();
    for (const s of result.data.suggestions) {
      if (keys.includes(s.key) && s.content.trim() && !picked.has(s.key)) {
        picked.set(s.key, { key: s.key, content: s.content.trim(), rationale: s.rationale.trim() });
      }
    }
    await this.prisma.$transaction([
      this.prisma.businessSuggestion.updateMany({
        where: {
          businessId: b.id,
          key: { in: [...picked.keys()] as BusinessSectionKey[] },
          status: 'PENDING',
        },
        data: { status: 'DISMISSED', decidedAt: new Date() },
      }),
      this.prisma.businessSuggestion.createMany({
        data: [...picked.values()].map((s) => ({ ...s, businessId: b.id, jobId: job.id })),
      }),
    ]);
    if (research?.sources.length) {
      await this.prisma.business.update({
        where: { id: b.id },
        data: {
          sources: asJson(
            filterSources(
              mergeSources(b.sources as unknown as WebSource[], research.sources),
              blocked,
            ),
          ),
        },
      });
    }

    return {
      output: {
        businessId: b.id,
        suggestions: picked.size,
        scope,
        references,
        webSearch: !!research,
      },
      model: result.model,
      usage: research ? sumUsage(research.usage, result.usage) : result.usage,
      prompt: result.prompt,
    };
  }
}
