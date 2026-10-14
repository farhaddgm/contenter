import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChecklistTemplate } from '@contenter/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({
  data: [] as unknown,
  canEdit: true,
  save: vi.fn(),
}));

vi.mock('./api/checklists', () => ({
  useChecklists: () => ({ data: state.data, isLoading: !state.data }),
  useSaveChecklists: () => ({ mutate: state.save, isPending: false }),
}));
vi.mock('./api/businesses', () => ({ useCanEditBusiness: () => state.canEdit }));

import { ChecklistsCard } from './components/checklists-card';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

const saved: ChecklistTemplate[] = [
  {
    platform: null,
    items: [
      { id: 'g1', text: 'لینک بیو عوض شده؟', required: true, auto: null },
      { id: 'g2', text: 'تصویر مجوز دارد؟', required: false, auto: null },
    ],
  },
];

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.data = saved;
  state.canEdit = true;
  state.save = vi.fn();
});

describe('ChecklistsCard', () => {
  it('shows the points of the saved checklist', () => {
    render(<ChecklistsCard businessId="b1" />);
    expect(screen.getByDisplayValue('لینک بیو عوض شده؟')).toBeVisible();
    expect(
      screen.getByText(t('businesses.checklists.allPlatforms'), { selector: 'h3' }),
    ).toBeVisible();
  });

  it('saves the edited text and keeps the id of the points that had one', async () => {
    render(<ChecklistsCard businessId="b1" />);
    const box = screen.getByDisplayValue('تصویر مجوز دارد؟');
    await userEvent.clear(box);
    await userEvent.type(box, 'مجوز تصویر گرفته شده؟');
    await userEvent.click(screen.getByRole('button', { name: t('common.save') }));
    expect(state.save.mock.calls[0]![0]).toEqual({
      templates: [
        {
          platform: null,
          items: [
            { id: 'g1', text: 'لینک بیو عوض شده؟', required: true, auto: null },
            { id: 'g2', text: 'مجوز تصویر گرفته شده؟', required: false, auto: null },
          ],
        },
      ],
    });
  });

  it('adds a point and a checklist for a platform, and drops empty points when saving', async () => {
    const { container } = render(<ChecklistsCard businessId="b1" />);
    await userEvent.click(
      screen.getByRole('button', { name: t('businesses.checklists.addPoint') }),
    );
    // the new, empty point is not sent
    await userEvent.selectOptions(
      screen.getByLabelText(t('businesses.checklists.addFor')),
      'INSTAGRAM',
    );
    await userEvent.click(
      screen.getByRole('button', { name: t('businesses.checklists.addChecklist') }),
    );
    const sections = container.querySelectorAll('section');
    expect(sections).toHaveLength(2);
    const inputs = within(sections[1]!).getAllByRole('textbox');
    await userEvent.type(inputs[0]!, 'کاور مربعی است؟');
    await userEvent.click(screen.getByRole('button', { name: t('common.save') }));
    const sent = state.save.mock.calls[0]![0] as {
      templates: { platform: string | null; items: unknown[] }[];
    };
    expect(sent.templates.map((x) => [x.platform, x.items.length])).toEqual([
      [null, 2],
      ['INSTAGRAM', 1],
    ]);
  });

  it('turning a point to required turns the automatic option off, and the other way round', async () => {
    render(<ChecklistsCard businessId="b1" />);
    const switches = screen.getAllByRole('switch');
    // second point: required off, auto off → make it automatic, then it cannot be required
    await userEvent.click(switches[3]!);
    expect(switches[2]).toBeDisabled();
    // first point is required, so its automatic option is disabled
    expect(switches[1]).toBeDisabled();
  });

  it('is read-only without edit access', () => {
    state.canEdit = false;
    render(<ChecklistsCard businessId="b1" />);
    expect(screen.getByDisplayValue('لینک بیو عوض شده؟')).toBeDisabled();
    expect(screen.queryByRole('button', { name: t('common.save') })).toBeNull();
  });
});
