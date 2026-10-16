import { Injectable } from '@nestjs/common';
import type { NotificationEvent } from '@contenter/shared';
import { NotificationsService } from '../notifications/notifications.service';

/** One alert of the same kind per this long, so a long outage does not flood the admins. */
export const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/**
 * Tells the admins about AI trouble (fallback in use, budget used up). Throttled in memory per
 * kind: after a restart the first alert may repeat, which is acceptable. Never throws — an alert
 * must not fail the job that caused it.
 */
@Injectable()
export class AiAlertsService {
  private readonly last = new Map<string, number>();

  constructor(private readonly notifications: NotificationsService) {}

  /** Sends `event` to all admins unless the same `key` was sent within the cooldown. */
  async send(
    key: string,
    event: NotificationEvent,
    note: string,
    cooldownMs = ALERT_COOLDOWN_MS,
    now = Date.now(),
  ): Promise<boolean> {
    const before = this.last.get(key);
    if (before !== undefined && now - before < cooldownMs) return false;
    this.last.set(key, now);
    try {
      await this.notifications.notify({
        event,
        recipients: await this.notifications.admins(),
        note,
      });
      return true;
    } catch {
      return false;
    }
  }
}
