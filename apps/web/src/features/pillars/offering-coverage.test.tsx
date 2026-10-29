import { render, screen, within } from '@testing-library/react';
import type { OfferingCoverageReport } from '@contenter/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({ data: undefined as unknown, isLoading: false }));

vi.mock('./api/coverage', () => ({
  useOfferingCoverage: () => ({ data: state.data, isLoading: state.isLoading }),
}));

import { OfferingCoverageCard } from './components/offering-coverage';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

const counts = (a: number, b: number, c: number) => ({ 30: a, 60: b, 90: c });

const report = (over: Partial<OfferingCoverageReport> = {}): OfferingCoverageReport => ({
  windows: [30, 60, 90],
  staleDays: 30,
  rows: [
    {
      offeringId: 'L',
      name: 'تسهیلات ویپاد',
      parentId: null,
      depth: 0,
      promotable: true,
      own: counts(0, 1, 1),
      subtree: counts(2, 3, 3),
      lastAt: '2026-10-20T00:00:00Z',
      daysSince: 9,
      stale: false,
    },
    {
      offeringId: 'V',
      name: 'تسهیلات تجهیزات',
      parentId: 'L',
      depth: 1,
      promotable: true,
      own: counts(2, 2, 2),
      subtree: counts(2, 2, 2),
      lastAt: '2026-10-20T00:00:00Z',
      daysSince: 9,
      stale: false,
    },
    {
      offeringId: 'X',
      name: 'بیمه',
      parentId: null,
      depth: 0,
      promotable: true,
      own: counts(0, 0, 0),
      subtree: counts(0, 0, 0),
      lastAt: null,
      daysSince: null,
      stale: true,
    },
    {
      offeringId: 'P',
      name: 'قدیمی',
      parentId: null,
      depth: 0,
      promotable: false,
      own: counts(0, 0, 0),
      subtree: counts(0, 0, 0),
      lastAt: null,
      daysSince: null,
      stale: false,
    },
  ],
  segments: [
    { id: 's1', name: 'کارمند', kind: 'PERSONA' },
    { id: 's2', name: 'صاحب کسب‌وکار', kind: 'MARKET' },
  ],
  cells: [
    { offeringId: 'V', segmentId: 's1', linked: true, fit: 2, count: 2, lastAt: '2026-10-20T00:00:00Z', gap: false },
    { offeringId: 'V', segmentId: 's2', linked: true, fit: 1, count: 0, lastAt: null, gap: true },
  ],
  withoutOffering: counts(1, 1, 4),
  withoutAudience: 3,
  total: 9,
  ...over,
});

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.data = report();
  state.isLoading = false;
});

describe('OfferingCoverageCard', () => {
  it('lists every offering with its 30 / 60 / 90 day counts, the line including its variants', () => {
    render(<OfferingCoverageCard businessId="b1" />);
    const row = screen.getAllByText('تسهیلات ویپاد')[0]!.closest('tr')!;
    const cells = within(row).getAllByRole('cell').map((c) => c.textContent);
    expect(cells[1]).toContain('۲');
    expect(cells[1]).toContain(t('coverage.offerings.own', { n: '۰' }));
    expect(within(row).getByText(t('coverage.offerings.daysAgo', { n: '۹' }))).toBeVisible();
  });

  it('flags an offering with no content, and says an unsellable one is not promoted', () => {
    render(<OfferingCoverageCard businessId="b1" />);
    const stale = screen.getAllByText('بیمه')[0]!.closest('tr')!;
    expect(within(stale).getByText(t('coverage.offerings.stale'))).toBeVisible();
    expect(within(stale).getByText(t('coverage.offerings.never'))).toBeVisible();
    const old = screen.getAllByText('قدیمی')[0]!.closest('tr')!;
    expect(within(old).getByText(t('coverage.offerings.notPromotable'))).toBeVisible();
    expect(within(old).queryByText(t('coverage.offerings.stale'))).not.toBeInTheDocument();
  });

  it('shows the matrix with the gap marked, and the contents that are not tied to anything', () => {
    render(<OfferingCoverageCard businessId="b1" />);
    expect(screen.getByText(t('coverage.offerings.matrix'))).toBeVisible();
    expect(screen.getByTitle(t('coverage.offerings.gap'))).toHaveTextContent('!');
    expect(screen.getByText(t('coverage.offerings.withoutOffering', { n: '۴' }))).toBeVisible();
    expect(screen.getByText(t('coverage.offerings.withoutAudience', { n: '۳' }))).toBeVisible();
  });

  it('has no matrix without audiences, and says so when the catalog is empty', () => {
    state.data = report({ segments: [], cells: [] });
    const { unmount } = render(<OfferingCoverageCard businessId="b1" />);
    expect(screen.queryByText(t('coverage.offerings.matrix'))).not.toBeInTheDocument();
    unmount();
    state.data = report({ rows: [] });
    render(<OfferingCoverageCard businessId="b1" />);
    expect(screen.getByText(t('coverage.offerings.empty'))).toBeVisible();
  });
});
