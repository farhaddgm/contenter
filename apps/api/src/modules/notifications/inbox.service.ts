import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  NOTIFICATION_DEFAULTS,
  NotificationEvent,
  notificationMessage,
  type Notification,
  type NotificationDelivery,
  type NotificationListQuerySchema,
  type NotificationParams,
  type NotificationPreferences,
  type SetNotificationPreferenceInput,
  type WebhookPayload,
} from '@contenter/shared';
import type { z } from 'zod';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { paginate, toPage } from '../../common/pagination';
import type { AuthUser } from '../../common/auth.decorators';
import { MailerService } from './mailer.service';
import { NotificationSettingsService } from './notification-settings.service';
import { hostOf } from './notifications.service';
import { WebhookService } from './webhook.service';

type ListQuery = z.infer<typeof NotificationListQuerySchema>;

export interface TestResult {
  email: 'sent' | 'skipped' | { error: string };
  webhook: 'sent' | 'skipped' | { error: string };
}

/** What a user does with their own notifications, and what an admin does to test the channels. */
@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly webhooks: WebhookService,
    private readonly settings: NotificationSettingsService,
  ) {}

  async list(userId: string, query: ListQuery) {
    const where = { userId, ...(query.unread ? { readAt: null } : {}) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...paginate(query),
      }),
      this.prisma.notification.count({ where }),
    ]);
    const items: Notification[] = rows.map((n) => ({
      id: n.id,
      event: n.event,
      contentId: n.contentId,
      params: n.params as unknown as NotificationParams,
      link: n.link,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    }));
    return toPage(items, total, query);
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    return { count: await this.prisma.notification.count({ where: { userId, readAt: null } }) };
  }

  /** Only the owner can mark a notification read; someone else's is "not found". */
  async markRead(userId: string, id: string): Promise<void> {
    const own = await this.prisma.notification.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!own) throw new NotFoundException('Notification not found');
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const r = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: r.count };
  }

  async preferences(userId: string): Promise<NotificationPreferences> {
    const rows = await this.prisma.notificationPreference.findMany({ where: { userId } });
    return {
      emailAvailable: this.mailer.enabled,
      preferences: NotificationEvent.map((event) => {
        const row = rows.find((r) => r.event === event);
        const d = NOTIFICATION_DEFAULTS[event];
        return { event, inApp: row?.inApp ?? d.inApp, email: row?.email ?? d.email };
      }),
    };
  }

  /** Changes one event's channels; what is not sent keeps its current value. */
  async setPreference(
    userId: string,
    event: NotificationEvent,
    patch: SetNotificationPreferenceInput,
  ): Promise<NotificationPreferences> {
    const current = (await this.preferences(userId)).preferences.find((p) => p.event === event)!;
    const next = { inApp: patch.inApp ?? current.inApp, email: patch.email ?? current.email };
    await this.prisma.notificationPreference.upsert({
      where: { userId_event: { userId, event } },
      create: { userId, event, ...next },
      update: next,
    });
    return this.preferences(userId);
  }

  async deliveries(query: { page: number; pageSize: number }) {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notificationDelivery.findMany({
        orderBy: { createdAt: 'desc' },
        ...paginate(query),
      }),
      this.prisma.notificationDelivery.count(),
    ]);
    const items: NotificationDelivery[] = rows.map((d) => ({
      ...d,
      createdAt: d.createdAt.toISOString(),
    }));
    return toPage(items, total, query);
  }

  /**
   * Sends one test message through each configured channel and reports what happened, so an
   * admin can check the SMTP server and the webhook without waiting for a real event.
   */
  async sendTest(user: AuthUser): Promise<TestResult> {
    const message = notificationMessage(
      'REVIEW_APPROVED',
      { actorName: 'Contenter', contentTitle: 'پیام آزمایشی' },
      'fa',
    );
    const result: TestResult = { email: 'skipped', webhook: 'skipped' };

    if (this.mailer.enabled) {
      try {
        await this.mailer.send({
          to: user.email,
          subject: `[آزمایشی] ${message.title}`,
          text: 'این یک پیام آزمایشی از Contenter است. اگر آن را می‌بینید، ایمیل درست تنظیم شده است.',
        });
        result.email = 'sent';
      } catch (err) {
        result.email = { error: (err as Error).message };
      }
    }

    const hook = await this.settings.webhook();
    if (hook) {
      const payload: WebhookPayload = {
        id: randomUUID(),
        event: 'REVIEW_APPROVED',
        occurredAt: new Date().toISOString(),
        title: `[آزمایشی] ${message.title}`,
        body: '',
        actor: null,
        content: null,
        url: null,
        recipientCount: 0,
        test: true,
      };
      try {
        await this.webhooks.post(hook.url, hook.secret, payload);
        result.webhook = 'sent';
      } catch (err) {
        result.webhook = { error: `${hostOf(hook.url)}: ${(err as Error).message}` };
      }
    }
    return result;
  }
}
