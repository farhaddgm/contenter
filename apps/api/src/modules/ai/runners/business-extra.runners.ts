import { Injectable, Logger } from '@nestjs/common';
import type { AiJob, Prisma } from '@prisma/client';
import {
  ASSET_MAX_PREVIEWS,
  AuditTarget,
  BusinessAssetAnalysisSchema,
  BusinessAuditResultSchema,
  BusinessReviseResultSchema,
  BusinessSectionKey,
  type NoteApplyMode,
  type ResearchScope,
  type WebSource,
} from '@contenter/shared';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { FileStorageService } from '../../../infra/storage/file-storage.service';
import { cleanUrl, writeSection } from '../../businesses/section-writer';
import { AiExecutor } from '../ai-executor.service';
import { clamp, formatBusiness, formatSectionSpec, formatStandingNotes } from '../context';
import { BUSINESS_PROMPT_INCLUDE, ContextLoader } from '../context-loader.service';
import { mergeSources, NonRetryableAiError, sumUsage } from '../provider/ai-provider';
import { filterSources } from '../source-blocklist';
import { consult, SEARCHES } from './business.runners';
import type { AiRunner, RunnerResult } from './runner';

const MAX_ASSET_PROMPT_TEXT = 14_000;
const asJson = (v: unknown) => v as Prisma.InputJsonValue;

/**
 * Applies an admin note to the whole business profile: AI returns every section the note
 * affects, which is written directly (the old text stays in the section history) or, in
 * SUGGEST mode, queued as suggestions for the admin to accept.
 */
@Injectable()
export class BusinessReviseRunner implements AiRunner {
  readonly type = 'BUSINESS_REVISE' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiExecutor,
    private readonly ctx: ContextLoader,
  ) {}

  async run(job: AiJob): Promise<RunnerResult> {
    const input = (job.input ?? {}) as {
      noteId?: string;
      scope?: ResearchScope;
      referenceIds?: string[];
      apply?: NoteApplyMode;
    };
    const note = await this.prisma.businessNote.findUnique({ where: { id: input.noteId ?? '' } });
    if (!note) throw new NonRetryableAiError('The note no longer exists');
    const b = await this.prisma.business.findUniqueOrThrow({
      where: { id: job.targetId },
      include: { ...BUSINESS_PROMPT_INCLUDE, sections: true },
    });
    const apply = input.apply ?? note.apply;
    const profile = formatBusiness(b, { includeEmpty: true });

    const { notes, research, blocked, references } = await consult(this.prisma, this.ai, {
      task: this.type,
      scope: input.scope ?? 'NONE',
      business: b,
      referenceIds: input.referenceIds,
      maxSearches: SEARCHES.revise,
      goal: [
        `The admin of the real business "${b.name}"${b.website ? ` (website: ${b.website})` : ''} wrote this note about its profile:`,
        note.text,
        'Research what is needed to apply the note correctly: verify the facts it mentions and find the details it asks for.',
      ],
      known: profile,
    });

    const result = await this.ai.execute({
      task: this.type,
      promptKey: 'business_revise',
      schema: BusinessReviseResultSchema,
      vars: {
        language: b.language,
        sections_spec: formatSectionSpec(),
        business: profile,
        gaps: b.gaps.length ? b.gaps.map((g) => `- ${g}`).join('\n') : '(none)',
        standing_notes:
          formatStandingNotes(await this.ctx.standingNotes(b.id, note.id)) || '(none)',
        research: notes,
        note: note.text,
      },
    });
    const data = result.data;

    const byKey = new Map(b.sections.map((s) => [s.key, s]));
    const changed: BusinessSectionKey[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const s of data.sections) {
        const content = s.content.trim();
        if (!content || changed.includes(s.key)) continue;
        if (byKey.get(s.key)?.content.trim() === content) continue;
        changed.push(s.key);
        if (apply === 'SUGGEST') {
          await tx.businessSuggestion.updateMany({
            where: { businessId: b.id, key: s.key, status: 'PENDING' },
            data: { status: 'DISMISSED', decidedAt: new Date() },
          });
          await tx.businessSuggestion.create({
            data: {
              businessId: b.id,
              key: s.key,
              content,
              rationale: s.change.trim(),
              jobId: job.id,
            },
          });
        } else {
          // The admin asked for this rewrite, so hand-written sections are updated too; the
          // previous text is kept as a restorable revision by writeSection.
          await writeSection(tx, {
            businessId: b.id,
            key: s.key,
            content,
            source: 'AI',
            userId: null,
          });
        }
      }
      const direct = apply === 'DIRECT';
      await tx.business.update({
        where: { id: b.id },
        data: {
          ...(direct
            ? {
                tagline: data.tagline.trim() || b.tagline,
                industry: data.industry.trim() || b.industry,
                website: cleanUrl(data.website) || b.website,
                location: data.location.trim() || b.location,
                gaps: data.gaps.map((g) => g.trim()).filter(Boolean),
              }
            : {}),
          ...(research
            ? {
                sources: asJson(
                  filterSources(
                    mergeSources(b.sources as unknown as WebSource[], research.sources),
                    blocked,
                  ),
                ),
                researchedAt: new Date(),
              }
            : {}),
        },
      });
      await tx.businessNote.update({
        where: { id: note.id },
        data: {
          status: 'APPLIED',
          summary: data.summary.trim().slice(0, 4000),
          changedKeys: BusinessSectionKey.filter((k) => changed.includes(k)),
          error: null,
        },
      });
    });

    return {
      output: {
        businessId: b.id,
        noteId: note.id,
        apply,
        sectionsChanged: changed.length,
        references,
        webSearch: !!research,
      },
      model: result.model,
      usage: research ? sumUsage(research.usage, result.usage) : result.usage,
      prompt: result.prompt,
    };
  }

  async onFailure(job: AiJob, error: string) {
    const { noteId } = (job.input ?? {}) as { noteId?: string };
    if (!noteId) return;
    await this.prisma.businessNote.updateMany({
      where: { id: noteId },
      data: { status: 'FAILED', error: error.slice(0, 2000) },
    });
  }

  async onRetry(job: AiJob) {
    const { noteId } = (job.input ?? {}) as { noteId?: string };
    if (!noteId) return;
    await this.prisma.businessNote.updateMany({
      where: { id: noteId },
      data: { status: 'PENDING', error: null },
    });
  }
}

/**
 * Turns one brand asset into a style analysis. Uploaded images (or the frames captured from a
 * video in the browser) are sent as vision input; articles and captions as text.
 */
@Injectable()
export class BusinessAssetAnalyzeRunner implements AiRunner {
  readonly type = 'BUSINESS_ASSET_ANALYZE' as const;
  private readonly logger = new Logger(BusinessAssetAnalyzeRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiExecutor,
    private readonly storage: FileStorageService,
  ) {}

  async run(job: AiJob): Promise<RunnerResult> {
    const asset = await this.prisma.businessAsset.findUnique({
      where: { id: job.targetId },
      include: { business: { include: { sections: { select: { key: true, content: true } } } } },
    });
    if (!asset) throw new NonRetryableAiError('The asset no longer exists');

    const images: string[] = [];
    for (const key of asset.previews.slice(0, ASSET_MAX_PREVIEWS)) {
      if (!this.storage.exists(key)) {
        this.logger.warn(`preview ${key} of asset ${asset.id} is missing on disk`);
        continue;
      }
      images.push(await this.storage.dataUrl(key));
    }
    if (!images.length) images.push(...asset.remoteImages.slice(0, 2));

    const text = asset.text.trim();
    if (!images.length && !text && !asset.description.trim()) {
      throw new NonRetryableAiError(
        'Nothing to analyze: the asset has no readable image, text or description. Add a description or the text of the piece.',
      );
    }

    const result = await this.ai.execute({
      task: this.type,
      promptKey: 'business_asset_analyze',
      schema: BusinessAssetAnalysisSchema,
      imageUrls: images,
      vars: {
        language: asset.business.language,
        // A compact profile is enough to recognize the brand; the asset is the subject.
        business: formatBusiness(asset.business, { budget: 6_000 }),
        kind: asset.kind,
        title: asset.title || '(untitled)',
        url: asset.url || '(none)',
        images: images.length
          ? `${images.length} (${asset.previews.length > 1 ? 'frames of the video, in order' : 'the piece itself'})`
          : 'none — judge from the text and the admin note only',
        description: asset.description || '(none)',
        text: text
          ? text.length > MAX_ASSET_PROMPT_TEXT
            ? `${text.slice(0, MAX_ASSET_PROMPT_TEXT)}\n[truncated]`
            : text
          : '(no text)',
      },
    });

    await this.prisma.businessAsset.update({
      where: { id: asset.id },
      data: { analysis: asJson(result.data), analysisStatus: 'DONE', analysisError: null },
    });
    return {
      output: { assetId: asset.id, businessId: asset.businessId, images: images.length },
      model: result.model,
      usage: result.usage,
      prompt: result.prompt,
    };
  }

  async onFailure(job: AiJob, error: string) {
    await this.prisma.businessAsset.updateMany({
      where: { id: job.targetId },
      data: { analysisStatus: 'FAILED', analysisError: error.slice(0, 2000) },
    });
  }

  async onRetry(job: AiJob) {
    await this.prisma.businessAsset.updateMany({
      where: { id: job.targetId },
      data: { analysisStatus: 'QUEUED', analysisError: null },
    });
  }
}

const MAX_AUDIT_ISSUES = 15;

/**
 * Quality review of the whole profile (docs/16): contradictions, gaps, vague, unsupported or
 * risky text. The issues are stored on the BusinessAudit row; the admin fixes them with one
 * click (a one-off note → BUSINESS_REVISE) or dismisses them.
 */
@Injectable()
export class BusinessAuditRunner implements AiRunner {
  readonly type = 'BUSINESS_AUDIT' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiExecutor,
    private readonly ctx: ContextLoader,
  ) {}

  async run(job: AiJob): Promise<RunnerResult> {
    const { auditId } = (job.input ?? {}) as { auditId?: string };
    const audit = await this.prisma.businessAudit.findUnique({ where: { id: auditId ?? '' } });
    if (!audit) throw new NonRetryableAiError('The audit no longer exists');
    const b = await this.prisma.business.findUniqueOrThrow({
      where: { id: job.targetId },
      include: BUSINESS_PROMPT_INCLUDE,
    });

    const result = await this.ai.execute({
      task: this.type,
      promptKey: 'business_audit',
      schema: BusinessAuditResultSchema,
      vars: {
        language: b.language,
        sections_spec: formatSectionSpec(),
        business: formatBusiness(b, { includeEmpty: true }),
        gaps: b.gaps.length ? b.gaps.map((g) => `- ${g}`).join('\n') : '(none)',
        standing_notes: formatStandingNotes(await this.ctx.standingNotes(b.id)) || '(none)',
      },
    });
    const data = result.data;
    const issues = data.issues
      .filter((i) => i.title.trim() && AuditTarget.includes(i.target))
      .slice(0, MAX_AUDIT_ISSUES)
      .map((i) => ({
        ...i,
        title: i.title.trim(),
        detail: i.detail.trim(),
        fix: i.fix.trim(),
        status: 'OPEN' as const,
      }));

    await this.prisma.businessAudit.update({
      where: { id: audit.id },
      data: {
        status: 'READY',
        score: Math.round(clamp(data.score, 0, 100)),
        summary: data.summary.trim().slice(0, 4000),
        strengths: data.strengths
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 5),
        issues: asJson(issues),
        error: null,
      },
    });

    return {
      output: { businessId: b.id, auditId: audit.id, issues: issues.length },
      model: result.model,
      usage: result.usage,
      prompt: result.prompt,
    };
  }

  async onFailure(job: AiJob, error: string) {
    const { auditId } = (job.input ?? {}) as { auditId?: string };
    if (!auditId) return;
    await this.prisma.businessAudit.updateMany({
      where: { id: auditId },
      data: { status: 'FAILED', error: error.slice(0, 2000) },
    });
  }

  async onRetry(job: AiJob) {
    const { auditId } = (job.input ?? {}) as { auditId?: string };
    if (!auditId) return;
    await this.prisma.businessAudit.updateMany({
      where: { id: auditId },
      data: { status: 'RUNNING', error: null },
    });
  }
}
