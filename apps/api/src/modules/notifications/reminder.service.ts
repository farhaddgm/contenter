import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotificationsService } from './notifications.service';

const TICK_MS = 5 * 60_000;
/** Contents planned further back than this are not reminded of; they are long overdue anyway. */
const REMIND_WITHIN_DAYS = 14;
const READ_NOTIFICATION_DAYS = 60;
const DELIVERY_LOG_DAYS = 30;
const BATCH = 200;

/**
 * Tells people that the planned time of an approved, unpublished content has come (once per
 * plan: moving the plan re-arms it), and tidies old notifications. Runs where the worker runs.
 */
@Injectable()
export class ContentReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ContentReminderService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    if (this.env.APP_ROLE === 'api' || this.env.NODE_ENV === 'test') return;
    const tick = () =>
      this.run().catch((err) => this.logger.warn(`reminder run failed: ${(err as Error).message}`));
    setTimeout(tick, 30_000).unref();
    this.timer = setInterval(tick, TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now: Date = new Date()): Promise<{ reminded: number }> {
    const reminded = await this.remindDue(now);
    await this.prune(now);
    return { reminded };
  }

  /** One CONTENT_DUE per content and plan; returns how many contents were reminded. */
  async remindDue(now: Date): Promise<number> {
    const since = new Date(now.getTime() - REMIND_WITHIN_DAYS * 86_400_000);
    const due = await this.prisma.content.findMany({
      where: {
        status: 'APPROVED',
        publishedAt: null,
        scheduledAt: { lte: now, gte: since },
      },
      orderBy: { scheduledAt: 'asc' },
      take: BATCH,
      select: {
        id: true,
        title: true,
        topicId: true,
        createdById: true,
        submittedById: true,
        scheduledAt: true,
        dueNotifiedFor: true,
      },
    });
    // already reminded for this very plan; a changed plan has a different time
    const fresh = due.filter(
      (c) => c.scheduledAt && c.dueNotifiedFor?.getTime() !== c.scheduledAt.getTime(),
    );
    for (const c of fresh) {
      // claim the plan first: if two workers race, only one gets the row
      const claimed = await this.prisma.content.updateMany({
        where: {
          id: c.id,
          OR: [{ dueNotifiedFor: null }, { dueNotifiedFor: { not: c.scheduledAt } }],
        },
        data: { dueNotifiedFor: c.scheduledAt },
      });
      if (claimed.count !== 1) continue;
      const approver = await this.prisma.contentReview.findFirst({
        where: { contentId: c.id, decision: 'APPROVED' },
        orderBy: { createdAt: 'desc' },
        select: { actorId: true },
      });
      const recipients = await this.notifications.participantsOf(c, [approver?.actorId ?? null]);
      await this.notifications.notify({
        event: 'CONTENT_DUE',
        // nobody known (e.g. the author was deleted): the admins hear about it
        recipients: recipients.length ? recipients : await this.notifications.admins(),
        content: { id: c.id, title: c.title, topicId: c.topicId },
        when: c.scheduledAt!,
      });
    }
    return fresh.length;
  }

  private async prune(now: Date) {
    const day = 86_400_000;
    const [read, deliveries] = await Promise.all([
      this.prisma.notification.deleteMany({
        where: {
          readAt: { not: null, lt: new Date(now.getTime() - READ_NOTIFICATION_DAYS * day) },
        },
      }),
      this.prisma.notificationDelivery.deleteMany({
        where: { createdAt: { lt: new Date(now.getTime() - DELIVERY_LOG_DAYS * day) } },
      }),
    ]);
    if (read.count || deliveries.count) {
      this.logger.log(
        `pruned ${read.count} read notifications and ${deliveries.count} delivery logs`,
      );
    }
  }
}
