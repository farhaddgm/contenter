import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BusinessOffering } from '@contenter/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  canEdit: true,
  segments: [] as unknown[],
  setSegments: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  confirm: vi.fn(),
  extract: vi.fn(),
}));

vi.mock('./api/offerings', () => ({
  offeringKeys: { list: (id: string) => ['offerings', id] },
  useOfferings: () => ({ data: state.rows, isLoading: false }),
  useCreateOffering: () => ({ mutateAsync: state.create, isPending: false }),
  useUpdateOffering: () => ({ mutate: state.update, mutateAsync: state.update, isPending: false }),
  useSetOfferingSegments: () => ({ mutateAsync: state.setSegments, isPending: false }),
  useConfirmOffering: () => ({ mutate: state.confirm, isPending: false }),
  useDeleteOffering: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useExtractOfferings: () => ({ mutate: state.extract, isPending: false }),
}));
vi.mock('./api/segments', () => ({
  useSegments: () => ({ data: state.segments, isLoading: false }),
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
  claims: [],
  stock: 'IN_STOCK',
  parentId: null,
  guardrails: [],
  segments: [],
  peakMonths: [],
  complementIds: [],
  substituteIds: [],
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
  state.segments = [];
  state.setSegments = vi.fn(async () => undefined);
  state.create = vi.fn(async () => ({ id: 'new' }));
  state.update = vi.fn(async () => ({ id: 'o1' }));
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
      parentId: null,
      guardrails: [],
    });

    // the drawer closes after a save; a second one carries the price
    await userEvent.click(screen.getByRole('button', { name: t('businesses.offerings.new') }));
    const again = await screen.findByRole('dialog');
    await userEvent.type(within(again).getByLabelText(t('businesses.offerings.fields.name')), 'مشاوره ۲');
    await userEvent.type(within(again).getByLabelText(t('businesses.offerings.fields.priceAmount')), '۱۲۰٬۰۰۰');
    await userEvent.click(within(again).getByRole('button', { name: t('common.save') }));
    expect(state.create.mock.calls[1]![0]).toMatchObject({ priceAmount: '۱۲۰٬۰۰۰', priceCurrency: 'IRT' });
}, 20_000);
});

describe('OfferingsPanel: product tree and audiences (docs/73)', () => {
  const tree = () => [
    row({ id: 'l', name: 'تسهیلات ویپاد', kind: 'SERVICE', priceAmount: null, priceCurrency: null }),
    row({ id: 'v', name: 'تسهیلات تجهیزات', parentId: 'l', kind: 'SERVICE', guardrails: ['سود تضمینی'] }),
    row({ id: 'x', name: 'بیمه', kind: 'SERVICE' }),
  ];

  it('shows a variant right under its line, saying what it belongs to, with its banned phrases counted', () => {
    state.rows = [tree()[2]!, tree()[1]!, tree()[0]!];
    render(<OfferingsPanel businessId="b1" />);
    const items = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    const line = items.findIndex((x) => x.includes('تسهیلات ویپاد') && !x.includes('تسهیلات تجهیزات'));
    const variant = items.findIndex((x) => x.includes('تسهیلات تجهیزات'));
    expect(line).toBeGreaterThanOrEqual(0);
    expect(variant).toBe(line + 1);
    expect(screen.getByText(t('businesses.offerings.variantOf', { name: 'تسهیلات ویپاد' }))).toBeVisible();
    expect(screen.getByText(t('businesses.offerings.guardrailsCount', { count: '۱' }))).toBeVisible();
  });

  it('adds a variant with its line already chosen', async () => {
    state.rows = tree();
    render(<OfferingsPanel businessId="b1" />);
    const line = screen.getByText('تسهیلات ویپاد').closest('li')!;
    await userEvent.click(within(line).getByRole('button', { name: t('businesses.offerings.addVariant') }));
    const drawer = await screen.findByRole('dialog');
    await userEvent.type(within(drawer).getByLabelText(t('businesses.offerings.fields.name')), 'تسهیلات خرید');
    await userEvent.type(
      within(drawer).getByLabelText(t('businesses.offerings.fields.guardrails')),
      'بدون ریسک{enter}سود تضمینی',
    );
    await userEvent.click(within(drawer).getByRole('button', { name: t('common.save') }));
    expect(state.create.mock.calls[0]![0]).toMatchObject({
      name: 'تسهیلات خرید',
      parentId: 'l',
      guardrails: ['بدون ریسک', 'سود تضمینی'],
    });
}, 20_000);

  it('offers no variant button below the last level', () => {
    state.rows = [
      row({ id: 'l', name: 'خط' }),
      row({ id: 'p', name: 'محصول', parentId: 'l' }),
      row({ id: 'v', name: 'گونه', parentId: 'p' }),
    ];
    render(<OfferingsPanel businessId="b1" />);
    const variant = screen.getByText('گونه').closest('li')!;
    expect(within(variant).queryByRole('button', { name: t('businesses.offerings.addVariant') })).toBeNull();
    const line = screen.getByText('خط').closest('li')!;
    expect(within(line).getByRole('button', { name: t('businesses.offerings.addVariant') })).toBeVisible();
  });

  it('links audiences after saving, main or secondary, and only when they changed', async () => {
    state.segments = [
      { id: 's1', name: 'کارمند' },
      { id: 's2', name: 'صاحب کسب‌وکار' },
    ];
    state.rows = [row({ id: 'o1', name: 'مشاوره' })];
    render(<OfferingsPanel businessId="b1" />);
    await userEvent.click(screen.getByRole('button', { name: t('common.edit') }));
    const drawer = await screen.findByRole('dialog');
    await userEvent.click(within(drawer).getByRole('button', { name: 'کارمند' }));
    await userEvent.click(within(drawer).getByRole('button', { name: t('businesses.offerings.fields.fitMain') }));
    await userEvent.click(within(drawer).getByRole('button', { name: t('common.save') }));
    expect(state.setSegments).toHaveBeenCalledWith({ id: 'o1', links: [{ segmentId: 's1', fit: 1 }] });
  });

  it('does not call the link endpoint when the audiences did not change', async () => {
    state.segments = [{ id: 's1', name: 'کارمند' }];
    state.rows = [row({ id: 'o1', name: 'مشاوره', segments: [{ segmentId: 's1', fit: 1 }] })];
    render(<OfferingsPanel businessId="b1" />);
    await userEvent.click(screen.getByRole('button', { name: t('common.edit') }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: t('common.save') }));
    expect(state.update).toHaveBeenCalled();
    expect(state.setSegments).not.toHaveBeenCalled();
  });
});
