import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FeedbackSummary, MyFeedback } from '@contenter/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({
  mine: [] as unknown[],
  summary: undefined as unknown,
  set: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('./api/feedback', () => ({
  useMyFeedback: () => ({ data: state.mine }),
  useSetFeedback: () => ({ mutate: state.set, isPending: false }),
  useRemoveFeedback: () => ({ mutate: state.remove, isPending: false }),
  useFeedbackSummary: () => ({ data: state.summary, isLoading: !state.summary }),
}));

import { FeedbackButtons } from './components/feedback-buttons';
import { FeedbackSummaryCard } from './components/feedback-summary-card';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

const mineOf = (rating: 'UP' | 'DOWN', reason: MyFeedback['reason'] = null): MyFeedback => ({
  targetType: 'CONTENT_VERSION',
  targetId: 'v1',
  rating,
  reason,
  note: '',
  updatedAt: '2026-10-14T00:00:00.000Z',
});

const renderButtons = () =>
  render(<FeedbackButtons targetType="CONTENT_VERSION" targetId="v1" topicId="t1" />);

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.mine = [];
  state.summary = undefined;
  state.set = vi.fn();
  state.remove = vi.fn();
});

describe('FeedbackButtons', () => {
  it('sends a thumbs-up straight away', async () => {
    renderButtons();
    await userEvent.click(screen.getByRole('button', { name: t('feedback.up') }));
    expect(state.set.mock.calls[0]![0]).toEqual({ targetId: 'v1', rating: 'UP' });
  });

  it('a second click on the same thumb takes the vote back', async () => {
    state.mine = [mineOf('UP')];
    renderButtons();
    const up = screen.getByRole('button', { name: t('feedback.up') });
    expect(up).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(up);
    expect(state.remove.mock.calls[0]![0]).toBe('v1');
    expect(state.set).not.toHaveBeenCalled();
  });

  it('a thumbs-down asks for a reason first and sends it with the note', async () => {
    renderButtons();
    await userEvent.click(screen.getByRole('button', { name: t('feedback.down') }));
    expect(state.set).not.toHaveBeenCalled();
    await userEvent.selectOptions(screen.getByLabelText(t('feedback.reason')), 'TONE');
    await userEvent.type(screen.getByLabelText(t('feedback.note')), '  خیلی رسمی  ');
    await userEvent.click(screen.getByRole('button', { name: t('feedback.send') }));
    expect(state.set.mock.calls[0]![0]).toEqual({
      targetId: 'v1',
      rating: 'DOWN',
      reason: 'TONE',
      note: 'خیلی رسمی',
    });
  });

  it('a thumbs-down can be sent without a reason', async () => {
    renderButtons();
    await userEvent.click(screen.getByRole('button', { name: t('feedback.down') }));
    await userEvent.click(screen.getByRole('button', { name: t('feedback.send') }));
    expect(state.set.mock.calls[0]![0]).toMatchObject({ rating: 'DOWN', reason: null });
  });

  it('shows the saved reason when the form is opened again', async () => {
    state.mine = [mineOf('DOWN', 'TOO_LONG')];
    renderButtons();
    // a saved 👎 is pressed; the first click removes it
    const down = screen.getByRole('button', { name: t('feedback.down') });
    expect(down).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(down);
    expect(state.remove.mock.calls[0]![0]).toBe('v1');
  });
});

describe('FeedbackSummaryCard', () => {
  it('says so when there are no votes', () => {
    state.summary = {
      days: 90,
      total: 0,
      up: 0,
      down: 0,
      downShare: null,
      byPrompt: [],
      byReason: [],
      recentNotes: [],
    } satisfies FeedbackSummary;
    render(<FeedbackSummaryCard />);
    expect(screen.getByText(t('feedback.summary.none'))).toBeVisible();
  });

  it('shows the counts, the prompt table, the reasons and the notes', () => {
    state.summary = {
      days: 90,
      total: 10,
      up: 6,
      down: 4,
      downShare: 0.4,
      byPrompt: [
        {
          type: 'GENERATE_CONTENT',
          promptKey: 'generate_content',
          promptVersion: 3,
          model: 'gpt-x',
          up: 6,
          down: 4,
        },
      ],
      byReason: [{ reason: 'TONE', count: 3 }],
      recentNotes: [
        {
          id: 'f1',
          targetType: 'CONTENT_VERSION',
          targetId: 'v1',
          topicId: 't1',
          reason: 'TONE',
          note: 'لحن سرد است',
          createdAt: '2026-10-13T00:00:00.000Z',
        },
      ],
    } satisfies FeedbackSummary;
    render(<FeedbackSummaryCard />);
    expect(screen.getByText('generate_content v3')).toBeVisible();
    expect(screen.getByText('gpt-x')).toBeVisible();
    expect(screen.getByText(/لحن سرد است/)).toBeVisible();
    // the reason shows as a chip and again beside the note
    expect(screen.getAllByText(new RegExp(t('feedback.reasons.TONE')))).toHaveLength(2);
  });
});
