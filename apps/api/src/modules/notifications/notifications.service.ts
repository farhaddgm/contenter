import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  NOTIFICATION_DEFAULTS,
  notificationMessage,
  type NotificationEvent,
  type NotificationParams,
  type WebhookPayload,
} from '@contenter/shared';
import { ENV, type Env } from '../../config/env';
import { accessOf } from '../../common/access';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MailerService } from './mailer.service';
import { NotificationSettingsService } from './notification-settings.service';
import { WebhookService } from './webhook.service';

export interface NotifyInput {
  event: NotificationEvent;
  /** User ids. The actor is removed and duplicates collapse. */
  recipients: string[];
  /** The name is looked up when only the id is given. */
  actor?: { id: string; name?: string } | null;
  content?: { id: string; title: string; topicId: string } | null;
  /** The reason of a decision, or the text of a comment. */
  note?: string;
  /** For CONTENT_DUE: the planned time. */
  when?: Date;
}

/** Waits between the attempts to deliver one e-mail or webhook. */
const RETRY_DELAYS_MS = [1_000, 5_000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Tells people about what happens to contents (docs/25-notifications.md). Code, not AI: the
 * recipients come from roles and access, the text from templates. Three channels — the in-app
 * list, e-mail (per user and event) and one system webhook. A failing channel never breaks the
 * action that caused the notification.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  /** Overridable by tests. */
  protected retryDelays = RETRY_DELAYS_MS;
  /** Background deliveries in flight; `idle()` waits for them. */
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly webhooks: WebhookService,
    private readonly settings: NotificationSettingsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Resolves when every e-mail and webhook started so far has finished (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  // ───────────────────────── who is told ─────────────────────────

  /**
   * The users of `candidates` (or all active users) who can reach the topic, at least to read it
   * (`level` VIEW) or to edit it (EDIT); the same rule as the topic routes (docs/17).
   */
  async usersWithAccess(
    topicId: string,
    level: 'VIEW' | 'EDIT',
    candidates?: string[],
  ): Promise<{ id: string; role: 'ADMIN' | 'EDITOR' | 'VIEWER' }[]> {
    if (candidates && !candidates.length) return [];
    const [topic, users] = await Promise.all([
      this.prisma.topic.findUnique({
        where: { id: topicId },
        select: { createdById: true, members: { select: { userId: true, access: true } } },
      }),
      this.prisma.user.findMany({
        where: { isActive: true, ...(candidates ? { id: { in: candidates } } : {}) },
        select: { id: true, role: true },
      }),
    ]);
    if (!topic) return [];
    return users.filter((u) => {
      const grant = topic.members.find((m) => m.userId === u.id)?.access;
      const access = accessOf(u, topic, grant);
      return access !== null && (level === 'VIEW' || access === 'EDIT');
    });
  }

  /** Whoever can review: admins and the editors who may edit the topic. */
  async reviewersOf(topicId: string): Promise<string[]> {
    const users = await this.usersWithAccess(topicId, 'EDIT');
    return users.filter((u) => u.role === 'ADMIN' || u.role === 'EDITOR').map((u) => u.id);
  }

  /** The active admins: the final approvers. */
  async admins(): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: { isActive: true, role: 'ADMIN' },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** The author side of a content (who made it, who sent it for review) who can still see it. */
  async authorsOf(content: {
    topicId: string;
    createdById: string | null;
    submittedById: string | null;
  }): Promise<string[]> {
    const ids = [content.createdById, content.submittedById].filter((x): x is string => !!x);
    return (await this.usersWithAccess(content.topicId, 'VIEW', ids)).map((u) => u.id);
  }

  /** Everyone in the conversation around a content who can still see it. */
  async participantsOf(
    content: {
      id: string;
      topicId: string;
      createdById: string | null;
      submittedById: string | null;
    },
    commenterIds: (string | null)[] = [],
  ): Promise<string[]> {
    const ids = [content.createdById, content.submittedById, ...commenterIds].filter(
      (x): x is string => !!x,
    );
    return (await this.usersWithAccess(content.topicId, 'VIEW', [...new Set(ids)])).map(
      (u) => u.id,
    );
  }

  // ───────────────────────── telling them ─────────────────────────

  /** Never throws: a notification is never worth failing the action that caused it. */
  async notify(input: NotifyInput): Promise<void> {
    try {
      await this.deliver(input);
    } catch (err) {
      this.logger.warn(`could not notify (${input.event}): ${(err as Error).message}`);
    }
  }

  private async deliver(input: NotifyInput): Promise<void> {
    const recipientIds = [...new Set(input.recipients)].filter((id) => id !== input.actor?.id);
    const actor = input.actor
      ? {
          id: input.actor.id,
          name:
            input.actor.name ??
            (
              await this.prisma.user.findUnique({
                where: { id: input.actor.id },
                select: { name: true },
              })
            )?.name ??
            '',
        }
      : null;
    const params: NotificationParams = {
      contentTitle: input.content?.title,
      actorName: actor?.name || undefined,
      note: input.note,
      when: input.when?.toISOString(),
    };
    const link = input.content ? `/app/contents/${input.content.id}` : null;
    const message = notificationMessage(input.event, params, 'fa');

    if (recipientIds.length) {
      const [users, prefs] = await Promise.all([
        this.prisma.user.findMany({
          where: { id: { in: recipientIds }, isActive: true },
          select: { id: true, email: true },
        }),
        this.prisma.notificationPreference.findMany({
          where: { userId: { in: recipientIds }, event: input.event },
        }),
      ]);
      const wants = (userId: string) => {
        const p = prefs.find((x) => x.userId === userId);
        const d = NOTIFICATION_DEFAULTS[input.event];
        return { inApp: p?.inApp ?? d.inApp, email: p?.email ?? d.email };
      };

      const inApp = users.filter((u) => wants(u.id).inApp);
      if (inApp.length) {
        await this.prisma.notification.createMany({
          data: inApp.map((u) => ({
            userId: u.id,
            event: input.event,
            contentId: input.content?.id ?? null,
            params: params as unknown as Prisma.InputJsonValue,
            link,
          })),
        });
      }

      if (this.mailer.enabled) {
        const text = [message.body, link ? `${this.env.APP_URL}${link}` : null]
          .filter(Boolean)
          .join('\n\n');
        for (const u of users.filter((x) => wants(x.id).email)) {
          this.background(async () => {
            const outcome = await this.withRetries(() =>
              this.mailer.send({ to: u.email, subject: message.title, text }),
            );
            await this.logDelivery('EMAIL', input.event, u.email, outcome);
          });
        }
      }
    }

    const hook = await this.settings.webhookFor(input.event);
    if (hook) {
      const payload: WebhookPayload = {
        id: randomUUID(),
        event: input.event,
        occurredAt: new Date().toISOString(),
        title: message.title,
        body: message.body,
        actor,
        content: input.content ?? null,
        url: link ? `${this.env.APP_URL}${link}` : null,
        recipientCount: recipientIds.length,
      };
      this.background(async () => {
        const outcome = await this.withRetries(() =>
          this.webhooks.post(hook.url, hook.secret, payload),
        );
        await this.logDelivery('WEBHOOK', input.event, hostOf(hook.url), outcome);
      });
    }
  }

  /** Runs a delivery without making the caller wait for it. */
  private background(work: () => Promise<void>): void {
    const p = work()
      .catch((err) => this.logger.warn(`delivery failed: ${(err as Error).message}`))
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  private async withRetries(
    run: () => Promise<void>,
  ): Promise<{ ok: boolean; attempts: number; error?: string }> {
    let attempts = 0;
    let error = '';
    for (const delay of [0, ...this.retryDelays]) {
      if (delay) await sleep(delay);
      attempts++;
      try {
        await run();
        return { ok: true, attempts };
      } catch (err) {
        error = (err as Error).message;
      }
    }
    return { ok: false, attempts, error };
  }

  private logDelivery(
    channel: 'EMAIL' | 'WEBHOOK',
    event: NotificationEvent,
    target: string,
    outcome: { ok: boolean; attempts: number; error?: string },
  ) {
    return this.prisma.notificationDelivery.create({
      data: {
        channel,
        event,
        target,
        status: outcome.ok ? 'SENT' : 'FAILED',
        error: outcome.error?.slice(0, 500) ?? null,
        attempts: outcome.attempts,
      },
    });
  }
}

/** Only the host is kept in the delivery log: a webhook URL may carry a token in its path. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid-url';
  }
}
