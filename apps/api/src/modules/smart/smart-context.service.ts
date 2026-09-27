import { Injectable } from '@nestjs/common';
import type { WalkerStepKey } from '@contenter/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  ErrorTrackerService,
  InteractionService,
  SmartSettingsService,
  WalkerProgressService,
} from './smart-core.services';

export interface SmartContextInput {
  userId: string;
  route?: string | null;
  topicId?: string | null;
  walkerStep?: WalkerStepKey | null;
  errorId?: string | null;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : '—');
const clip = (s: string | null | undefined, n = 400) =>
  !s ? '' : s.length > n ? `${s.slice(0, n)}…` : s;

/**
 * Builds the read-only context snapshot the Smart assistant sees: where the admin is,
 * the project state in the database, recent activity (audit + interaction logs),
 * recent AI job failures and open errors. Deterministic code — the AI only reads it.
 */
@Injectable()
export class SmartContextBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walker: WalkerProgressService,
    private readonly interactions: InteractionService,
    private readonly errors: ErrorTrackerService,
    private readonly settings: SmartSettingsService,
  ) {}

  async build(input: SmartContextInput): Promise<string> {
    const sections: string[] = [];
    const smart = await this.settings.get();

    sections.push(
      [
        '## Admin position',
        `- Current page (route): ${input.route ?? 'unknown'}`,
        `- Walker step: ${input.walkerStep ?? 'none'}`,
        `- Now: ${new Date().toISOString()}`,
        `- Detailed interaction logging: ${smart.detailedLogging ? 'ON (API calls, page views and clicks are recorded)' : 'OFF (only the audit log of mutations is available)'}`,
      ].join('\n'),
    );

    if (input.topicId) sections.push(await this.topicSection(input.topicId));

    if (input.errorId) {
      const e = await this.prisma.appError.findUnique({ where: { id: input.errorId } });
      if (e) {
        sections.push(
          [
            '## Error under discussion',
            `- id: ${e.id} · source: ${e.source} · category: ${e.category} · status: ${e.status} · occurrences: ${e.count}`,
            `- first seen: ${iso(e.firstSeenAt)} · last seen: ${iso(e.lastSeenAt)}`,
            `- request: ${e.method ?? ''} ${e.path ?? ''} ${e.statusCode ? `→ ${e.statusCode}` : ''}`.trim(),
            `- page: ${e.route ?? '—'} · AI job: ${e.jobId ?? '—'}`,
            `- message: ${e.message}`,
            e.detail ? `- detail / stack:\n${clip(e.detail, 6000)}` : '',
            e.context ? `- context: ${clip(JSON.stringify(e.context), 3000)}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        );
        if (e.jobId) sections.push(await this.jobSection(e.jobId));
      }
    }

    const activity = await this.interactions.recentActivity(input.userId, 60);
    sections.push(
      [
        '## Recent activity of this admin (newest first)',
        ...(activity.length
          ? activity.map(
              (a) => `- ${a.at} [${a.kind}] ${a.label}${a.detail ? ` (${a.detail})` : ''}`,
            )
          : ['- (none recorded)']),
      ].join('\n'),
    );

    const failedJobs = await this.prisma.aiJob.findMany({
      where: { status: 'FAILED', ...(input.topicId ? { topicId: input.topicId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });
    if (failedJobs.length) {
      sections.push(
        [
          '## Recent failed AI jobs',
          ...failedJobs.map(
            (j) =>
              `- ${iso(j.createdAt)} ${j.type} job=${j.id} target=${j.targetType}:${j.targetId} error: ${clip(j.error, 300)}`,
          ),
        ].join('\n'),
      );
    }

    const openErrors = await this.prisma.appError.findMany({
      where: { status: { in: ['NEW', 'SEEN'] } },
      orderBy: { lastSeenAt: 'desc' },
      take: 10,
    });
    if (openErrors.length) {
      sections.push(
        [
          '## Open application errors',
          ...openErrors.map(
            (e) =>
              `- ${iso(e.lastSeenAt)} [${e.source}/${e.category}] ×${e.count} ${e.method ?? ''} ${e.path ?? e.route ?? ''} — ${clip(e.message, 200)} (id ${e.id})`,
          ),
        ].join('\n'),
      );
    }

    return sections.join('\n\n');
  }

  private async topicSection(topicId: string): Promise<string> {
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      include: {
        principles: { where: { isActive: true } },
        brandDocs: { select: { id: true, title: true, kind: true, isActive: true } },
        business: {
          select: {
            id: true,
            name: true,
            buildState: true,
            buildError: true,
            sections: { select: { key: true, content: true } },
          },
        },
        samples: { orderBy: { createdAt: 'desc' }, take: 15 },
        profiles: {
          orderBy: { version: 'desc' },
          take: 3,
          include: { _count: { select: { traits: true } } },
        },
        contents: {
          orderBy: { updatedAt: 'desc' },
          take: 8,
          include: { currentVersion: { select: { version: true, selfCheck: true } } },
        },
      },
    });
    if (!topic) return `## Project\n- topic ${topicId} not found`;
    const progress = await this.walker.progress(topicId);
    const [ideas, jobs] = await Promise.all([
      this.prisma.idea.groupBy({ by: ['status'], where: { topicId }, _count: { _all: true } }),
      this.prisma.aiJob.findMany({ where: { topicId }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);
    const lines = [
      `## Project (topic) "${topic.title}" id=${topic.id}`,
      `- platform: ${topic.platform} · language: ${topic.language} · status: ${topic.status} · active profile: ${topic.activeProfileId ?? 'none'}`,
      `- description: ${clip(topic.description, 800)}`,
      topic.audience ? `- audience: ${clip(topic.audience, 300)}` : '',
      `- walker progress: ${progress.steps.map((s) => `${s.key}=${s.done ? 'done' : s.blocked ? 'blocked' : 'todo'}${s.target !== undefined ? `(${s.current}/${s.target})` : ''}`).join(', ')}`,
      `- topic principles (${topic.principles.length}): ${topic.principles.map((p) => `[${p.kind}] ${clip(p.text, 120)}`).join(' | ') || 'none'}`,
      `- brand documents (${topic.brandDocs.length}): ${topic.brandDocs.map((d) => `${d.id} [${d.kind}${d.isActive ? '' : ' · inactive'}] ${clip(d.title, 80)}`).join(' | ') || 'none'}`,
      topic.business
        ? `- business: "${topic.business.name}" id=${topic.business.id} build=${topic.business.buildState}${topic.business.buildError ? `(${clip(topic.business.buildError, 160)})` : ''} filled sections: ${
            topic.business.sections
              .filter((s) => s.content.trim())
              .map((s) => s.key)
              .join(', ') || 'none'
          } (sent to every AI job of this topic)`
        : '- business: none linked (AI jobs get no business profile)',
      '### Samples',
      ...(topic.samples.length
        ? topic.samples.map(
            (s) =>
              `- ${s.id} ${s.platform}/${s.mediaType} fetch=${s.fetchStatus}${s.fetchError ? `(${clip(s.fetchError, 120)})` : ''} analysis=${s.analysisStatus} manualText=${s.manualText ? 'yes' : 'no'} url=${s.url}`,
          )
        : ['- none']),
      '### Profiles',
      ...(topic.profiles.length
        ? topic.profiles.map(
            (p) =>
              `- v${p.version} ${p.id} status=${p.status} traits=${p._count.traits} samplesUsed=${p.sampleIds.length} brandDocsUsed=${p.brandDocIds.length} origin=${p.jobId ? `ai(job ${p.jobId})` : p.basedOnVersion ? `copy-of-v${p.basedOnVersion}` : 'manual'}`,
          )
        : ['- none']),
      `### Ideas by status: ${ideas.map((i) => `${i.status}=${i._count._all}`).join(', ') || 'none'}`,
      '### Latest contents',
      ...(topic.contents.length
        ? topic.contents.map((c) => {
            const score = (c.currentVersion?.selfCheck as { score?: number } | null)?.score;
            return `- ${c.id} "${clip(c.title, 80)}" ${c.format} status=${c.status} version=${c.currentVersion?.version ?? '—'} selfCheckScore=${score ?? '—'}`;
          })
        : ['- none']),
      '### Latest AI jobs for this topic',
      ...(jobs.length
        ? jobs.map(
            (j) =>
              `- ${iso(j.createdAt)} ${j.type} ${j.status} job=${j.id}${j.error ? ` error: ${clip(j.error, 200)}` : ''}`,
          )
        : ['- none']),
    ];
    return lines.filter(Boolean).join('\n');
  }

  private async jobSection(jobId: string): Promise<string> {
    const j = await this.prisma.aiJob.findUnique({ where: { id: jobId } });
    if (!j) return '';
    return [
      '## Related AI job',
      `- ${j.type} status=${j.status} attempts=${j.attempts} model=${j.model ?? '—'} prompt=${j.promptKey ?? '—'} v${j.promptVersion ?? '—'}`,
      `- target: ${j.targetType}:${j.targetId}`,
      `- input: ${clip(JSON.stringify(j.input), 1500)}`,
      j.error ? `- error: ${clip(j.error, 2000)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
}
