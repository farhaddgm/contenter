import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BusinessOffering } from '@contenter/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  canEdit: true,
  create: vi.fn(),
  update: vi.fn(),
  confirm: vi.fn(),
  extract: vi.fn(),
}));

vi.mock('./api/offerings', () => ({
  offeringKeys: { list: (id: string) => ['offerings', id] },
  useOfferings: () => ({ data: state.rows, isLoading: false }),
  useCreateOffering: () => ({ mutate: state.create, isPending: false }),
  useUpdateOffering: () => ({ mutate: state.update, isPending: false }),
  useConfirmOffering: () => ({ mutate: state.confirm, isPending: false }),
  useDeleteOffering: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useExtractOfferings: () => ({ mutate: state.extract, isPending: false }),
}));
vi.mock('./api/businesses', () => ({ useCanEditBusiness: () => state.canEdit }));
vi.mock('@/features/jobs/api/jobs', () => ({
  useTrackJob: () => ({ job: undefined, isRunning: false }),
}));

import { OfferingsPanel, priceLabel } from './components/offerings-panel';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

const row = (over: Partial<BusinessOffering> = {}): BusinessOffering => ({
  id: 'o1',
  businessId: 'b1',
  name: 'اشتراک طلایی',
  aliases: [],
  kind: 'PLAN',
  status: 'ACTIVE',
  push: 1,
  summary: '',
  features: [],
  priceAmount: '199000',
  priceCurrency: 'IRT',
  priceFrom: false,
  priceUnit: 'ماهانه',
  priceValidUntil: null,
  availableFrom: null,
  availableUntil: null,
  url: '',
  note: '',
  source: 'ADMIN',
  verified: true,
  isActive: true,
  evidence: '',
  sortOrder: 0,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...over,
});

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.rows = [row()];
  state.canEdit = true;
  state.create = vi.fn();
  state.update = vi.fn();
  state.confirm = vi.fn();
  state.extract = vi.fn();
});

describe('priceLabel', () => {
  it('writes the price with its currency and unit, or says there is none', () => {
    expect(priceLabel(t, row())).toBe('۱۹۹٬۰۰۰ تومان / ماهانه');
    expect(priceLabel(t, row({ priceFrom: true, priceUnit: '' }))).toBe('از ۱۹۹٬۰۰۰ تومان');
    expect(priceLabel(t, row({ priceAmount: null, priceCurrency: null }))).toBe(t('businesses.offerings.noPrice'));
  });
});

describe('OfferingsPanel', () => {
  it('lists the rows with kind, status and price', () => {
    render(<OfferingsPanel businessId="b1" />);
    expect(screen.getByText('اشتراک طلایی')).toBeVisible();
    expect(screen.getByText(t('enums.offeringKind.PLAN'))).toBeVisible();
    expect(screen.getByText(t('enums.offeringStatus.ACTIVE'))).toBeVisible();
    expect(screen.getByText('۱۹۹٬۰۰۰ تومان / ماهانه')).toBeVisible();
  });

  it('marks a price whose validity ran out', () => {
    state.rows = [row({ priceValidUntil: '2020-01-01' })];
    render(<OfferingsPanel businessId="b1" />);
    expect(screen.getByText(t('businesses.offerings.priceExpired'))).toBeVisible();
  });

  it('shows AI proposals apart, with the quote that backs them, and confirms one on click', async () => {
    state.rows = [
      row({ id: 'p1', name: 'مشاوره', verified: false, isActive: false, source: 'AI', evidence: 'مشاوره رایگان هم داریم' }),
      row(),
    ];
    render(<OfferingsPanel businessId="b1" />);
    expect(screen.getByText(t('businesses.offerings.pendingTitle'))).toBeVisible();
    expect(screen.getByText(/مشاوره رایگان هم داریم/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: t('businesses.offerings.confirm') }));
    expect(state.confirm.mock.calls[0]![0]).toBe('p1');
  });

  it('asks for proposals', async () => {
    render(<OfferingsPanel businessId="b1" />);
    await userEvent.click(screen.getByRole('button', { name: t('businesses.offerings.extract') }));
    expect(state.extract).toHaveBeenCalledTimes(1);
  });

  it('has no way to change anything for a reader', () => {
    state.canEdit = false;
    render(<OfferingsPanel businessId="b1" />);
    expect(screen.queryByRole('button', { name: t('businesses.offerings.new') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('common.edit') })).not.toBeInTheDocument();
  });

  it('refuses a form without a name and sends nothing', async () => {
    render(<OfferingsPanel businessId="b1" />);
    await userEvent.click(screen.getByRole('button', { name: t('businesses.offerings.new') }));
    const drawer = await screen.findByRole('dialog');
    await userEvent.click(within(drawer).getByRole('button', { name: t('common.save') }));
    expect(within(drawer).getByText(t('businesses.offerings.errors.name'))).toBeVisible();
    expect(state.create).not.toHaveBeenCalled();
  });

  it('sends the typed price as text and drops the currency when there is no price', async () => {
    render(<OfferingsPanel businessId="b1" />);
    await userEvent.click(screen.getByRole('button', { name: t('businesses.offerings.new') }));
    const drawer = await screen.findByRole('dialog');
    await userEvent.type(within(drawer).getByLabelText(t('businesses.offerings.fields.name')), 'مشاوره');
    await userEvent.click(within(drawer).getByRole('button', { name: t('common.save') }));
    expect(state.create.mock.calls[0]![0]).toMatchObject({
      name: 'مشاوره',
      priceAmount: '',
      priceCurrency: null,
      priceFrom: false,
    });

    await userEvent.type(within(drawer).getByLabelText(t('businesses.offerings.fields.priceAmount')), '۱۲۰٬۰۰۰');
    await userEvent.click(within(drawer).getByRole('button', { name: t('common.save') }));
    expect(state.create.mock.calls[1]![0]).toMatchObject({ priceAmount: '۱۲۰٬۰۰۰', priceCurrency: 'IRT' });
  });
});
