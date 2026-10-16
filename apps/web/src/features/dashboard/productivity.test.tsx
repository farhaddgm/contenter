import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProductivityStats } from '@contenter/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({
  data: undefined as unknown,
  params: [] as unknown[],
}));

vi.mock('./api/productivity', () => ({
  useProductivity: (params: unknown) => {
    state.params.push(params);
    return { data: state.data, isLoading: !state.data };
  },
}));
vi.mock('@/features/topics/api/topics', () => ({
  useTopics: () => ({
    data: { items: [{ id: 't1', title: 'آموزش مالی' }] },
  }),
}));

import { ProductivityPanel } from './components/productivity-panel';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

const stats = (over: Partial<ProductivityStats> = {}): ProductivityStats => ({
  days: 30,
  since: '2026-09-14T00:00:00.000Z',
  approved: 12,
  edited: 3,
  unedited: 9,
  uneditedShare: 0.75,
  cycle: { samples: 12, medianHours: 20, p90Hours: 60 },
  review: { samples: 12, medianHours: 6.5, p90Hours: 30 },
  cost: { totalUsd: 3, jobs: 40, failedJobs: 2, perApprovedUsd: 0.25 },
  byJobType: [
    { type: 'GENERATE_CONTENT', total: 30, failed: 2, retried: 4, costUsd: 2.5 },
    { type: 'IDEATE', total: 10, failed: 0, retried: 0, costUsd: 0.5 },
  ],
  ...over,
});

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.data = stats();
  state.params = [];
});

describe('ProductivityPanel', () => {
  it('shows the share approved as written, the time to approval and the cost per content', () => {
    render(<ProductivityPanel />);
    expect(screen.getByText(t('productivity.unedited'))).toBeVisible();
    expect(screen.getByText('۷۵٪')).toBeVisible();
    expect(
      screen.getByText(t('productivity.uneditedHint', { unedited: '۹', edited: '۳' })),
    ).toBeVisible();
    // 20 hours stays in hours; the slow end (60 h) is shown in days
    expect(screen.getByText(t('productivity.hours', { n: '۲۰' }))).toBeVisible();
    expect(
      screen.getByText(t('productivity.slowEnd', { value: t('productivity.days', { n: '۲٫۵' }) })),
    ).toBeVisible();
    expect(
      screen.getByText(
        t('productivity.reviewLine', { value: t('productivity.hours', { n: '۶٫۵' }) }),
      ),
    ).toBeVisible();
  });

  it('shows a dash instead of a number that would be noise, and says why', () => {
    state.data = stats({
      approved: 3,
      edited: 1,
      unedited: 2,
      uneditedShare: null,
      cycle: { samples: 3, medianHours: null, p90Hours: null },
      review: { samples: 3, medianHours: null, p90Hours: null },
      cost: { totalUsd: 3, jobs: 40, failedJobs: 2, perApprovedUsd: null },
    });
    render(<ProductivityPanel />);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText(t('productivity.fewSamples', { min: '۵' }))).toBeVisible();
    expect(screen.queryByText('۷۵٪')).toBeNull();
  });

  it('lists the AI jobs by type with their failures', () => {
    render(<ProductivityPanel />);
    expect(screen.getByText(t('enums.jobType.GENERATE_CONTENT'))).toBeVisible();
    // 2 of 30 failed
    expect(screen.getByText('۲ (۷٪)')).toBeVisible();
    expect(screen.getByText(t('enums.jobType.IDEATE'))).toBeVisible();
  });

  it('asks again when the period or the topic changes', async () => {
    render(<ProductivityPanel />);
    expect(state.params.at(-1)).toEqual({ days: 30, topicId: undefined });
    await userEvent.selectOptions(screen.getByLabelText(t('productivity.period')), '90');
    expect(state.params.at(-1)).toEqual({ days: 90, topicId: undefined });
    await userEvent.selectOptions(screen.getByLabelText(t('productivity.topic')), 't1');
    expect(state.params.at(-1)).toEqual({ days: 90, topicId: 't1' });
  });
});
