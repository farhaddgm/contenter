/**
 * Notifications (docs/25-notifications.md): the events, who gets what by default, and the text of
 * each message. The text is built here, once, so the in-app list, the e-mail and the webhook all
 * say the same thing in the reader's language.
 */
import { z } from 'zod';
import { PaginationQuerySchema } from './schemas';

export const NotificationEvent = [
  'REVIEW_SUBMITTED',
  'REVIEW_FINAL_NEEDED',
  'REVIEW_APPROVED',
  'REVIEW_CHANGES_REQUESTED',
  'REVIEW_REJECTED',
  'COMMENT_ADDED',
  'COMMENT_REPLIED',
  'CONTENT_DUE',
] as const;
export type NotificationEvent = (typeof NotificationEvent)[number];

export const NotificationChannel = ['IN_APP', 'EMAIL', 'WEBHOOK'] as const;
export type NotificationChannel = (typeof NotificationChannel)[number];

/** What a user gets before changing anything: everything in the app, the decisive ones by e-mail. */
export const NOTIFICATION_DEFAULTS: Record<NotificationEvent, { inApp: boolean; email: boolean }> =
  {
    REVIEW_SUBMITTED: { inApp: true, email: true },
    REVIEW_FINAL_NEEDED: { inApp: true, email: true },
    REVIEW_APPROVED: { inApp: true, email: true },
    REVIEW_CHANGES_REQUESTED: { inApp: true, email: true },
    REVIEW_REJECTED: { inApp: true, email: true },
    COMMENT_ADDED: { inApp: true, email: false },
    COMMENT_REPLIED: { inApp: true, email: false },
    CONTENT_DUE: { inApp: true, email: true },
  };

/** The values a message is written from; stored with the notification. */
export interface NotificationParams {
  contentTitle?: string;
  actorName?: string;
  /** The reason of a decision, or the text of a comment (shortened). */
  note?: string;
  /** ISO time, for CONTENT_DUE. */
  when?: string;
}

export interface NotificationMessage {
  title: string;
  body: string;
}

type Lang = 'fa' | 'en';

/** Longest note kept in a message. */
export const NOTIFICATION_NOTE_CHARS = 280;

const shorten = (text: string | undefined, max = NOTIFICATION_NOTE_CHARS) => {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

function formatWhen(iso: string | undefined, lang: Lang, timeZone?: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timeZone ?? (lang === 'fa' ? 'Asia/Tehran' : undefined),
  }).format(new Date(iso));
}

const TEXT = {
  fa: {
    REVIEW_SUBMITTED: (a: string, c: string) => `${a} محتوای «${c}» را برای بازبینی فرستاد`,
    REVIEW_FINAL_NEEDED: (a: string, c: string) =>
      `${a} بازبینی «${c}» را تأیید کرد؛ منتظر تأیید نهایی است`,
    REVIEW_APPROVED: (a: string, c: string) => `${a} محتوای «${c}» را تأیید کرد`,
    REVIEW_CHANGES_REQUESTED: (a: string, c: string) => `${a} برای «${c}» اصلاح خواست`,
    REVIEW_REJECTED: (a: string, c: string) => `${a} محتوای «${c}» را رد کرد`,
    COMMENT_ADDED: (a: string, c: string) => `${a} روی «${c}» نظر گذاشت`,
    COMMENT_REPLIED: (a: string, c: string) => `${a} در «${c}» پاسخ داد`,
    CONTENT_DUE: (_a: string, c: string) => `زمان انتشار «${c}» رسید`,
    someone: 'کسی',
    untitled: 'بدون عنوان',
    plannedFor: (when: string) => `برنامه‌ریزی‌شده برای ${when}؛ هنوز منتشرشده ثبت نشده است.`,
  },
  en: {
    REVIEW_SUBMITTED: (a: string, c: string) => `${a} submitted “${c}” for review`,
    REVIEW_FINAL_NEEDED: (a: string, c: string) =>
      `${a} approved the review of “${c}”; it waits for the final approval`,
    REVIEW_APPROVED: (a: string, c: string) => `${a} approved “${c}”`,
    REVIEW_CHANGES_REQUESTED: (a: string, c: string) => `${a} asked for changes to “${c}”`,
    REVIEW_REJECTED: (a: string, c: string) => `${a} rejected “${c}”`,
    COMMENT_ADDED: (a: string, c: string) => `${a} commented on “${c}”`,
    COMMENT_REPLIED: (a: string, c: string) => `${a} replied in “${c}”`,
    CONTENT_DUE: (_a: string, c: string) => `It is time to publish “${c}”`,
    someone: 'Someone',
    untitled: 'Untitled',
    plannedFor: (when: string) => `Planned for ${when}; it is not marked published yet.`,
  },
} as const;

/** The title and the body of a notification, in the reader's language. */
export function notificationMessage(
  event: NotificationEvent,
  params: NotificationParams,
  lang: Lang = 'fa',
  timeZone?: string,
): NotificationMessage {
  const t = TEXT[lang];
  const title = t[event](params.actorName || t.someone, params.contentTitle || t.untitled);
  const body =
    event === 'CONTENT_DUE'
      ? t.plannedFor(formatWhen(params.when, lang, timeZone))
      : shorten(params.note);
  return { title, body };
}

// ---------- API shapes ----------

export const NotificationListQuerySchema = PaginationQuerySchema.extend({
  /** Only the ones not read yet. */
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const SetNotificationPreferenceSchema = z.object({
  inApp: z.boolean().optional(),
  email: z.boolean().optional(),
});
export type SetNotificationPreferenceInput = z.infer<typeof SetNotificationPreferenceSchema>;

export const WEBHOOK_SECRET_MIN = 16;

/**
 * The outgoing webhook of the whole system. `webhookSecret` is write-only: omit it to keep the
 * stored one, send `null` to remove it. An empty `webhookUrl` (null) switches the webhook off.
 */
export const NotificationSettingsSchema = z.object({
  webhookUrl: z
    .url({ protocol: /^https?$/ })
    .max(2000)
    .nullable(),
  webhookSecret: z.string().min(WEBHOOK_SECRET_MIN).max(200).nullable().optional(),
  webhookEvents: z.array(z.enum(NotificationEvent)).max(NotificationEvent.length),
});
export type NotificationSettingsInput = z.infer<typeof NotificationSettingsSchema>;

export interface Notification {
  id: string;
  event: NotificationEvent;
  contentId: string | null;
  params: NotificationParams;
  /** App path the notification leads to. */
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPreference {
  event: NotificationEvent;
  inApp: boolean;
  email: boolean;
}

export interface NotificationPreferences {
  /** The server can send e-mail (SMTP is configured). */
  emailAvailable: boolean;
  preferences: NotificationPreference[];
}

export interface NotificationSettings {
  webhookUrl: string | null;
  /** A secret is stored (it is never returned). */
  hasWebhookSecret: boolean;
  webhookEvents: NotificationEvent[];
  emailConfigured: boolean;
}

export interface NotificationDelivery {
  id: string;
  channel: 'EMAIL' | 'WEBHOOK';
  event: NotificationEvent;
  /** The address, or the host of the webhook. */
  target: string;
  status: 'SENT' | 'FAILED';
  error: string | null;
  attempts: number;
  createdAt: string;
}

/** The body POSTed to the webhook. */
export interface WebhookPayload {
  id: string;
  event: NotificationEvent;
  occurredAt: string;
  title: string;
  body: string;
  actor: { id: string; name: string } | null;
  content: { id: string; title: string; topicId: string } | null;
  /** Where in the app to look at it. */
  url: string | null;
  recipientCount: number;
  /** Set on the message of the "send a test" button; not a real event. */
  test?: boolean;
}
