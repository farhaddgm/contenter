/**
 * Smart core services — global, depend only on Prisma/Audit so any module (filters,
 * AI jobs, runners) can use them without circular imports.
 */
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  ActivityItem,
  ClientEventsBatch,
  ErrorSource,
  SmartConfig,
  SmartSettings,
  WalkerProgress,
  WalkerStepKey,
  WalkerStepProgress,
} from '@contenter/shared';
import { WalkerStepKey as STEP_KEYS } from '@contenter/shared';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { paginate, toPage } from '../../common/pagination';
import { AuditService } from '../audit/audit.service';
import { categorize, fingerprint, hintFor, sanitize } from './error-classifier';

const SMART_KEY = 'smart';
const DEFAULT_SMART: SmartSettings = { detailedLogging: false, retentionDays: 30 };
const CACHE_MS = 15_000;

// ───────────────────────────── settings ─────────────────────────────

@Injectable()
export class SmartSettingsService {
  private cache: { value: SmartSettings; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<SmartSettings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const row = await this.prisma.systemSetting.findUnique({ where: { key: SMART_KEY } });
    const stored = (row?.value ?? {}) as Partial<SmartSettings>;
    const value = { ...DEFAULT_SMART, ...stored };
    this.cache = { value, at: Date.now() };
    return value;
  }

  async update(input: SmartSettings, userId: string): Promise<SmartSettings> {
    await this.prisma.systemSetting.upsert({
      where: { key: SMART_KEY },
      create: { key: SMART_KEY, value: input as unknown as Prisma.InputJsonValue },
      update: { value: input as unknown as Prisma.InputJsonValue },
    });
    this.cache = null;
    this.audit.log({
      userId,
      action: 'settings.smart_update',
      entityType: 'SystemSetting',
      entityId: SMART_KEY,
      meta: input as unknown as Record<string, unknown>,
    });
    return this.get();
  }

  async config(): Promise<SmartConfig> {
    return this.get();
  }
}

// ───────────────────────────── interactions ─────────────────────────────

export interface ServerInteraction {
  userId?: string | null;
  method: string;
  path: string;
  route?: string | null;
  statusCode: number;
  durationMs: number;
  meta?: Record<string, unknown>;
}

@Injectable()
export class InteractionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InteractionService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SmartSettingsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    // Retention pruning runs on the worker (or the all-in-one process).
    if (this.env.APP_ROLE === 'api' || this.env.NODE_ENV === 'test') return;
    const run = () => void this.prune().catch((e) => this.logger.warn(`prune failed: ${e}`));
    setTimeout(run, 30_000);
    this.timer = setInterval(run, 6 * 3600_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async isEnabled() {
    return (await this.settings.get()).detailedLogging;
  }

  /** Fire-and-forget; never throws. Only called when detailed logging is on. */
  logServer(i: ServerInteraction) {
    this.prisma.interactionLog
      .create({
        data: {
          userId: i.userId ?? null,
          source: 'SERVER',
          type: 'api.request',
          method: i.method,
          path: i.path.slice(0, 500),
          route: i.route ?? null,
          statusCode: i.statusCode,
          durationMs: i.durationMs,
          meta: (i.meta ? sanitize(i.meta) : undefined) as Prisma.InputJsonValue | undefined,
        },
      })
      .catch((e) => this.logger.warn(`interaction write failed: ${e}`));
  }

  async logClient(batch: ClientEventsBatch, userId: string): Promise<{ stored: number }> {
    if (!(await this.isEnabled())) return { stored: 0 };
    const data = batch.events.map((e) => ({
      userId,
      sessionId: batch.sessionId,
      source: 'CLIENT' as const,
      type: e.type,
      route: e.route?.slice(0, 500) ?? null,
      target: e.target?.slice(0, 300) ?? null,
      meta: (e.meta ? sanitize(e.meta) : undefined) as Prisma.InputJsonValue | undefined,
      createdAt: e.at ? new Date(e.at) : new Date(),
    }));
    await this.prisma.interactionLog.createMany({ data });
    return { stored: data.length };
  }

  async list(query: {
    page: number;
    pageSize: number;
    q?: string;
    type?: string;
    userId?: string;
  }) {
    const where: Prisma.InteractionLogWhereInput = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.q
        ? {
            OR: [
              { path: { contains: query.q, mode: 'insensitive' } },
              { route: { contains: query.q, mode: 'insensitive' } },
              { target: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.interactionLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, name: true } } },
        ...paginate(query),
      }),
      this.prisma.interactionLog.count({ where }),
    ]);
    return toPage(items, total, query);
  }

  /** Merged timeline of audit log + interaction log for one user (newest first). */
  async recentActivity(userId: string, limit = 40): Promise<ActivityItem[]> {
    const [audits, interactions] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.interactionLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    ]);
    const items: ActivityItem[] = [
      ...audits.map((a) => ({
        kind: 'audit' as const,
        id: a.id,
        label: a.action,
        detail: [a.entityType, a.entityId].filter(Boolean).join(':') || null,
        at: a.createdAt.toISOString(),
      })),
      ...interactions.map((i) => ({
        kind: 'interaction' as const,
        id: i.id,
        label: i.type === 'api.request' ? `${i.method} ${i.path} → ${i.statusCode}` : i.type,
        detail: i.target ?? i.route ?? null,
        at: i.createdAt.toISOString(),
      })),
    ];
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }

  async prune() {
    const { retentionDays } = await this.settings.get();
    const before = new Date(Date.now() - retentionDays * 86_400_000);
    const { count } = await this.prisma.interactionLog.deleteMany({
      where: { createdAt: { lt: before } },
    });
    if (count) this.logger.log(`pruned ${count} interaction logs older than ${retentionDays} days`);
  }
}

// ───────────────────────────── errors ─────────────────────────────

export interface RecordErrorInput {
  source: ErrorSource;
  message: string;
  detail?: string | null;
  errorName?: string | null;
  statusCode?: number | null;
  method?: string | null;
  path?: string | null;
  route?: string | null;
  jobId?: string | null;
  userId?: string | null;
  context?: Record<string, unknown>;
}

@Injectable()
export class ErrorTrackerService {
  private readonly logger = new Logger(ErrorTrackerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Records (or groups) an error. Never throws; returns the AppError id or null. */
  async record(input: RecordErrorInput): Promise<string | null> {
    try {
      const message = input.message.slice(0, 2000) || 'Unknown error';
      const category = categorize({ ...input, message });
      const fp = fingerprint({ source: input.source, category, message, path: input.path });
      const existing = await this.prisma.appError.findFirst({
        where: { fingerprint: fp, status: { in: ['NEW', 'SEEN'] } },
        orderBy: { lastSeenAt: 'desc' },
      });
      const context = (input.context ? sanitize(input.context) : undefined) as
        Prisma.InputJsonValue | undefined;
      if (existing) {
        await this.prisma.appError.update({
          where: { id: existing.id },
          data: {
            count: { increment: 1 },
            lastSeenAt: new Date(),
            status: 'NEW',
            detail: input.detail?.slice(0, 20_000) ?? existing.detail,
            ...(context ? { context } : {}),
            ...(input.userId ? { userId: input.userId } : {}),
            ...(input.jobId ? { jobId: input.jobId } : {}),
          },
        });
        return existing.id;
      }
      const created = await this.prisma.appError.create({
        data: {
          fingerprint: fp,
          source: input.source,
          category,
          message,
          hint: hintFor(category),
          detail: input.detail?.slice(0, 20_000) ?? null,
          statusCode: input.statusCode ?? null,
          method: input.method ?? null,
          path: input.path?.slice(0, 500) ?? null,
          route: input.route?.slice(0, 500) ?? null,
          jobId: input.jobId ?? null,
          userId: input.userId ?? null,
          context,
        },
      });
      return created.id;
    } catch (e) {
      this.logger.warn(`could not record error: ${e}`);
      return null;
    }
  }

  async list(query: {
    page: number;
    pageSize: number;
    q?: string;
    status?: string;
    source?: string;
  }) {
    const where: Prisma.AppErrorWhereInput = {
      ...(query.status ? { status: query.status as Prisma.AppErrorWhereInput['status'] } : {}),
      ...(query.source ? { source: query.source as Prisma.AppErrorWhereInput['source'] } : {}),
      ...(query.q
        ? {
            OR: [
              { message: { contains: query.q, mode: 'insensitive' } },
              { path: { contains: query.q, mode: 'insensitive' } },
              { id: query.q },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.appError.findMany({
        where,
        orderBy: { lastSeenAt: 'desc' },
        include: { user: { select: { id: true, name: true } } },
        ...paginate(query),
      }),
      this.prisma.appError.count({ where }),
    ]);
    return toPage(items, total, query);
  }

  /** Errors that appeared or re-occurred after `since` — drives the toast feed. */
  feed(since: Date) {
    return this.prisma.appError.findMany({
      where: { lastSeenAt: { gt: since }, status: { in: ['NEW', 'SEEN'] } },
      orderBy: { lastSeenAt: 'asc' },
      take: 20,
      include: { user: { select: { id: true, name: true } } },
    });
  }

  async get(id: string) {
    const e = await this.prisma.appError.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true } } },
    });
    if (!e) throw new NotFoundException('Error not found');
    return e;
  }

  update(id: string, status: 'NEW' | 'SEEN' | 'RESOLVED' | 'IGNORED') {
    return this.prisma.appError.update({ where: { id }, data: { status } });
  }

  countOpen() {
    return this.prisma.appError.count({ where: { status: 'NEW' } });
  }
}

// ───────────────────────────── walker progress ─────────────────────────────

@Injectable()
export class WalkerProgressService {
  constructor(private readonly prisma: PrismaService) {}

  async progress(topicId?: string | null): Promise<WalkerProgress> {
    const topic = topicId ? await this.prisma.topic.findUnique({ where: { id: topicId } }) : null;
    if (!topic) {
      const steps = STEP_KEYS.map((key, i) => ({ key, done: false, blocked: i > 0 }));
      return {
        topic: null,
        steps,
        nextStep: 'select_topic',
        completed: false,
        refs: { latestContentId: null, reviewContentId: null, latestProfileId: null },
      };
    }

    const [
      principles,
      samples,
      analyzed,
      profiles,
      latestProfile,
      ideas,
      contents,
      reviewed,
      approved,
      latestContent,
      reviewContent,
    ] = await Promise.all([
      this.prisma.principle.count({
        where: { isActive: true, OR: [{ topicId: topic.id }, { topicId: null }] },
      }),
      this.prisma.sampleContent.count({ where: { topicId: topic.id } }),
      this.prisma.sampleContent.count({ where: { topicId: topic.id, analysisStatus: 'DONE' } }),
      this.prisma.contentProfile.count({ where: { topicId: topic.id } }),
      this.prisma.contentProfile.findFirst({
        where: { topicId: topic.id },
        orderBy: { version: 'desc' },
        select: { id: true },
      }),
      this.prisma.idea.count({ where: { topicId: topic.id, status: { not: 'REJECTED' } } }),
      this.prisma.content.count({ where: { topicId: topic.id } }),
      this.prisma.content.count({
        where: { topicId: topic.id, status: { in: ['IN_REVIEW', 'APPROVED'] } },
      }),
      this.prisma.content.count({ where: { topicId: topic.id, status: 'APPROVED' } }),
      this.prisma.content.findFirst({
        where: { topicId: topic.id },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      }),
      this.prisma.content.findFirst({
        where: { topicId: topic.id, status: { in: ['DRAFT', 'IN_REVIEW', 'GENERATING'] } },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      }),
    ]);

    const done: Record<WalkerStepKey, boolean> = {
      select_topic: true,
      describe_topic: topic.description.trim().length >= 30,
      principles: principles > 0,
      add_samples: samples > 0,
      analyze_samples: samples > 0 && analyzed === samples,
      build_profile: profiles > 0,
      approve_profile: !!topic.activeProfileId,
      ideate: ideas > 0,
      generate_content: contents > 0,
      review_content: reviewed > 0,
      approve_content: approved > 0,
    };
    const counts: Partial<Record<WalkerStepKey, [number, number]>> = {
      add_samples: [samples, 3],
      analyze_samples: [analyzed, samples],
      principles: [principles, 1],
    };
    // A step is blocked while a hard prerequisite is missing.
    const prerequisite: Partial<Record<WalkerStepKey, WalkerStepKey>> = {
      analyze_samples: 'add_samples',
      build_profile: 'analyze_samples',
      approve_profile: 'build_profile',
      review_content: 'generate_content',
      approve_content: 'generate_content',
    };
    const steps: WalkerStepProgress[] = STEP_KEYS.map((key) => {
      const pre = prerequisite[key];
      const c = counts[key];
      return {
        key,
        done: done[key],
        blocked: key === 'build_profile' ? analyzed === 0 : pre ? !done[pre] : false,
        ...(c ? { current: c[0], target: c[1] } : {}),
      };
    });
    const next = steps.find((s) => !s.done)?.key ?? null;
    return {
      topic: { id: topic.id, title: topic.title, activeProfileId: topic.activeProfileId },
      steps,
      nextStep: next,
      completed: next === null,
      refs: {
        latestContentId: latestContent?.id ?? null,
        reviewContentId: reviewContent?.id ?? latestContent?.id ?? null,
        latestProfileId: latestProfile?.id ?? null,
      },
    };
  }
}
