import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_BUDGET, type BudgetResponse } from '@contenter/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({
  data: undefined as unknown,
  save: vi.fn(),
}));

vi.mock('@/features/admin/api', () => ({
  useBudget: () => ({ data: state.data }),
  useUpdateBudget: () => ({ mutate: state.save, isPending: false }),
}));
vi.mock('@/features/businesses/api/businesses', () => ({
  useBusinessOptions: () => ({
    data: [
      { id: 'b1', name: 'برند الف', status: 'ACTIVE' },
      { id: 'b2', name: 'برند ب', status: 'ACTIVE' },
    ],
  }),
}));

import { BudgetCard } from './components/budget-card';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

const response = (over: Partial<BudgetResponse['usage']> = {}): BudgetResponse => ({
  settings: { ...DEFAULT_BUDGET },
  usage: {
    from: '2026-09-22T20:30:00.000Z',
    to: '2026-10-22T20:30:00.000Z',
    label: '1405/7',
    spentUsd: 17,
    capUsd: 20,
    percent: 0.85,
    level: 'warning',
    byTask: [{ type: 'GENERATE_CONTENT', usd: 12, jobs: 30 }],
    byBusiness: [{ businessId: 'b1', name: 'برند الف', usd: 17, jobs: 40, capUsd: null, percent: null, level: 'none' }],
    ...over,
  },
});

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.save = vi.fn();
  state.data = response();
});

describe('BudgetCard', () => {
  it('shows the month, the spending against the cap and what it means', () => {
    render(<BudgetCard />);
    expect(screen.getByText(t('settings.budget.thisMonth', { label: '1405/7' }))).toBeVisible();
    expect(screen.getByText(t('settings.budget.level.warning'))).toBeVisible();
    expect(screen.getByText(t('enums.jobType.GENERATE_CONTENT'))).toBeVisible();
    expect(screen.getAllByText('برند الف').length).toBeGreaterThan(0);
  });

  it('sends the edited cap, warning level and hard stop', async () => {
    render(<BudgetCard />);
    const cap = screen.getByLabelText(t('settings.budget.cap'));
    await userEvent.clear(cap);
    await userEvent.type(cap, '35');
    await userEvent.click(screen.getByRole('switch'));
    await userEvent.click(screen.getByRole('button', { name: t('common.save') }));
    expect(state.save).toHaveBeenCalledTimes(1);
    expect(state.save.mock.calls[0][0]).toMatchObject({ monthlyUsd: 35, hardStop: true, warnPercent: 80 });
  });

  it('an empty cap means no cap', async () => {
    render(<BudgetCard />);
    await userEvent.clear(screen.getByLabelText(t('settings.budget.cap')));
    await userEvent.click(screen.getByRole('button', { name: t('common.save') }));
    expect(state.save.mock.calls[0][0].monthlyUsd).toBeNull();
  });

  it('adds and removes the cap of a business', async () => {
    render(<BudgetCard />);
    await userEvent.type(
      screen.getByLabelText(`${t('settings.budget.businessCap')} — برند الف`),
      '8',
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '' }), 'b2');
    await userEvent.click(screen.getByRole('button', { name: t('settings.add') }));
    await userEvent.click(screen.getByRole('button', { name: t('common.save') }));
    expect(state.save.mock.calls[0][0].businesses).toEqual({ b1: 8, b2: 10 });
  });

  it('warns that new jobs are blocked when the hard stop is on and the cap is used up', () => {
    state.data = {
      ...response({ spentUsd: 25, percent: 1.25, level: 'exceeded' }),
      settings: { ...DEFAULT_BUDGET, hardStop: true },
    };
    render(<BudgetCard />);
    expect(screen.getByText(t('settings.budget.blockedNow'))).toBeVisible();
  });
});
