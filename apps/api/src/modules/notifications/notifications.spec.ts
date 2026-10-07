import { createHmac } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { Reflector } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebhookPayload } from '@contenter/shared';
import type { Env } from '../../config/env';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { RolesGuard } from '../../common/guards';
import { InboxService } from './inbox.service';
import { MailerService } from './mailer.service';
import { NotificationSettingsService } from './notification-settings.service';
import { NotificationsService, hostOf } from './notifications.service';
import { NotificationAdminController, NotificationsController } from './notifications.module';
import { ContentReminderService } from './reminder.service';
import { signWebhook, WebhookService } from './webhook.service';

const env = (over: Partial<Env> = {}) =>
  ({
    APP_URL: 'https://app.test',
    MAIL_FROM: 'Contenter <no-reply@app.test>',
    JWT_REFRESH_SECRET: 'refresh-secret-for-tests-only',
    APP_ROLE: 'all',
    NODE_ENV: 'test',
    ...over,
  }) as Env;

describe('signWebhook', () => {
  it('is the HMAC-SHA256 of "<timestamp>.<body>" in hex', () => {
    const expected = createHmac('sha256', 'secret').update('1700000000.{"a":1}').digest('hex');
    expect(signWebhook('secret', '1700000000', '{"a":1}')).toBe(expected);
  });

  it('changes with the timestamp, so a captured request cannot be replayed later', () => {
    expect(signWebhook('s', '1', 'body')).not.toBe(signWebhook('s', '2', 'body'));
  });
});

describe('WebhookService', () => {
  const payload: WebhookPayload = {
    id: 'd1',
    event: 'REVIEW_APPROVED',
    occurredAt: '2026-10-10T09:00:00.000Z',
    title: 't',
    body: '',
    actor: null,
    content: null,
    url: null,
    recipientCount: 1,
  };

  afterEach(() => vi.unstubAllGlobals());

  const stubFetch = (res: { ok: boolean; status: number }) => {
    const fetchMock = vi.fn(async () => ({ ...res, body: { cancel: async () => undefined } }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('posts the payload with a signature the receiver can verify', async () => {
    const fetchMock = stubFetch({ ok: true, status: 200 });
    await new WebhookService().post('https://hooks.test/x', 'topsecret', payload);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('https://hooks.test/x');
    expect(init.method).toBe('POST');
    // a moved webhook is an error, not something to chase
    expect(init.redirect).toBe('manual');
    const h = init.headers as Record<string, string>;
    expect(h['X-Contenter-Event']).toBe('REVIEW_APPROVED');
    expect(h['X-Contenter-Delivery']).toBe('d1');
    expect(h['X-Contenter-Signature']).toBe(
      `sha256=${signWebhook('topsecret', h['X-Contenter-Timestamp']!, init.body as string)}`,
    );
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });

  it('sends no signature without a secret, and marks a test message', async () => {
    const fetchMock = stubFetch({ ok: true, status: 204 });
    await new WebhookService().post('https://hooks.test/x', null, { ...payload, test: true });
    const h = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(h['X-Contenter-Signature']).toBeUndefined();
    expect(h['X-Contenter-Event']).toBe('test');
  });

  it('fails on a non-2xx answer, including a redirect', async () => {
    stubFetch({ ok: false, status: 500 });
    await expect(new WebhookService().post('https://h.test', null, payload)).rejects.toThrow(
      'HTTP 500',
    );
    stubFetch({ ok: false, status: 302 });
    await expect(new WebhookService().post('https://h.test', null, payload)).rejects.toThrow(
      'HTTP 302',
    );
  });
});

describe('MailerService', () => {
  it('is off without SMTP_URL and refuses to send', async () => {
    const mailer = new MailerService(env());
    expect(mailer.enabled).toBe(false);
    await expect(mailer.send({ to: 'a@x.test', subject: 's', text: 't' })).rejects.toThrow(
      /not configured/,
    );
  });

  it('is on with SMTP_URL and sends from MAIL_FROM', async () => {
    const mailer = new MailerService(env({ SMTP_URL: 'smtp://localhost:2525' }));
    expect(mailer.enabled).toBe(true);
    // swap the SMTP connection for one that only builds the message
    const json = createTransport({ jsonTransport: true });
    (mailer as unknown as { transport: unknown }).transport = json;
    const spy = vi.spyOn(json, 'sendMail');
    await mailer.send({ to: 'a@x.test', subject: 'عنوان', text: 'متن' });
    expect(spy).toHaveBeenCalledWith({
      from: 'Contenter <no-reply@app.test>',
      to: 'a@x.test',
      subject: 'عنوان',
      text: 'متن',
    });
  });
});

// ───────────────────────── the notification service ─────────────────────────

interface Fakes {
  users?: { id: string; email: string; name?: string; role?: string; isActive?: boolean }[];
  prefs?: { userId: string; event: string; inApp: boolean; email: boolean }[];
  topic?: {
    createdById: string | null;
    members: { userId: string; access: 'VIEW' | 'EDIT' }[];
  } | null;
  mailEnabled?: boolean;
  mailFails?: boolean;
  webhook?: { url: string; secret: string | null; events: string[] } | null;
  webhookFails?: boolean;
  prismaThrows?: boolean;
}

function build(f: Fakes = {}) {
  const users = f.users ?? [];
  const createMany = vi.fn(async () => ({ count: 0 }));
  const deliveryCreate = vi.fn(async () => ({}));
  const prisma = {
    user: {
      findMany: vi.fn(async ({ where }: { where: { id?: { in: string[] }; role?: string } }) => {
        if (f.prismaThrows) throw new Error('db down');
        return users
          .filter((u) => u.isActive !== false)
          .filter((u) => !where.id || where.id.in.includes(u.id))
          .filter((u) => !where.role || u.role === where.role)
          .map((u) => ({ role: 'EDITOR', ...u }));
      }),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          users.find((u) => u.id === where.id) ?? null,
      ),
    },
    topic: {
      findUnique: vi.fn(async () =>
        f.topic === undefined ? { createdById: null, members: [] } : f.topic,
      ),
    },
    notificationPreference: { findMany: vi.fn(async () => f.prefs ?? []) },
    notification: { createMany },
    notificationDelivery: { create: deliveryCreate },
  };
  const mail = vi.fn(async () => {
    if (f.mailFails) throw new Error('smtp refused');
  });
  const mailer = { enabled: f.mailEnabled ?? false, send: mail } as unknown as MailerService;
  const post = vi.fn(async () => {
    if (f.webhookFails) throw new Error('HTTP 500');
  });
  const webhooks = { post } as unknown as WebhookService;
  const settings = {
    webhookFor: vi.fn(async (event: string) =>
      f.webhook && f.webhook.events.includes(event) ? f.webhook : null,
    ),
  } as unknown as NotificationSettingsService;
  const svc = new NotificationsService(
    prisma as unknown as PrismaService,
    mailer,
    webhooks,
    settings,
    env(),
  );
  // no waiting between retries in tests
  (svc as unknown as { retryDelays: number[] }).retryDelays = [0, 0];
  return { svc, prisma, createMany, deliveryCreate, mail, post };
}

const U = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  email: `${id}@x.test`,
  name: id.toUpperCase(),
  role: 'EDITOR',
  ...over,
});
const content = { id: 'c1', title: 'سه اشتباه', topicId: 't1' };

describe('NotificationsService.notify', () => {
  it('writes an in-app notification for every recipient except the actor, once each', async () => {
    const { svc, createMany } = build({ users: [U('a'), U('b'), U('c')] });
    await svc.notify({
      event: 'REVIEW_SUBMITTED',
      recipients: ['a', 'b', 'b', 'c'],
      actor: { id: 'a', name: 'سارا' },
      content,
    });
    const rows = (createMany.mock.calls[0]![0] as { data: { userId: string }[] }).data;
    expect(rows.map((r) => r.userId)).toEqual(['b', 'c']);
    expect(rows[0]).toMatchObject({
      event: 'REVIEW_SUBMITTED',
      contentId: 'c1',
      link: '/app/contents/c1',
      params: { contentTitle: 'سه اشتباه', actorName: 'سارا' },
    });
  });

  it('looks up the actor’s name when only the id is given', async () => {
    const { svc, createMany } = build({ users: [U('a', { name: 'رضا' }), U('b')] });
    await svc.notify({ event: 'REVIEW_APPROVED', recipients: ['b'], actor: { id: 'a' }, content });
    const row = (createMany.mock.calls[0]![0] as { data: { params: { actorName: string } }[] })
      .data[0]!;
    expect(row.params.actorName).toBe('رضا');
  });

  it('respects a user who switched the app notification off, and skips inactive users', async () => {
    const { svc, createMany } = build({
      users: [U('b'), U('c'), U('d', { isActive: false })],
      prefs: [{ userId: 'c', event: 'REVIEW_APPROVED', inApp: false, email: false }],
    });
    await svc.notify({ event: 'REVIEW_APPROVED', recipients: ['b', 'c', 'd'], content });
    const rows = (createMany.mock.calls[0]![0] as { data: { userId: string }[] }).data;
    expect(rows.map((r) => r.userId)).toEqual(['b']);
  });

  it('writes nothing for nobody', async () => {
    const { svc, createMany } = build({ users: [U('a')] });
    await svc.notify({ event: 'REVIEW_APPROVED', recipients: ['a'], actor: { id: 'a' }, content });
    expect(createMany).not.toHaveBeenCalled();
  });

  it('e-mails only the users who want it, when e-mail is configured, with a link', async () => {
    const { svc, mail, deliveryCreate } = build({
      users: [U('b'), U('c')],
      mailEnabled: true,
      // comments are in-app only by default; c switches e-mail on, b keeps the default
      prefs: [{ userId: 'c', event: 'COMMENT_ADDED', inApp: true, email: true }],
    });
    await svc.notify({
      event: 'COMMENT_ADDED',
      recipients: ['b', 'c'],
      actor: { id: 'z', name: 'سارا' },
      content,
      note: 'قلاب ضعیف است',
    });
    await svc.idle();
    expect(mail).toHaveBeenCalledTimes(1);
    expect(mail.mock.calls[0]![0]).toMatchObject({
      to: 'c@x.test',
      subject: 'سارا روی «سه اشتباه» نظر گذاشت',
    });
    expect((mail.mock.calls[0]![0] as { text: string }).text).toContain('قلاب ضعیف است');
    expect((mail.mock.calls[0]![0] as { text: string }).text).toContain(
      'https://app.test/app/contents/c1',
    );
    expect(deliveryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channel: 'EMAIL',
        status: 'SENT',
        target: 'c@x.test',
        attempts: 1,
      }),
    });
  });

  it('sends no e-mail when SMTP is not configured', async () => {
    const { svc, mail } = build({ users: [U('b')], mailEnabled: false });
    await svc.notify({ event: 'REVIEW_REJECTED', recipients: ['b'], content, note: 'x' });
    await svc.idle();
    expect(mail).not.toHaveBeenCalled();
  });

  it('retries a failing e-mail, then records the failure and never throws', async () => {
    const { svc, mail, deliveryCreate } = build({
      users: [U('b')],
      mailEnabled: true,
      mailFails: true,
    });
    await expect(
      svc.notify({ event: 'REVIEW_REJECTED', recipients: ['b'], content, note: 'x' }),
    ).resolves.toBeUndefined();
    await svc.idle();
    expect(mail).toHaveBeenCalledTimes(3);
    expect(deliveryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'FAILED', attempts: 3, error: 'smtp refused' }),
    });
  });

  it('calls the webhook once per event it wants, and logs only its host', async () => {
    const { svc, post, deliveryCreate } = build({
      users: [U('b'), U('c')],
      webhook: {
        url: 'https://hooks.test/secret-token/path',
        secret: 's3cret-s3cret-s3cret',
        events: ['REVIEW_APPROVED'],
      },
    });
    await svc.notify({
      event: 'REVIEW_APPROVED',
      recipients: ['b', 'c'],
      actor: { id: 'a', name: 'سارا' },
      content,
    });
    await svc.idle();
    expect(post).toHaveBeenCalledTimes(1);
    const [url, secret, payload] = post.mock.calls[0]! as unknown as [
      string,
      string,
      WebhookPayload,
    ];
    expect(url).toBe('https://hooks.test/secret-token/path');
    expect(secret).toBe('s3cret-s3cret-s3cret');
    expect(payload).toMatchObject({
      event: 'REVIEW_APPROVED',
      title: 'سارا محتوای «سه اشتباه» را تأیید کرد',
      actor: { id: 'a', name: 'سارا' },
      content,
      url: 'https://app.test/app/contents/c1',
      recipientCount: 2,
    });
    expect(payload.id).toMatch(/[0-9a-f-]{36}/);
    expect(deliveryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ channel: 'WEBHOOK', target: 'hooks.test', status: 'SENT' }),
    });
  });

  it('does not call the webhook for an event it did not ask for', async () => {
    const { svc, post } = build({
      users: [U('b')],
      webhook: { url: 'https://hooks.test/x', secret: null, events: ['CONTENT_DUE'] },
    });
    await svc.notify({ event: 'REVIEW_APPROVED', recipients: ['b'], content });
    await svc.idle();
    expect(post).not.toHaveBeenCalled();
  });

  it('calls the webhook even when nobody is a recipient, and retries it before giving up', async () => {
    const { svc, post, deliveryCreate } = build({
      webhook: { url: 'https://hooks.test/x', secret: null, events: ['REVIEW_SUBMITTED'] },
      webhookFails: true,
    });
    await svc.notify({ event: 'REVIEW_SUBMITTED', recipients: [], content });
    await svc.idle();
    expect(post).toHaveBeenCalledTimes(3);
    expect(deliveryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'FAILED', error: 'HTTP 500' }),
    });
  });

  it('swallows a database failure: a notification never breaks the action', async () => {
    const { svc } = build({ users: [U('b')], prismaThrows: true });
    await expect(
      svc.notify({ event: 'REVIEW_APPROVED', recipients: ['b'], content }),
    ).resolves.toBeUndefined();
  });
});

describe('who can be told', () => {
  const people = [
    U('admin', { role: 'ADMIN' }),
    U('creator', { role: 'EDITOR' }),
    U('editor', { role: 'EDITOR' }),
    U('viewer', { role: 'VIEWER' }),
    U('author', { role: 'VIEWER' }),
    U('outsider', { role: 'EDITOR' }),
    U('gone', { role: 'EDITOR', isActive: false }),
  ];
  const topic = {
    createdById: 'creator',
    members: [
      { userId: 'editor', access: 'EDIT' as const },
      { userId: 'viewer', access: 'VIEW' as const },
      { userId: 'author', access: 'EDIT' as const },
      { userId: 'gone', access: 'EDIT' as const },
    ],
  };

  it('lets an admin, the creator and members through, by the project-access rules', async () => {
    const { svc } = build({ users: people, topic });
    const view = (await svc.usersWithAccess('t1', 'VIEW')).map((u) => u.id).sort();
    expect(view).toEqual(['admin', 'author', 'creator', 'editor', 'viewer']);
    const edit = (await svc.usersWithAccess('t1', 'EDIT')).map((u) => u.id).sort();
    expect(edit).toEqual(['admin', 'author', 'creator', 'editor']);
  });

  it('lets an explicit VIEW grant override the creator default', async () => {
    const { svc } = build({
      users: people,
      topic: { createdById: 'creator', members: [{ userId: 'creator', access: 'VIEW' }] },
    });
    const edit = (await svc.usersWithAccess('t1', 'EDIT')).map((u) => u.id);
    expect(edit).not.toContain('creator');
    expect(edit).toContain('admin');
  });

  it('names as reviewers only admins and editors who may edit, not an author with the VIEWER role', async () => {
    const { svc } = build({ users: people, topic });
    expect((await svc.reviewersOf('t1')).sort()).toEqual(['admin', 'creator', 'editor']);
  });

  it('tells the authors of a content only while they can still see it', async () => {
    const { svc } = build({ users: people, topic });
    expect(
      (
        await svc.authorsOf({ topicId: 't1', createdById: 'outsider', submittedById: 'author' })
      ).sort(),
    ).toEqual(['author']);
  });

  it('finds the conversation around a content among those with access', async () => {
    const { svc } = build({ users: people, topic });
    const ids = await svc.participantsOf(
      { id: 'c1', topicId: 't1', createdById: 'creator', submittedById: null },
      ['viewer', 'outsider', null, 'viewer'],
    );
    expect(ids.sort()).toEqual(['creator', 'viewer']);
  });

  it('finds nobody for a missing topic or an empty candidate list', async () => {
    expect(await build({ users: people, topic: null }).svc.usersWithAccess('t1', 'VIEW')).toEqual(
      [],
    );
    expect(await build({ users: people, topic }).svc.usersWithAccess('t1', 'VIEW', [])).toEqual([]);
  });

  it('lists the active admins', async () => {
    const { svc } = build({ users: [...people, U('admin2', { role: 'ADMIN', isActive: false })] });
    expect(await svc.admins()).toEqual(['admin']);
  });
});

describe('hostOf', () => {
  it('keeps only the host: a webhook path may carry a token', () => {
    expect(hostOf('https://hooks.example.com/abc/secret?token=1')).toBe('hooks.example.com');
    expect(hostOf('not a url')).toBe('invalid-url');
  });
});

// ───────────────────────── settings ─────────────────────────

describe('NotificationSettingsService', () => {
  function make(mailEnabled = false) {
    let stored: unknown = null;
    const prisma = {
      systemSetting: {
        findUnique: async () => (stored ? { value: stored } : null),
        upsert: vi.fn(async ({ create }: { create: { value: unknown } }) => {
          stored = create.value;
        }),
      },
    };
    const log = vi.fn();
    const svc = new NotificationSettingsService(
      prisma as unknown as PrismaService,
      { log } as unknown as AuditService,
      { enabled: mailEnabled } as MailerService,
      env(),
    );
    return { svc, log, raw: () => stored as { webhookSecret: string | null } };
  }

  it('starts with the webhook off and reports whether e-mail is configured', async () => {
    expect(await make(true).svc.get()).toEqual({
      webhookUrl: null,
      hasWebhookSecret: false,
      webhookEvents: [],
      emailConfigured: true,
    });
  });

  it('stores the secret sealed, never returns it, and signs with the real one', async () => {
    const { svc, raw } = make();
    const saved = await svc.update(
      {
        webhookUrl: 'https://h.test/x',
        webhookSecret: 'a-sufficiently-long-secret',
        webhookEvents: ['REVIEW_APPROVED'],
      },
      'admin',
    );
    expect(saved).toMatchObject({ webhookUrl: 'https://h.test/x', hasWebhookSecret: true });
    expect(JSON.stringify(saved)).not.toContain('a-sufficiently-long-secret');
    expect(raw().webhookSecret).not.toContain('a-sufficiently-long-secret');
    expect(await svc.webhookFor('REVIEW_APPROVED')).toEqual({
      url: 'https://h.test/x',
      secret: 'a-sufficiently-long-secret',
      events: ['REVIEW_APPROVED'],
    });
  });

  it('keeps the secret when it is omitted and removes it with null', async () => {
    const { svc } = make();
    await svc.update(
      {
        webhookUrl: 'https://h.test/x',
        webhookSecret: 'a-sufficiently-long-secret',
        webhookEvents: [],
      },
      'a',
    );
    await svc.update({ webhookUrl: 'https://h.test/y', webhookEvents: ['CONTENT_DUE'] }, 'a');
    expect((await svc.get()).hasWebhookSecret).toBe(true);
    await svc.update(
      { webhookUrl: 'https://h.test/y', webhookSecret: null, webhookEvents: [] },
      'a',
    );
    expect((await svc.get()).hasWebhookSecret).toBe(false);
  });

  it('forgets the secret when the webhook is switched off', async () => {
    const { svc } = make();
    await svc.update(
      {
        webhookUrl: 'https://h.test/x',
        webhookSecret: 'a-sufficiently-long-secret',
        webhookEvents: [],
      },
      'a',
    );
    await svc.update({ webhookUrl: null, webhookEvents: [] }, 'a');
    expect(await svc.get()).toMatchObject({ webhookUrl: null, hasWebhookSecret: false });
    expect(await svc.webhook()).toBeNull();
  });

  it('gives a webhook only the events it chose', async () => {
    const { svc } = make();
    await svc.update(
      { webhookUrl: 'https://h.test/x', webhookEvents: ['CONTENT_DUE', 'CONTENT_DUE'] },
      'a',
    );
    expect(await svc.webhookFor('CONTENT_DUE')).not.toBeNull();
    expect(await svc.webhookFor('REVIEW_APPROVED')).toBeNull();
    expect((await svc.get()).webhookEvents).toEqual(['CONTENT_DUE']);
  });

  it('audits a change without the secret', async () => {
    const { svc, log } = make();
    await svc.update(
      {
        webhookUrl: 'https://h.test/x',
        webhookSecret: 'a-sufficiently-long-secret',
        webhookEvents: [],
      },
      'admin',
    );
    expect(log).toHaveBeenCalledTimes(1);
    const entry = log.mock.calls[0]![0] as { userId: string; meta: Record<string, unknown> };
    expect(entry.userId).toBe('admin');
    expect(entry.meta.webhookSecret).toBe('set');
    expect(JSON.stringify(entry)).not.toContain('a-sufficiently-long-secret');
  });
});

// ───────────────────────── the user's own inbox ─────────────────────────

describe('InboxService', () => {
  function make(over: Record<string, unknown> = {}) {
    const upsert = vi.fn(async () => ({}));
    const updateMany = vi.fn(async () => ({ count: 2 }));
    const prisma = {
      notification: {
        findMany: vi.fn(async () => [
          {
            id: 'n1',
            event: 'REVIEW_APPROVED',
            contentId: 'c1',
            params: { contentTitle: 'x' },
            link: '/app/contents/c1',
            readAt: null,
            createdAt: new Date('2026-10-10T09:00:00Z'),
          },
        ]),
        count: vi.fn(async () => 1),
        findFirst: vi.fn(async ({ where }: { where: { userId: string } }) =>
          where.userId === 'me' ? { id: 'n1' } : null,
        ),
        updateMany,
      },
      notificationPreference: {
        findMany: vi.fn(async () => over.prefs ?? []),
        upsert,
      },
      notificationDelivery: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
      $transaction: async (qs: Promise<unknown>[]) => Promise.all(qs),
    };
    const mail = vi.fn(async () => {
      if (over.mailFails) throw new Error('smtp refused');
    });
    const post = vi.fn(async () => {
      if (over.webhookFails) throw new Error('HTTP 500');
    });
    const svc = new InboxService(
      prisma as unknown as PrismaService,
      { enabled: over.mailEnabled ?? false, send: mail } as unknown as MailerService,
      { post } as unknown as WebhookService,
      {
        webhook: async () => (over.hook === undefined ? null : over.hook),
      } as unknown as NotificationSettingsService,
    );
    return { svc, prisma, upsert, updateMany, mail, post };
  }

  it('lists the user’s notifications newest first, only the unread when asked', async () => {
    const { svc, prisma } = make();
    const page = await svc.list('me', { page: 1, pageSize: 20, unread: true });
    expect(prisma.notification.findMany.mock.calls[0]![0]).toMatchObject({
      where: { userId: 'me', readAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(page.items[0]).toMatchObject({
      id: 'n1',
      createdAt: '2026-10-10T09:00:00.000Z',
      readAt: null,
    });
    expect(page.total).toBe(1);
  });

  it('counts the unread ones', async () => {
    expect(await make().svc.unreadCount('me')).toEqual({ count: 1 });
  });

  it('marks one of the user’s own read, but someone else’s is "not found"', async () => {
    const { svc, updateMany } = make();
    await svc.markRead('me', 'n1');
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'n1', userId: 'me', readAt: null },
      data: { readAt: expect.any(Date) },
    });
    await expect(svc.markRead('other', 'n1')).rejects.toThrow(NotFoundException);
  });

  it('marks everything read', async () => {
    expect(await make().svc.markAllRead('me')).toEqual({ updated: 2 });
  });

  it('merges the defaults with what the user chose', async () => {
    const { svc } = make({
      mailEnabled: true,
      prefs: [{ userId: 'me', event: 'REVIEW_APPROVED', inApp: false, email: false }],
    });
    const p = await svc.preferences('me');
    expect(p.emailAvailable).toBe(true);
    expect(p.preferences).toHaveLength(8);
    expect(p.preferences.find((x) => x.event === 'REVIEW_APPROVED')).toEqual({
      event: 'REVIEW_APPROVED',
      inApp: false,
      email: false,
    });
    expect(p.preferences.find((x) => x.event === 'COMMENT_ADDED')).toEqual({
      event: 'COMMENT_ADDED',
      inApp: true,
      email: false,
    });
  });

  it('changes one channel of one event and keeps the other as it was', async () => {
    const { svc, upsert } = make();
    await svc.setPreference('me', 'COMMENT_ADDED', { email: true });
    expect(upsert).toHaveBeenCalledWith({
      where: { userId_event: { userId: 'me', event: 'COMMENT_ADDED' } },
      create: { userId: 'me', event: 'COMMENT_ADDED', inApp: true, email: true },
      update: { inApp: true, email: true },
    });
  });

  describe('sendTest', () => {
    const admin = { id: 'a', email: 'admin@x.test', role: 'ADMIN' as const };

    it('skips channels that are not configured', async () => {
      expect(await make().svc.sendTest(admin)).toEqual({ email: 'skipped', webhook: 'skipped' });
    });

    it('sends to the admin’s own address and to the webhook, marked as a test', async () => {
      const { svc, mail, post } = make({
        mailEnabled: true,
        hook: { url: 'https://hooks.test/x', secret: 'k'.repeat(20), events: [] },
      });
      expect(await svc.sendTest(admin)).toEqual({ email: 'sent', webhook: 'sent' });
      expect(mail.mock.calls[0]![0]).toMatchObject({ to: 'admin@x.test' });
      expect((post.mock.calls[0]! as unknown[])[2]).toMatchObject({ test: true });
    });

    it('reports what went wrong per channel without throwing', async () => {
      const { svc } = make({
        mailEnabled: true,
        mailFails: true,
        webhookFails: true,
        hook: { url: 'https://hooks.test/secret-path', secret: null, events: [] },
      });
      expect(await svc.sendTest(admin)).toEqual({
        email: { error: 'smtp refused' },
        webhook: { error: 'hooks.test: HTTP 500' },
      });
    });
  });
});

// ───────────────────────── reminders ─────────────────────────

describe('ContentReminderService', () => {
  const NOW = new Date('2026-10-10T12:00:00Z');
  const planned = (id: string, at: string, notifiedFor: string | null = null) => ({
    id,
    title: `محتوا ${id}`,
    topicId: 't1',
    createdById: 'creator',
    submittedById: 'sub',
    scheduledAt: new Date(at),
    dueNotifiedFor: notifiedFor ? new Date(notifiedFor) : null,
  });

  function make(
    rows: ReturnType<typeof planned>[],
    opts: { claimLost?: boolean; participants?: string[] } = {},
  ) {
    const updateMany = vi.fn(async () => ({ count: opts.claimLost ? 0 : 1 }));
    const prisma = {
      content: { findMany: vi.fn(async () => rows), updateMany },
      contentReview: { findFirst: vi.fn(async () => ({ actorId: 'approver' })) },
      notification: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      notificationDelivery: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    };
    const notify = vi.fn(async () => undefined);
    const participantsOf = vi.fn(async () => opts.participants ?? ['creator', 'sub', 'approver']);
    const svc = new ContentReminderService(
      prisma as unknown as PrismaService,
      { notify, participantsOf, admins: async () => ['adm1'] } as never,
      env(),
    );
    return { svc, prisma, updateMany, notify, participantsOf };
  }

  it('looks at approved, unpublished contents whose plan has come, not older than two weeks', async () => {
    const { svc, prisma } = make([]);
    await svc.remindDue(NOW);
    const where = prisma.content.findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({ status: 'APPROVED', publishedAt: null });
    expect(where.scheduledAt.lte).toEqual(NOW);
    expect(where.scheduledAt.gte).toEqual(new Date('2026-09-26T12:00:00Z'));
  });

  it('reminds the creator, the submitter and the last approver once', async () => {
    const { svc, notify, participantsOf } = make([planned('c1', '2026-10-10T09:00:00Z')]);
    expect(await svc.remindDue(NOW)).toBe(1);
    expect(participantsOf).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }), [
      'approver',
    ]);
    expect(notify).toHaveBeenCalledWith({
      event: 'CONTENT_DUE',
      recipients: ['creator', 'sub', 'approver'],
      content: { id: 'c1', title: 'محتوا c1', topicId: 't1' },
      when: new Date('2026-10-10T09:00:00Z'),
    });
  });

  it('does not remind again for a plan it already reminded of, but does for a moved plan', async () => {
    const { svc, notify } = make([
      planned('same', '2026-10-10T09:00:00Z', '2026-10-10T09:00:00Z'),
      planned('moved', '2026-10-10T10:00:00Z', '2026-10-09T10:00:00Z'),
    ]);
    expect(await svc.remindDue(NOW)).toBe(1);
    expect(notify.mock.calls.map((c) => (c[0] as { content: { id: string } }).content.id)).toEqual([
      'moved',
    ]);
  });

  it('claims the plan before telling anyone, so two workers cannot both remind', async () => {
    const { svc, notify, updateMany } = make([planned('c1', '2026-10-10T09:00:00Z')], {
      claimLost: true,
    });
    await svc.remindDue(NOW);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('tells the admins when nobody else is known', async () => {
    const { svc, notify } = make([planned('c1', '2026-10-10T09:00:00Z')], { participants: [] });
    await svc.remindDue(NOW);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ recipients: ['adm1'] }));
  });

  it('tidies old read notifications and delivery logs on each run', async () => {
    const { svc, prisma } = make([]);
    await svc.run(NOW);
    const read = prisma.notification.deleteMany.mock.calls[0]![0].where.readAt;
    expect(read.lt).toEqual(new Date('2026-08-11T12:00:00Z'));
    expect(prisma.notificationDelivery.deleteMany.mock.calls[0]![0].where.createdAt.lt).toEqual(
      new Date('2026-09-10T12:00:00Z'),
    );
  });
});

describe('who may use the notification routes', () => {
  /** What RolesGuard decides for a role calling a method on one of the controllers. */
  const allowed = (
    controller: new (...a: never[]) => unknown,
    role: 'ADMIN' | 'EDITOR' | 'VIEWER',
    method: string,
  ) => {
    const guard = new RolesGuard(new Reflector());
    const ctx = {
      getHandler: () => () => undefined,
      getClass: () => controller,
      switchToHttp: () => ({ getRequest: () => ({ method, user: { id: 'u', email: 'e', role } }) }),
    };
    try {
      return guard.canActivate(ctx as never);
    } catch {
      return false;
    }
  };

  it('lets every role, even a VIEWER, read and change its own notifications and preferences', () => {
    for (const role of ['ADMIN', 'EDITOR', 'VIEWER'] as const) {
      for (const method of ['GET', 'POST', 'PUT']) {
        expect(allowed(NotificationsController as never, role, method)).toBe(true);
      }
    }
  });

  it('keeps the webhook and delivery log for admins', () => {
    expect(allowed(NotificationAdminController as never, 'ADMIN', 'PUT')).toBe(true);
    expect(allowed(NotificationAdminController as never, 'EDITOR', 'GET')).toBe(false);
    expect(allowed(NotificationAdminController as never, 'VIEWER', 'GET')).toBe(false);
  });
});
