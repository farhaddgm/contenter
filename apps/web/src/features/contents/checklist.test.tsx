import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ContentChecklistItem } from '@contenter/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({ toggle: vi.fn(), pending: false }));

vi.mock('./api/contents', () => ({
  useToggleChecklistItem: () => ({ mutate: state.toggle, isPending: state.pending }),
}));

import { ChecklistCard } from './components/checklist-card';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

const item = (over: Partial<ContentChecklistItem> = {}): ContentChecklistItem => ({
  id: 'g1',
  text: 'لینک بیو عوض شده؟',
  required: true,
  auto: null,
  checked: false,
  checkedAt: null,
  checkedByName: null,
  ...over,
});

const renderCard = (items: ContentChecklistItem[], editable = true) =>
  render(
    <ChecklistCard
      contentId="c1"
      editable={editable}
      checklist={{ items, requiredOpen: items.filter((i) => i.required && !i.checked).length }}
    />,
  );

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.toggle = vi.fn();
  state.pending = false;
});

describe('ChecklistCard', () => {
  it('shows nothing when the business has no checklist', () => {
    const { container } = render(<ChecklistCard contentId="c1" editable checklist={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('marks the required points and says scheduling is blocked while one is open', () => {
    renderCard([item(), item({ id: 'g2', text: 'تصویر مجوز دارد؟', required: false })]);
    expect(screen.getByText(t('contents.checklist.required'))).toBeVisible();
    expect(screen.getByText(t('contents.checklist.open', { count: 1 }))).toBeVisible();
  });

  it('ticks a point', async () => {
    renderCard([item()]);
    await userEvent.click(screen.getByRole('checkbox', { name: /لینک بیو/ }));
    expect(state.toggle.mock.calls[0]![0]).toEqual({ itemId: 'g1', checked: true });
  });

  it('unticks a ticked point and shows who ticked it', async () => {
    renderCard([
      item({ checked: true, checkedAt: new Date().toISOString(), checkedByName: 'سارا' }),
    ]);
    expect(screen.getByText(/سارا/)).toBeVisible();
    expect(screen.queryByText(t('contents.checklist.open', { count: 0 }))).toBeNull();
    await userEvent.click(screen.getByRole('checkbox'));
    expect(state.toggle.mock.calls[0]![0]).toEqual({ itemId: 'g1', checked: false });
  });

  it('does not let a person tick the automatic point', () => {
    renderCard([
      item({
        id: 'q1',
        text: 'بدون هشدار کیفیت',
        required: false,
        auto: 'QUALITY_CLEAN',
        checked: true,
      }),
    ]);
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByText(t('contents.checklist.auto'))).toBeVisible();
  });

  it('is read-only for someone who cannot edit the content, or when it is published', () => {
    renderCard([item()], false);
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });
});
