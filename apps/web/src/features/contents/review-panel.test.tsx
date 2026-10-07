import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Content, ReviewAction } from '@contenter/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock('./api/contents', () => ({
  useReviewAction: () => ({ mutate: state.mutate, isPending: false }),
}));

import { ReviewActionButtons, ReviewTimelineCard } from './components/review-panel';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

const content = (over: Partial<Content> & { actions?: ReviewAction[]; final?: boolean }): Content =>
  ({
    id: 'c1',
    status: 'IN_REVIEW',
    reviewStage: 'EDITORIAL',
    submittedBy: { id: 'u1', name: 'سارا' },
    review: { actions: over.actions ?? [], requireFinalApproval: over.final ?? true },
    reviews: [],
    ...over,
  }) as unknown as Content;

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.mutate = vi.fn();
});

describe('ReviewActionButtons', () => {
  it('shows exactly the actions the server allows', () => {
    render(<ReviewActionButtons content={content({ actions: ['approve', 'withdraw'] })} />);
    expect(
      screen.getByRole('button', { name: t('review.actions.approveEditorial') }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: t('review.actions.withdraw') })).toBeVisible();
    expect(screen.queryByRole('button', { name: t('review.actions.reject') })).toBeNull();
  });

  it('calls the approval at the final stage "final approval"', () => {
    render(
      <ReviewActionButtons content={content({ reviewStage: 'FINAL', actions: ['approve'] })} />,
    );
    expect(screen.getByRole('button', { name: t('review.actions.approveFinal') })).toBeVisible();
  });

  it('a one-stage flow calls the editor approval the final one', () => {
    render(<ReviewActionButtons content={content({ final: false, actions: ['approve'] })} />);
    expect(screen.getByRole('button', { name: t('review.actions.approveFinal') })).toBeVisible();
  });

  it('runs a step without a note right away', async () => {
    render(
      <ReviewActionButtons
        content={content({ status: 'DRAFT', reviewStage: null, actions: ['submit'] })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: t('review.actions.submit') }));
    expect(state.mutate).toHaveBeenCalledWith(
      { action: 'submit', note: undefined },
      expect.anything(),
    );
  });

  it('asks for a reason before requesting changes', async () => {
    render(<ReviewActionButtons content={content({ actions: ['request_changes'] })} />);
    await userEvent.click(
      screen.getByRole('button', { name: t('review.actions.request_changes') }),
    );
    expect(state.mutate).not.toHaveBeenCalled();

    const send = (
      await screen.findAllByRole('button', { name: t('review.actions.request_changes') })
    ).at(-1)!;
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox'), 'لحن را رسمی‌تر کنید');
    expect(send).toBeEnabled();
    await userEvent.click(send);
    expect(state.mutate).toHaveBeenCalledWith(
      { action: 'request_changes', note: 'لحن را رسمی‌تر کنید' },
      expect.anything(),
    );
  });
});

describe('ReviewTimelineCard', () => {
  it('says who the content waits for and lists the history with notes', () => {
    render(
      <ReviewTimelineCard
        content={content({
          reviews: [
            {
              id: 'r1',
              contentId: 'c1',
              versionId: 'v1',
              stage: 'EDITORIAL',
              decision: 'CHANGES_REQUESTED',
              note: 'مثال واقعی اضافه کنید',
              createdAt: '2026-10-08T10:00:00.000Z',
              actor: { id: 'u2', name: 'رضا' },
            },
          ],
        })}
      />,
    );
    expect(screen.getByText(t('review.waitingFor.EDITORIAL', { name: 'سارا' }))).toBeVisible();
    expect(screen.getByText('رضا')).toBeVisible();
    expect(screen.getByText('مثال واقعی اضافه کنید')).toBeVisible();
  });

  it('renders nothing for a draft that was never reviewed', () => {
    const { container } = render(
      <ReviewTimelineCard content={content({ status: 'DRAFT', reviewStage: null })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
