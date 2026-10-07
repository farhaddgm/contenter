import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_DEFAULTS,
  NOTIFICATION_NOTE_CHARS,
  NotificationEvent,
  NotificationListQuerySchema,
  NotificationSettingsSchema,
  SetNotificationPreferenceSchema,
  notificationMessage,
} from './notifications';

describe('notificationMessage', () => {
  const params = { actorName: 'سارا', contentTitle: 'سه اشتباه رایج', note: 'لحن را رسمی‌تر کنید' };

  it('says who did what to which content, in Persian by default', () => {
    expect(notificationMessage('REVIEW_SUBMITTED', params).title).toBe(
      'سارا محتوای «سه اشتباه رایج» را برای بازبینی فرستاد',
    );
    expect(notificationMessage('REVIEW_CHANGES_REQUESTED', params).title).toContain('اصلاح خواست');
    expect(notificationMessage('REVIEW_REJECTED', params).title).toContain('رد کرد');
    expect(notificationMessage('COMMENT_REPLIED', params).title).toContain('پاسخ داد');
  });

  it('says it in English too', () => {
    expect(notificationMessage('REVIEW_APPROVED', params, 'en').title).toBe(
      'سارا approved “سه اشتباه رایج”',
    );
    expect(notificationMessage('CONTENT_DUE', params, 'en').title).toBe(
      'It is time to publish “سه اشتباه رایج”',
    );
  });

  it('writes a title for every event, in both languages', () => {
    for (const event of NotificationEvent) {
      for (const lang of ['fa', 'en'] as const) {
        const { title } = notificationMessage(event, params, lang);
        expect(title).toContain('سه اشتباه رایج');
        expect(title.length).toBeGreaterThan(10);
      }
    }
  });

  it('carries the reason or the comment as the body', () => {
    expect(notificationMessage('REVIEW_CHANGES_REQUESTED', params).body).toBe(
      'لحن را رسمی‌تر کنید',
    );
    expect(notificationMessage('COMMENT_ADDED', { ...params, note: 'قلاب\n\nضعیف است' }).body).toBe(
      'قلاب ضعیف است',
    );
  });

  it('shortens a long note', () => {
    const body = notificationMessage('COMMENT_ADDED', { ...params, note: 'ا'.repeat(1000) }).body;
    expect(body).toHaveLength(NOTIFICATION_NOTE_CHARS);
    expect(body.endsWith('…')).toBe(true);
  });

  it('copes with a missing actor or title', () => {
    expect(notificationMessage('REVIEW_SUBMITTED', {}).title).toBe(
      'کسی محتوای «بدون عنوان» را برای بازبینی فرستاد',
    );
    expect(notificationMessage('REVIEW_SUBMITTED', {}, 'en').title).toBe(
      'Someone submitted “Untitled” for review',
    );
  });

  it('names the planned time of a due content in the Persian calendar and Tehran time', () => {
    const { body } = notificationMessage('CONTENT_DUE', {
      contentTitle: 'x',
      when: '2026-10-10T09:00:00.000Z',
    });
    expect(body).toContain('مهر');
    expect(body).toContain('۱۴۰۵');
    // 09:00 UTC is 12:30 in Tehran
    expect(body).toContain('۱۲:۳۰');
  });

  it('formats the English time in the time zone it is given', () => {
    const { body } = notificationMessage(
      'CONTENT_DUE',
      { contentTitle: 'x', when: '2026-10-10T09:00:00.000Z' },
      'en',
      'UTC',
    );
    expect(body).toContain('Oct 10, 2026');
    expect(body).toContain('9:00');
  });
});

describe('defaults', () => {
  it('cover every event, with comments in the app only', () => {
    expect(Object.keys(NOTIFICATION_DEFAULTS).sort()).toEqual([...NotificationEvent].sort());
    expect(NOTIFICATION_DEFAULTS.COMMENT_ADDED).toEqual({ inApp: true, email: false });
    expect(NOTIFICATION_DEFAULTS.REVIEW_CHANGES_REQUESTED).toEqual({ inApp: true, email: true });
    expect(Object.values(NOTIFICATION_DEFAULTS).every((d) => d.inApp)).toBe(true);
  });
});

describe('schemas', () => {
  it('reads the unread flag of the list from a query string', () => {
    expect(NotificationListQuerySchema.parse({ unread: 'true', page: '2' })).toMatchObject({
      unread: true,
      page: 2,
    });
    expect(NotificationListQuerySchema.parse({}).unread).toBe(false);
    expect(NotificationListQuerySchema.safeParse({ unread: 'maybe' }).success).toBe(false);
  });

  it('takes a partial preference', () => {
    expect(SetNotificationPreferenceSchema.parse({ email: false })).toEqual({ email: false });
    expect(SetNotificationPreferenceSchema.safeParse({ email: 'yes' }).success).toBe(false);
  });

  it('wants an http(s) webhook, a long enough secret, and known events', () => {
    const ok = {
      webhookUrl: 'https://hooks.example.com/contenter',
      webhookSecret: 'a-sufficiently-long-secret',
      webhookEvents: ['REVIEW_APPROVED'],
    };
    expect(NotificationSettingsSchema.safeParse(ok).success).toBe(true);
    expect(
      NotificationSettingsSchema.safeParse({ ...ok, webhookUrl: 'ftp://x.test' }).success,
    ).toBe(false);
    expect(NotificationSettingsSchema.safeParse({ ...ok, webhookSecret: 'short' }).success).toBe(
      false,
    );
    expect(NotificationSettingsSchema.safeParse({ ...ok, webhookEvents: ['NOPE'] }).success).toBe(
      false,
    );
  });

  it('switches the webhook off with a null url and keeps or clears the secret', () => {
    expect(
      NotificationSettingsSchema.safeParse({ webhookUrl: null, webhookEvents: [] }).success,
    ).toBe(true);
    // omitted = keep, null = remove
    const keep = NotificationSettingsSchema.parse({ webhookUrl: null, webhookEvents: [] });
    expect('webhookSecret' in keep).toBe(false);
    const remove = NotificationSettingsSchema.parse({
      webhookUrl: null,
      webhookEvents: [],
      webhookSecret: null,
    });
    expect(remove.webhookSecret).toBeNull();
  });
});
