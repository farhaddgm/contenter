import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({
  topic: undefined as unknown,
  offerings: [] as unknown[],
  segments: [] as unknown[],
}));

vi.mock('./api/topics', () => ({ useTopic: () => ({ data: state.topic }) }));
vi.mock('@/features/businesses/api/offerings', () => ({
  useOfferings: () => ({ data: state.offerings, isLoading: false }),
}));
vi.mock('@/features/businesses/api/segments', () => ({
  useSegments: () => ({ data: state.segments, isLoading: false }),
}));

import { useFocusOptions } from '@/features/businesses/api/focus';
import { FocusNote } from './components/focus-note';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

const off = (over: Record<string, unknown>) => ({
  id: 'o',
  name: 'x',
  verified: true,
  isActive: true,
  parentId: null,
  segments: [],
  ...over,
});

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.topic = undefined;
  state.offerings = [];
  state.segments = [];
});

describe('FocusNote', () => {
  it('says nothing for a project without a focus', () => {
    state.topic = { id: 't1', businessId: 'b1', offering: null, segment: null };
    const { container } = render(<FocusNote topicId="t1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the offering and the audience, and what convinces them', () => {
    state.topic = {
      id: 't1',
      businessId: 'b1',
      segmentId: 's1',
      offering: { id: 'o1', name: 'تسهیلات تجهیزات' },
      segment: { id: 's1', name: 'کارمند' },
    };
    state.segments = [{ id: 's1', name: 'کارمند', kind: 'PERSONA', isActive: true, messageAngle: ' بدون وثیقه ' }];
    render(<FocusNote topicId="t1" />);
    expect(screen.getByText(t('contents.focusFor', { names: 'تسهیلات تجهیزات · کارمند' }))).toBeVisible();
    expect(screen.getByText(t('contents.focusAngle', { angle: 'بدون وثیقه' }))).toBeVisible();
  });

  it('works with an offering alone', () => {
    state.topic = { id: 't1', businessId: 'b1', offering: { id: 'o1', name: 'بیمه' }, segment: null };
    render(<FocusNote topicId="t1" />);
    expect(screen.getByText(t('contents.focusFor', { names: 'بیمه' }))).toBeVisible();
    expect(screen.queryByText(/پیام قانع‌کننده/)).not.toBeInTheDocument();
  });
});

describe('useFocusOptions', () => {
  function Probe({ current }: { current?: { offeringId?: string; segmentId?: string } }) {
    const o = useFocusOptions('b1', current);
    return (
      <>
        <ul aria-label="offerings">
          {o.offeringOptions.map((x) => (
            <li key={x.value}>{x.label}</li>
          ))}
        </ul>
        <ul aria-label="segments">
          {o.segmentOptions.map((x) => (
            <li key={x.value}>{x.label}</li>
          ))}
        </ul>
      </>
    );
  }

  it('lists confirmed, active offerings with variants under their line, and active audiences', () => {
    state.offerings = [
      off({ id: 'v', name: 'گونه', parentId: 'l' }),
      off({ id: 'l', name: 'خط' }),
      off({ id: 'p', name: 'پیشنهادی', verified: false }),
      off({ id: 'x', name: 'خاموش', isActive: false }),
    ];
    state.segments = [
      { id: 's1', name: 'کارمند', kind: 'PERSONA', isActive: true },
      { id: 's2', name: 'خاموش', kind: 'MARKET', isActive: false },
    ];
    render(<Probe />);
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['خط', '— گونه', `کارمند (${t('enums.segmentKind.PERSONA')})`]);
  });

  it('keeps the one already chosen, even if it was switched off', () => {
    state.offerings = [off({ id: 'x', name: 'خاموش', isActive: false })];
    state.segments = [{ id: 's2', name: 'قدیمی', kind: 'MARKET', isActive: false }];
    render(<Probe current={{ offeringId: 'x', segmentId: 's2' }} />);
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['خاموش', `قدیمی (${t('enums.segmentKind.MARKET')})`]);
  });
});
