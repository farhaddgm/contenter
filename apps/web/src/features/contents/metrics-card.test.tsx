import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Content, ContentMetric } from '@contenter/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({
  items: [] as ContentMetric[],
  add: vi.fn(),
  bulk: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('./api/contents', () => ({
  useMetrics: (_id: string, enabled: boolean) => ({
    isLoading: false,
    data: enabled
      ? {
          items: state.items,
          summary: {
            readings: state.items.length,
            latest: state.items[0] ?? null,
            engagementRate: state.items.length ? 0.1 : null,
          },
        }
      : undefined,
  }),
  useAddMetric: () => ({ mutate: state.add, isPending: false }),
  useBulkMetrics: () => ({ mutate: state.bulk, isPending: false }),
  useDeleteMetric: () => ({ mutate: state.remove, isPending: false }),
}));

import { MetricsCard } from './components/metrics-card';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

const content = (publishedAt: string | null) => ({ id: 'c1', publishedAt }) as unknown as Content;

const reading = (over: Partial<ContentMetric> = {}): ContentMetric => ({
  id: 'm1',
  contentId: 'c1',
  measuredAt: '2026-10-05',
  views: 1000,
  likes: 80,
  comments: 10,
  shares: 5,
  saves: 5,
  clicks: null,
  conversions: null,
  revenue: null,
  note: '',
  createdAt: '2026-10-05T00:00:00Z',
  updatedAt: '2026-10-05T00:00:00Z',
  ...over,
});

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.items = [];
  state.add = vi.fn();
  state.bulk = vi.fn();
  state.remove = vi.fn();
});

describe('MetricsCard', () => {
  it('explains how to unlock it while the content is not published, with no buttons', () => {
    render(<MetricsCard content={content(null)} canEdit />);
    expect(screen.getByText(t('contents.metrics.notPublished'))).toBeVisible();
    expect(screen.queryByRole('button', { name: t('contents.metrics.add') })).toBeNull();
  });

  it('shows the readings and the engagement rate of a published content', () => {
    state.items = [reading()];
    render(<MetricsCard content={content('2026-10-01T00:00:00Z')} canEdit />);
    expect(screen.getByText(/۱٬۰۰۰/)).toBeVisible();
    expect(screen.getByText(/۱۰٪/)).toBeVisible();
  });

  it('hides the write buttons from someone who cannot edit', () => {
    render(<MetricsCard content={content('2026-10-01T00:00:00Z')} canEdit={false} />);
    expect(screen.getByText(t('contents.metrics.empty'))).toBeVisible();
    expect(screen.queryByRole('button', { name: t('contents.metrics.paste') })).toBeNull();
  });

  it('sends the numbers typed into the add dialog, dropping empty fields', async () => {
    render(<MetricsCard content={content('2026-10-01T00:00:00Z')} canEdit />);
    await userEvent.click(screen.getByRole('button', { name: t('contents.metrics.add') }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(t('contents.metrics.fields.views')), '250');
    await userEvent.type(within(dialog).getByLabelText(t('contents.metrics.fields.likes')), '12');
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.save') }));
    expect(state.add).toHaveBeenCalledTimes(1);
    expect(state.add.mock.calls[0][0]).toMatchObject({ views: 250, likes: 12 });
    expect(state.add.mock.calls[0][0]).not.toHaveProperty('shares');
  });

  it('reads a pasted table in the browser and imports only the valid rows', async () => {
    render(<MetricsCard content={content('2026-10-01T00:00:00Z')} canEdit />);
    await userEvent.click(screen.getByRole('button', { name: t('contents.metrics.paste') }));
    const dialog = screen.getByRole('dialog');
    const importButton = within(dialog).getByRole('button', { name: /ثبت ۰ ردیف/ });
    expect(importButton).toBeDisabled();
    await userEvent.click(
      within(dialog).getByRole('textbox', { name: t('contents.metrics.table') }),
    );
    await userEvent.paste('date,views\n2026-10-02,10\n2026-10-03,abc');
    expect(await within(dialog).findByText(/۱ ردیف قابل ثبت است/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: /ثبت ۱ ردیف/ }));
    expect(state.bulk.mock.calls[0][0]).toEqual({
      rows: [{ measuredAt: '2026-10-02', views: 10 }],
    });
  });
});
