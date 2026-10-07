import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  NotificationEvent,
  type NotificationSettings,
  type NotificationSettingsInput,
} from '@contenter/shared';
import { ENV, type Env } from '../../config/env';
import { SecretBox } from '../../common/secret-box';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailerService } from './mailer.service';

const KEY = 'notifications';

interface Stored {
  webhookUrl: string | null;
  /** Sealed with SecretBox; never leaves the server. */
  webhookSecret: string | null;
  webhookEvents: NotificationEvent[];
}

/** What a webhook delivery needs: the address, the plain secret and which events it wants. */
export interface WebhookTarget {
  url: string;
  secret: string | null;
  events: NotificationEvent[];
}

/** The system-wide notification settings (the webhook) in `SystemSetting`. */
@Injectable()
export class NotificationSettingsService {
  private readonly box: SecretBox;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mailer: MailerService,
    @Inject(ENV) env: Env,
  ) {
    this.box = new SecretBox(env.DATA_ENCRYPTION_KEY ?? env.JWT_REFRESH_SECRET, 'notifications');
  }

  private async stored(): Promise<Stored> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: KEY } });
    const v = (row?.value ?? {}) as Partial<Stored>;
    const known = new Set<string>(NotificationEvent);
    return {
      webhookUrl: v.webhookUrl ?? null,
      webhookSecret: v.webhookSecret ?? null,
      webhookEvents: (v.webhookEvents ?? []).filter((e) => known.has(e)),
    };
  }

  /** The settings as the admin page shows them: no secret, only whether one is set. */
  async get(): Promise<NotificationSettings> {
    const s = await this.stored();
    return {
      webhookUrl: s.webhookUrl,
      hasWebhookSecret: !!s.webhookSecret,
      webhookEvents: s.webhookEvents,
      emailConfigured: this.mailer.enabled,
    };
  }

  /** The webhook to call for `event`, or null when none is set or it does not want this event. */
  async webhookFor(event: NotificationEvent): Promise<WebhookTarget | null> {
    const s = await this.stored();
    if (!s.webhookUrl || !s.webhookEvents.includes(event)) return null;
    return { url: s.webhookUrl, secret: this.open(s.webhookSecret), events: s.webhookEvents };
  }

  /** The webhook regardless of its events, for the "send a test" button. */
  async webhook(): Promise<WebhookTarget | null> {
    const s = await this.stored();
    return s.webhookUrl
      ? { url: s.webhookUrl, secret: this.open(s.webhookSecret), events: s.webhookEvents }
      : null;
  }

  async update(input: NotificationSettingsInput, userId: string): Promise<NotificationSettings> {
    const current = await this.stored();
    const next: Stored = {
      webhookUrl: input.webhookUrl,
      // omitted keeps the stored secret, null removes it
      webhookSecret:
        input.webhookSecret === undefined
          ? current.webhookSecret
          : input.webhookSecret === null
            ? null
            : this.box.seal(input.webhookSecret),
      webhookEvents: [...new Set(input.webhookEvents)],
    };
    // a webhook that is switched off keeps no secret around
    if (!next.webhookUrl) next.webhookSecret = null;
    await this.prisma.systemSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: next as unknown as Prisma.InputJsonValue },
      update: { value: next as unknown as Prisma.InputJsonValue },
    });
    this.audit.log({
      userId,
      action: 'settings.update',
      entityType: 'SystemSetting',
      entityId: KEY,
      meta: {
        webhookUrl: next.webhookUrl,
        webhookEvents: next.webhookEvents,
        webhookSecret: next.webhookSecret ? 'set' : 'none',
      },
    });
    return this.get();
  }

  private open(sealed: string | null): string | null {
    if (!sealed) return null;
    try {
      return this.box.open(sealed);
    } catch {
      // sealed with another key (the encryption key changed): treat it as no secret
      return null;
    }
  }
}
