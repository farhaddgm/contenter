import { Body, Controller, Get, Injectable, Logger, Put } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  AiJobType,
  BudgetSettingsSchema,
  budgetLevel,
  DEFAULT_BUDGET,
  monthKey,
  monthRange,
  type BudgetResponse,
  type BudgetSettings,
  type BudgetUsage,
} from '@contenter/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth.decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';
import { BusinessApi } from '../businesses/business-api';
import { AiAlertsService } from './ai-alerts.service';

const SETTINGS_KEY = 'budget';
const STATE_KEY = 'budgetState';
const ALERT_COOLDOWN_MS = 40 * 24 * 60 * 60 * 1000;

interface BudgetState {
  /** `monthKey` the sent alerts belong to; a new month starts empty. */
  month: string;
  /** Alert tags already sent this month, e.g. `global:warning`, `biz:<id>:exceeded`. */
  sent: string[];
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;
const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * Monthly AI budget (docs/60-reliability-and-cost.md): one cap for everything and optional caps
 * per business. By default it only warns the admins; with `hardStop` a job asked after the cap
 * is used up is not run. Spending = `costUsd` of the jobs that finished in the month.
 */
@Injectable()
export class BudgetService {
  private readonly logger = new Logger(BudgetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly alerts: AiAlertsService,
    private readonly businesses: BusinessApi,
  ) {}

  async getSettings(): Promise<BudgetSettings> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: SETTINGS_KEY } });
    const parsed = BudgetSettingsSchema.partial().safeParse(row?.value);
    return { ...DEFAULT_BUDGET, ...(parsed.success ? parsed.data : {}) };
  }

  async update(input: BudgetSettings, userId: string): Promise<BudgetResponse> {
    const value = BudgetSettingsSchema.parse(input);
    await this.prisma.systemSetting.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value: value as unknown as Prisma.InputJsonValue },
      update: { value: value as unknown as Prisma.InputJsonValue },
    });
    this.audit.log({
      userId,
      action: 'settings.update',
      entityType: 'SystemSetting',
      entityId: SETTINGS_KEY,
      meta: value as unknown as Record<string, unknown>,
    });
    return this.response();
  }

  async response(now = new Date()): Promise<BudgetResponse> {
    const settings = await this.getSettings();
    return { settings, usage: await this.usage(settings, now) };
  }

  /** What was spent this month, in total, per task type and per business. */
  async usage(settings?: BudgetSettings, now = new Date()): Promise<BudgetUsage> {
    const s = settings ?? (await this.getSettings());
    const { from, to, label } = monthRange(now, s.calendar);
    const jobs = await this.prisma.aiJob.findMany({
      where: { status: 'SUCCEEDED', finishedAt: { gte: from, lt: to } },
      select: { type: true, topicId: true, targetType: true, targetId: true, costUsd: true },
    });

    const topicIds = [...new Set(jobs.map((j) => j.topicId).filter((x): x is string => !!x))];
    const topics = topicIds.length
      ? await this.prisma.topic.findMany({
          where: { id: { in: topicIds } },
          select: { id: true, businessId: true },
        })
      : [];
    const businessOfTopic = new Map(topics.map((t) => [t.id, t.businessId]));

    const byTask = new Map<string, { usd: number; jobs: number }>();
    const byBusiness = new Map<string, { usd: number; jobs: number }>();
    let spent = 0;
    for (const j of jobs) {
      spent += j.costUsd;
      const t = byTask.get(j.type) ?? { usd: 0, jobs: 0 };
      byTask.set(j.type, { usd: t.usd + j.costUsd, jobs: t.jobs + 1 });
      const businessId =
        (j.topicId ? businessOfTopic.get(j.topicId) : null) ??
        (j.targetType === 'Business' ? j.targetId : null);
      if (businessId) {
        const b = byBusiness.get(businessId) ?? { usd: 0, jobs: 0 };
        byBusiness.set(businessId, { usd: b.usd + j.costUsd, jobs: b.jobs + 1 });
      }
    }

    // a business with a cap is listed even before it has spent anything
    const ids = [...new Set([...byBusiness.keys(), ...Object.keys(s.businesses)])];
    const names = await this.businesses.names(ids);

    const cap = s.monthlyUsd;
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      label,
      spentUsd: round(spent),
      capUsd: cap,
      percent: cap && cap > 0 ? round(spent / cap) : null,
      level: budgetLevel(spent, cap, s.warnPercent),
      byTask: [...byTask.entries()]
        .filter(([type]) => (AiJobType as readonly string[]).includes(type))
        .map(([type, v]) => ({ type: type as AiJobType, usd: round(v.usd), jobs: v.jobs }))
        .sort((a, b) => b.usd - a.usd),
      byBusiness: ids
        .filter((id) => names.has(id))
        .map((id) => {
          const v = byBusiness.get(id) ?? { usd: 0, jobs: 0 };
          const bCap = s.businesses[id] ?? null;
          return {
            businessId: id,
            name: names.get(id)!,
            usd: round(v.usd),
            jobs: v.jobs,
            capUsd: bCap,
            percent: bCap && bCap > 0 ? round(v.usd / bCap) : null,
            level: budgetLevel(v.usd, bCap, s.warnPercent),
          };
        })
        .sort((a, b) => b.usd - a.usd),
    };
  }

  /**
   * Why a job about to be queued must not run, or null. Only with `hardStop`; checks the whole
   * budget first, then the cap of the business the job belongs to.
   */
  async blockReason(
    args: { topicId?: string | null; targetType: string; targetId: string },
    now = new Date(),
  ): Promise<string | null> {
    const s = await this.getSettings();
    if (!s.hardStop) return null;
    const usage = await this.usage(s, now);
    if (usage.level === 'exceeded') {
      return `The monthly AI budget is used up (${money(usage.spentUsd)} of ${money(usage.capUsd ?? 0)}, month ${usage.label}). Raise the cap in Settings to continue.`;
    }
    let businessId: string | null = args.targetType === 'Business' ? args.targetId : null;
    if (!businessId && args.topicId) {
      businessId =
        (
          await this.prisma.topic.findUnique({
            where: { id: args.topicId },
            select: { businessId: true },
          })
        )?.businessId ?? null;
    }
    const line = businessId ? usage.byBusiness.find((b) => b.businessId === businessId) : undefined;
    if (line && line.level === 'exceeded') {
      return `The monthly AI cap of the business “${line.name}” is used up (${money(line.usd)} of ${money(line.capUsd ?? 0)}). Raise it in Settings to continue.`;
    }
    return null;
  }

  /**
   * Called after a job finishes: warns the admins once per month when the budget (or a
   * business's) reaches the warning level and once more when it is used up. Never throws.
   */
  async check(now = new Date()): Promise<void> {
    try {
      const s = await this.getSettings();
      if (s.monthlyUsd === null && !Object.keys(s.businesses).length) return;
      const usage = await this.usage(s, now);
      const month = monthKey(now, s.calendar);
      const state = await this.state(month);

      const lines: { tag: string; level: string; text: string }[] = [];
      if (usage.level === 'warning' || usage.level === 'exceeded') {
        lines.push({
          tag: 'global',
          level: usage.level,
          text: `${money(usage.spentUsd)} / ${money(usage.capUsd ?? 0)} (${Math.round((usage.percent ?? 0) * 100)}%) · ${usage.label}`,
        });
      }
      for (const b of usage.byBusiness) {
        if (b.level === 'warning' || b.level === 'exceeded') {
          lines.push({
            tag: `biz:${b.businessId}`,
            level: b.level,
            text: `${b.name}: ${money(b.usd)} / ${money(b.capUsd ?? 0)} · ${usage.label}`,
          });
        }
      }
      for (const l of lines) {
        // a used-up budget also counts as warned
        const wanted = l.level === 'exceeded' ? ['warning', 'exceeded'] : ['warning'];
        for (const level of wanted) {
          const tag = `${l.tag}:${level}`;
          if (state.sent.includes(tag)) continue;
          // the warning of a budget that jumped straight past the cap is not worth a second message
          if (level === 'warning' && l.level === 'exceeded') {
            state.sent.push(tag);
            continue;
          }
          await this.alerts.send(
            `${tag}:${month}`,
            level === 'exceeded' ? 'AI_BUDGET_EXCEEDED' : 'AI_BUDGET_WARNING',
            l.text,
            ALERT_COOLDOWN_MS,
          );
          state.sent.push(tag);
        }
      }
      await this.saveState(state);
    } catch (err) {
      this.logger.warn(`budget check failed: ${(err as Error).message}`);
    }
  }

  private async state(month: string): Promise<BudgetState> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: STATE_KEY } });
    const v = row?.value as Partial<BudgetState> | undefined;
    return v?.month === month && Array.isArray(v.sent)
      ? { month, sent: [...v.sent] }
      : { month, sent: [] };
  }

  private async saveState(state: BudgetState) {
    await this.prisma.systemSetting.upsert({
      where: { key: STATE_KEY },
      create: { key: STATE_KEY, value: state as unknown as Prisma.InputJsonValue },
      update: { value: state as unknown as Prisma.InputJsonValue },
    });
  }
}

@Controller('admin/settings/budget')
@Roles('ADMIN')
export class BudgetController {
  constructor(private readonly budget: BudgetService) {}

  @Get()
  get(): Promise<BudgetResponse> {
    return this.budget.response();
  }

  @Put()
  update(
    @Body(new ZodValidationPipe(BudgetSettingsSchema)) body: BudgetSettings,
    @CurrentUser() user: AuthUser,
  ) {
    return this.budget.update(body, user.id);
  }
}
