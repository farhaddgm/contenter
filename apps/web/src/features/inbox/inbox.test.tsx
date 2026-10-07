import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import type {
  Notification,
  NotificationPreferences,
  NotificationSettings,
} from '@contenter/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({
  unread: 0,
  list: [] as unknown[],
  markRead: vi.fn(),
  markAll: vi.fn(),
  listArgs: [] as unknown[],
  prefs: undefined as unknown,
  setPref: vi.fn(),
  settings: undefined as unknown,
  saveSettings: vi.fn(),
  sendTest: vi.fn(),
  deliveries: [] as unknown[],
}));

vi.mock('./api/inbox', () => ({
  useUnreadCount: () => ({ data: state.unread }),
  useNotificationList: (params: unknown, options: unknown) => {
    state.listArgs.push({ params, options });
    return {
      data: { items: state.list, total: state.list.length, page: 1, pageSize: 20, totalPages: 1 },
      isLoading: false,
    };
  },
  useMarkRead: () => ({ mutate: state.markRead, isPending: false }),
  useMarkAllRead: () => ({ mutate: state.markAll, isPending: false }),
  useNotificationPreferences: () => ({ data: state.prefs }),
  useSetNotificationPreference: () => ({ mutate: state.setPref, isPending: false }),
  useNotificationSettings: () => ({ data: state.settings }),
  useUpdateNotificationSettings: () => ({ mutate: state.saveSettings, isPending: false }),
  useSendNotificationTest: () => ({ mutate: state.sendTest, isPending: false }),
  useNotificationDeliveries: () => ({ data: { items: state.deliveries } }),
}));

import { NotificationBell } from './components/notification-bell';
import { NotificationPreferencesCard } from './components/preferences-card';
import { NotificationSettingsCard } from './components/settings-card';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

const note = (over: Partial<Notification> = {}): Notification => ({
  id: 'n1',
  event: 'REVIEW_CHANGES_REQUESTED',
  contentId: 'c1',
  params: { actorName: 'رضا', contentTitle: 'سه اشتباه', note: 'لحن را رسمی‌تر کنید' },
  link: '/app/contents/c1',
  readAt: null,
  createdAt: new Date().toISOString(),
  ...over,
});

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname}</output>;
}

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.unread = 0;
  state.list = [];
  state.listArgs = [];
  state.markRead = vi.fn();
  state.markAll = vi.fn();
  state.setPref = vi.fn();
  state.saveSettings = vi.fn();
  state.sendTest = vi.fn();
  state.deliveries = [];
});

describe('NotificationBell', () => {
  const renderBell = () =>
    render(
      <MemoryRouter>
        <NotificationBell />
        <Where />
      </MemoryRouter>,
    );

  it('shows no badge when everything is read, and the count when not', () => {
    const { unmount } = renderBell();
    expect(screen.getByRole('button', { name: t('inbox.title') })).toBeVisible();
    expect(screen.queryByText('۳')).toBeNull();
    unmount();
    state.unread = 3;
    renderBell();
    expect(
      screen.getByRole('button', { name: t('inbox.bellUnread', { count: '۳' }) }),
    ).toBeVisible();
    expect(screen.getByText('۳')).toBeVisible();
  });

  it('caps a long count', () => {
    state.unread = 250;
    renderBell();
    expect(screen.getByText('99+')).toBeVisible();
  });

  it('asks for the list only once it is opened', async () => {
    renderBell();
    expect((state.listArgs.at(-1) as { options: { enabled: boolean } }).options.enabled).toBe(
      false,
    );
    await userEvent.click(screen.getByRole('button', { name: t('inbox.title') }));
    expect((state.listArgs.at(-1) as { options: { enabled: boolean } }).options.enabled).toBe(true);
  });

  it('lists the notifications in words, with the reason', async () => {
    state.unread = 1;
    state.list = [note()];
    renderBell();
    await userEvent.click(screen.getByRole('button', { name: /اعلان‌ها/ }));
    expect(await screen.findByText('رضا برای «سه اشتباه» اصلاح خواست')).toBeVisible();
    expect(screen.getByText('لحن را رسمی‌تر کنید')).toBeVisible();
  });

  it('marks a notification read and goes to its content when it is clicked', async () => {
    state.unread = 1;
    state.list = [note()];
    renderBell();
    await userEvent.click(screen.getByRole('button', { name: /اعلان‌ها/ }));
    await userEvent.click(await screen.findByText('رضا برای «سه اشتباه» اصلاح خواست'));
    expect(state.markRead).toHaveBeenCalledWith('n1');
    expect(screen.getByTestId('where')).toHaveTextContent('/app/contents/c1');
  });

  it('does not mark an already read notification again', async () => {
    state.list = [note({ readAt: new Date().toISOString() })];
    renderBell();
    await userEvent.click(screen.getByRole('button', { name: t('inbox.title') }));
    await userEvent.click(await screen.findByText('رضا برای «سه اشتباه» اصلاح خواست'));
    expect(state.markRead).not.toHaveBeenCalled();
  });

  it('marks everything read, but only when there is something unread', async () => {
    state.unread = 2;
    state.list = [note()];
    renderBell();
    await userEvent.click(screen.getByRole('button', { name: /اعلان‌ها/ }));
    await userEvent.click(await screen.findByRole('button', { name: t('inbox.markAll') }));
    expect(state.markAll).toHaveBeenCalled();
  });

  it('says so when there is nothing, and disables mark-all', async () => {
    renderBell();
    await userEvent.click(screen.getByRole('button', { name: t('inbox.title') }));
    expect(await screen.findByText(t('inbox.empty'))).toBeVisible();
    expect(screen.getByRole('button', { name: t('inbox.markAll') })).toBeDisabled();
    expect(screen.getByRole('link', { name: t('inbox.viewAll') })).toHaveAttribute(
      'href',
      '/app/notifications',
    );
  });

  it('reads in English when the language is English', async () => {
    useUi.setState({ lang: 'en' });
    state.list = [note()];
    renderBell();
    await userEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('رضا asked for changes to “سه اشتباه”')).toBeVisible();
  });
});

describe('NotificationPreferencesCard', () => {
  const prefs = (emailAvailable: boolean): NotificationPreferences => ({
    emailAvailable,
    preferences: [
      { event: 'REVIEW_APPROVED', inApp: true, email: true },
      { event: 'COMMENT_ADDED', inApp: true, email: false },
    ],
  });
  const row = (event: string) =>
    screen.getByText(t(`inbox.events.${event as 'REVIEW_APPROVED'}`)).closest('tr')!;

  it('shows a switch per event and channel with the current choice', () => {
    state.prefs = prefs(true);
    render(<NotificationPreferencesCard />);
    const switches = within(row('COMMENT_ADDED')).getAllByRole('switch');
    expect(switches.map((s) => s.getAttribute('aria-checked'))).toEqual(['true', 'false']);
  });

  it('changes one channel of one event', async () => {
    state.prefs = prefs(true);
    render(<NotificationPreferencesCard />);
    await userEvent.click(within(row('COMMENT_ADDED')).getAllByRole('switch')[1]!);
    expect(state.setPref).toHaveBeenCalledWith(
      { event: 'COMMENT_ADDED', email: true },
      expect.anything(),
    );
    await userEvent.click(within(row('REVIEW_APPROVED')).getAllByRole('switch')[0]!);
    expect(state.setPref).toHaveBeenLastCalledWith(
      { event: 'REVIEW_APPROVED', inApp: false },
      expect.anything(),
    );
  });

  it('explains and disables e-mail when the server cannot send it', () => {
    state.prefs = prefs(false);
    render(<NotificationPreferencesCard />);
    expect(screen.getByText(t('inbox.preferences.noEmail'))).toBeVisible();
    const [inApp, email] = within(row('REVIEW_APPROVED')).getAllByRole('switch');
    expect(inApp).toBeEnabled();
    expect(email).toBeDisabled();
  });
});

describe('NotificationSettingsCard', () => {
  const settings = (over: Partial<NotificationSettings> = {}): NotificationSettings => ({
    webhookUrl: 'https://hooks.test/x',
    hasWebhookSecret: true,
    webhookEvents: ['REVIEW_APPROVED'],
    emailConfigured: true,
    ...over,
  });
  const render1 = (s: NotificationSettings) => {
    state.settings = s;
    return render(<NotificationSettingsCard />);
  };
  const save = () => userEvent.click(screen.getByRole('button', { name: t('common.save') }));
  const saved = () => state.saveSettings.mock.calls.at(-1)![0];

  it('reports whether e-mail is configured, and how to set it up when it is not', () => {
    render1(settings({ emailConfigured: false }));
    expect(screen.getByText(t('inbox.settings.notConfigured'))).toBeVisible();
    expect(screen.getByText(t('inbox.settings.emailHint'))).toBeVisible();
  });

  it('starts from the stored webhook and its events, and never shows the secret', () => {
    render1(settings());
    expect(screen.getByDisplayValue('https://hooks.test/x')).toBeVisible();
    expect(screen.getByText(t('inbox.settings.secretSet'))).toBeVisible();
    expect(screen.getAllByRole('button', { pressed: true }).map((b) => b.textContent)).toEqual([
      t('inbox.events.REVIEW_APPROVED'),
    ]);
  });

  it('keeps the stored secret when the field is left alone', async () => {
    render1(settings());
    await save();
    expect(saved()).toEqual({
      webhookUrl: 'https://hooks.test/x',
      webhookEvents: ['REVIEW_APPROVED'],
    });
    expect('webhookSecret' in saved()).toBe(false);
  });

  it('sends a new secret, removes the stored one, or switches the webhook off', async () => {
    render1(settings());
    await userEvent.type(
      document.querySelector('input[type=password]')!,
      'a-new-long-enough-secret',
    );
    await save();
    expect(saved()).toMatchObject({ webhookSecret: 'a-new-long-enough-secret' });

    await userEvent.clear(document.querySelector('input[type=password]')!);
    await userEvent.click(screen.getByRole('button', { name: t('inbox.settings.removeSecret') }));
    await save();
    expect(saved()).toMatchObject({ webhookSecret: null });

    await userEvent.clear(screen.getByDisplayValue('https://hooks.test/x'));
    await save();
    expect(saved().webhookUrl).toBeNull();
  });

  it('refuses a secret that is too short before sending anything', async () => {
    render1(settings());
    await userEvent.type(document.querySelector('input[type=password]')!, 'short');
    expect(screen.getByText(t('inbox.settings.secretShort', { min: 16 }))).toBeVisible();
    expect(screen.getByRole('button', { name: t('common.save') })).toBeDisabled();
  });

  it('toggles which events are sent', async () => {
    render1(settings());
    await userEvent.click(screen.getByRole('button', { name: t('inbox.events.CONTENT_DUE') }));
    await userEvent.click(screen.getByRole('button', { name: t('inbox.events.REVIEW_APPROVED') }));
    await save();
    expect(saved().webhookEvents).toEqual(['CONTENT_DUE']);
  });

  it('sends a test and shows what happened per channel', async () => {
    state.sendTest.mockImplementation((_v, opts) =>
      opts.onSuccess({ email: { error: 'connect ECONNREFUSED' }, webhook: 'sent' }),
    );
    render1(settings());
    await userEvent.click(screen.getByRole('button', { name: t('inbox.settings.sendTest') }));
    await waitFor(() => expect(screen.getByText('connect ECONNREFUSED')).toBeVisible());
    expect(screen.getByText(t('inbox.settings.test.sent'))).toBeVisible();
  });

  it('lists the latest deliveries with their errors', () => {
    state.deliveries = [
      {
        id: 'd1',
        channel: 'WEBHOOK',
        event: 'REVIEW_APPROVED',
        target: 'hooks.test',
        status: 'FAILED',
        error: 'HTTP 500',
        attempts: 3,
        createdAt: new Date().toISOString(),
      },
    ];
    render1(settings());
    expect(screen.getByText('HTTP 500')).toBeVisible();
    expect(screen.getByText('hooks.test')).toBeVisible();
    expect(screen.getByText(t('inbox.settings.status.FAILED'))).toBeVisible();
  });
});
