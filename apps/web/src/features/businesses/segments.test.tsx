import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BusinessSegment } from '@contenter/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  canEdit: true,
  propose: vi.fn(),
  confirm: vi.fn(),
  update: vi.fn(),
}));

vi.mock('./api/segments', () => ({
  segmentKeys: { list: (id: string) => ['segments', id] },
  useSegments: () => ({ data: state.rows, isLoading: false }),
  useCreateSegment: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSegment: () => ({ mutate: state.update, isPending: false }),
  useDeleteSegment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConfirmSegment: () => ({ mutate: state.confirm, isPending: false }),
  useProposeSegments: () => ({ mutate: state.propose, isPending: false }),
}));
vi.mock('./api/businesses', () => ({ useCanEditBusiness: () => state.canEdit }));
vi.mock('@/features/jobs/api/jobs', () => ({
  useTrackJob: () => ({ job: undefined, isRunning: false }),
}));

import { SegmentsPanel } from './components/segments-panel';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

const row = (over: Partial<BusinessSegment> = {}): BusinessSegment => ({
  id: 's1',
  businessId: 'b1',
  kind: 'PERSONA',
  name: 'کارمند',
  summary: 'حقوق ثابت',
  goals: [],
  pains: [],
  objections: [],
  channels: [],
  messageAngle: 'بدون وثیقه',
  note: '',
  isActive: true,
  sortOrder: 0,
  source: 'ADMIN',
  verified: true,
  evidence: '',
  offeringIds: [],
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...over,
});

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.rows = [row()];
  state.canEdit = true;
  state.propose = vi.fn();
  state.confirm = vi.fn();
  state.update = vi.fn();
});

describe('SegmentsPanel', () => {
  it('lists the audiences with their kind and what they are linked to', () => {
    render(<SegmentsPanel businessId="b1" />);
    expect(screen.getByText('کارمند')).toBeVisible();
    expect(screen.getByText(t('enums.segmentKind.PERSONA'))).toBeVisible();
    expect(screen.getByText(t('businesses.segments.notLinked'))).toBeVisible();
  });

  it('shows AI proposals apart, with the quote that backs them, and confirms one on click', async () => {
    state.rows = [
      row({ id: 'p1', name: 'پیشنهادی', source: 'AI', verified: false, isActive: false, evidence: 'کارمندان با حقوق ثابت' }),
      row(),
    ];
    render(<SegmentsPanel businessId="b1" />);
    expect(screen.getByText(t('businesses.segments.pendingTitle'))).toBeVisible();
    expect(screen.getByText(/کارمندان با حقوق ثابت/)).toBeVisible();
    expect(screen.getByText(t('businesses.segments.ai'))).toBeVisible();
    // a proposal has a confirm button instead of the on/off switch
    const pending = screen.getByText('پیشنهادی').closest('li')!;
    expect(within(pending).queryByRole('switch')).not.toBeInTheDocument();
    await userEvent.click(within(pending).getByRole('button', { name: t('businesses.segments.confirm') }));
    expect(state.confirm.mock.calls[0]![0]).toBe('p1');
  });

  it('asks the model for proposals', async () => {
    render(<SegmentsPanel businessId="b1" />);
    await userEvent.click(screen.getByRole('button', { name: t('businesses.segments.propose') }));
    expect(state.propose).toHaveBeenCalledTimes(1);
  });

  it('has no way to change anything for a reader', () => {
    state.canEdit = false;
    render(<SegmentsPanel businessId="b1" />);
    expect(screen.queryByRole('button', { name: t('businesses.segments.propose') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('businesses.segments.new') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('common.edit') })).not.toBeInTheDocument();
  });
});
