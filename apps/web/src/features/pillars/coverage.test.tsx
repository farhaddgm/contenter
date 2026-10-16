import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildCoverage, type ContentPillar, type CoverageReport } from '@contenter/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({
  pillars: [] as unknown[],
  report: undefined as unknown,
  canEdit: true,
  save: vi.fn(),
  params: [] as unknown[],
}));

vi.mock('./api/coverage', () => ({
  usePillars: () => ({ data: state.pillars, isLoading: false }),
  useSavePillars: () => ({ mutate: state.save, isPending: false }),
  useCoverage: (_id: string, params: unknown) => {
    state.params.push(params);
    return { data: state.report, isLoading: !state.report };
  },
}));
vi.mock('@/features/businesses/api/businesses', () => ({
  useCanEditBusiness: () => state.canEdit,
}));

import { CoverageMap } from './components/coverage-map';
import { PillarsCard } from './components/pillars-card';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

const now = new Date('2026-10-14T12:00:00Z');
const day = (n: number) => new Date(now.getTime() - n * 86_400_000);
const pillars: ContentPillar[] = [
  { id: 'edu', name: 'آموزش', targetShare: 50, order: 0 },
  { id: 'sale', name: 'فروش', targetShare: null, order: 1 },
];
const report = (
  items: Parameters<typeof buildCoverage>[1],
  by: 'platform' | 'period' = 'platform',
): CoverageReport => buildCoverage(pillars, items, { days: 90, by, staleDays: 30, now });

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.canEdit = true;
  state.save = vi.fn();
  state.params = [];
  state.pillars = pillars;
  state.report = undefined;
});

describe('CoverageMap', () => {
  it('says so when the business has no pillar yet', () => {
    state.report = buildCoverage([], [], { days: 90, by: 'platform', staleDays: 30, now });
    render(<CoverageMap businessId="b1" />);
    expect(screen.getByText(t('coverage.noPillars'))).toBeVisible();
  });

  it('draws the matrix with only the platforms that were used, the unlabeled row and the stale pillar', () => {
    state.report = report([
      ...Array.from({ length: 4 }, () => ({
        pillarId: 'edu',
        platform: 'INSTAGRAM' as const,
        at: day(3),
      })),
      { pillarId: 'edu', platform: 'X' as const, at: day(5) },
      { pillarId: null, platform: 'INSTAGRAM' as const, at: day(2) },
    ]);
    render(<CoverageMap businessId="b1" />);
    const table = screen.getByRole('table');
    expect(within(table).getByText(t('enums.platform.INSTAGRAM'))).toBeVisible();
    expect(within(table).getByText(t('enums.platform.X'))).toBeVisible();
    expect(within(table).queryByText(t('enums.platform.TELEGRAM'))).toBeNull();
    expect(within(table).getByText(t('coverage.unlabeled'))).toBeVisible();
    // آموزش: 5 labeled of 5 → 100% against a 50% target
    expect(within(table).getByText(/۱۰۰٪/)).toBeVisible();
    // فروش never had content → warned
    expect(within(table).getByText(t('coverage.never'))).toHaveClass('text-warning');
  });

  it('shows 30-day periods and asks the server again when the view or the period changes', async () => {
    state.report = report([{ pillarId: 'edu', platform: 'X', at: day(40) }], 'period');
    render(<CoverageMap businessId="b1" />);
    expect(screen.getByText(t('coverage.periodRange', { from: '۳۰', to: '۶۰' }))).toBeVisible();
    await userEvent.selectOptions(screen.getByLabelText(t('coverage.by')), 'period');
    await userEvent.selectOptions(screen.getByLabelText(t('coverage.period')), '180');
    expect(state.params.at(-1)).toEqual({ days: 180, by: 'period', staleDays: 30 });
  });

  it('holds back the target comparison with too few labeled contents', () => {
    state.report = report([{ pillarId: 'edu', platform: 'X', at: day(1) }]);
    render(<CoverageMap businessId="b1" />);
    expect(screen.getByText(t('coverage.fewLabeled', { min: '۵' }))).toBeVisible();
  });
});

describe('PillarsCard', () => {
  it('saves renamed pillars with their ids, a new one and a target, and drops empty rows', async () => {
    render(<PillarsCard businessId="b1" />);
    const names = screen.getAllByLabelText(t('coverage.pillars.name'));
    expect(names).toHaveLength(2);
    await userEvent.clear(names[1]!);
    await userEvent.type(names[1]!, 'فروش و پیشنهاد');
    await userEvent.click(screen.getByRole('button', { name: t('coverage.pillars.add') }));
    await userEvent.click(screen.getByRole('button', { name: t('coverage.pillars.add') })); // stays empty
    const all = screen.getAllByLabelText(t('coverage.pillars.name'));
    await userEvent.type(all[2]!, 'داستان');
    await userEvent.type(screen.getAllByLabelText(t('coverage.pillars.target'))[2]!, '20');
    await userEvent.click(screen.getByRole('button', { name: t('common.save') }));
    expect(state.save.mock.calls[0]![0]).toEqual({
      pillars: [
        { id: 'edu', name: 'آموزش', targetShare: 50 },
        { id: 'sale', name: 'فروش و پیشنهاد', targetShare: null },
        { name: 'داستان', targetShare: 20 },
      ],
    });
  });

  it('will not save targets above 100 together', async () => {
    render(<PillarsCard businessId="b1" />);
    const targets = screen.getAllByLabelText(t('coverage.pillars.target'));
    await userEvent.type(targets[1]!, '70');
    expect(screen.getByRole('button', { name: t('common.save') })).toBeDisabled();
    expect(screen.getByText(t('coverage.pillars.invalid'))).toBeVisible();
  });

  it('is read-only without edit access', () => {
    state.canEdit = false;
    render(<PillarsCard businessId="b1" />);
    expect(screen.getAllByLabelText(t('coverage.pillars.name'))[0]).toBeDisabled();
    expect(screen.queryByRole('button', { name: t('common.save') })).toBeNull();
  });
});
