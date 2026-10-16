import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import {
  EditCategory,
  type EditLearningOverview,
  type LearningSuggestion,
} from '@contenter/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { en } from '@/i18n/en';
import { fa } from '@/i18n/fa';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({
  overview: undefined as unknown,
  canEdit: true,
  tracker: { job: undefined as unknown, isRunning: false },
  trackedJobId: undefined as unknown,
  analyze: vi.fn(),
  accept: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock('./api/edit-learning', () => ({
  editLearningKeys: { overview: (id: string) => ['edit-learning', id] },
  useEditLearning: () => ({ data: state.overview, isLoading: !state.overview }),
  useAnalyzeEdits: () => ({ mutate: state.analyze, isPending: false }),
  useAcceptSuggestion: () => ({ mutate: state.accept, isPending: false }),
  useDismissSuggestion: () => ({ mutate: state.dismiss, isPending: false }),
}));
vi.mock('@/features/topics/api/topics', () => ({ useCanEditTopic: () => state.canEdit }));
vi.mock('@/features/jobs/api/jobs', () => ({
  useTrackJob: (id: unknown) => {
    state.trackedJobId = id;
    return state.tracker;
  },
}));

import { EditLearningPanel } from './components/edit-learning-panel';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

const suggestion = (over: Partial<LearningSuggestion> = {}): LearningSuggestion => ({
  id: 's1',
  topicId: 't1',
  runId: 'r1',
  kind: 'AVOID',
  category: 'OPENING',
  text: 'مقدمه را با احوال‌پرسی شروع نکن',
  rationale: 'ویراستارها در چند محتوا جملهٔ آغازین را حذف کرده‌اند.',
  evidence: [
    {
      contentId: 'c1',
      contentTitle: 'سه اشتباه رایج',
      fromVersion: 1,
      toVersion: 2,
      changeRatio: 0.12,
      excerpt: '{-سلام دوستان-} {+امروز+}',
    },
    {
      contentId: 'c2',
      contentTitle: 'پنج راه ساده',
      fromVersion: 1,
      toVersion: 3,
      changeRatio: 0.08,
      excerpt: '{-سلام-}',
    },
  ],
  status: 'PENDING',
  principleId: null,
  decidedAt: null,
  createdAt: '2026-10-13T10:00:00.000Z',
  ...over,
});

const overview = (over: Partial<EditLearningOverview> = {}): EditLearningOverview => ({
  stats: { approved: 10, edited: 8, unedited: 2, uneditedShare: 0.2 },
  minPairs: 6,
  eligible: true,
  activeJob: null,
  lastRunAt: null,
  pending: [],
  decided: [],
  ...over,
});

const renderPanel = () =>
  render(
    <MemoryRouter>
      <EditLearningPanel topicId="t1" />
    </MemoryRouter>,
  );

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.overview = overview();
  state.canEdit = true;
  state.tracker = { job: undefined, isRunning: false };
  state.trackedJobId = undefined;
  state.analyze = vi.fn();
  state.accept = vi.fn();
  state.dismiss = vi.fn();
});

describe('EditLearningPanel', () => {
  it('shows the numbers counted by the server', () => {
    renderPanel();
    expect(screen.getByText(t('editLearning.approved'))).toBeVisible();
    expect(screen.getByText('۱۰')).toBeVisible();
    expect(screen.getByText('۸')).toBeVisible();
    expect(screen.getByText(/۲ \(۲۰٪\)/)).toBeVisible();
  });

  it('asks for more edited contents instead of offering the analysis, when there are too few', () => {
    state.overview = overview({
      eligible: false,
      stats: { approved: 3, edited: 2, unedited: 1, uneditedShare: 1 / 3 },
    });
    renderPanel();
    expect(screen.getByRole('button', { name: t('editLearning.analyze') })).toBeDisabled();
    expect(screen.getByText(t('editLearning.notEnough', { min: 6, edited: 2 }))).toBeVisible();
  });

  it('starts the analysis', async () => {
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: t('editLearning.analyze') }));
    expect(state.analyze).toHaveBeenCalledTimes(1);
  });

  it('waits for a running analysis instead of letting it start twice', () => {
    state.overview = overview({ activeJob: { id: 'j1', status: 'RUNNING' } });
    state.tracker = { job: { status: 'RUNNING' }, isRunning: true };
    renderPanel();
    expect(state.trackedJobId).toBe('j1');
    expect(screen.getByText(t('editLearning.working'))).toBeVisible();
    expect(screen.getByRole('button', { name: t('editLearning.analyze') })).toBeDisabled();
  });

  it('says so when an analysis found no clear pattern', () => {
    state.overview = overview({ lastRunAt: '2026-10-13T10:00:00.000Z' });
    renderPanel();
    expect(screen.getByText(t('editLearning.nothingFound'))).toBeVisible();
  });

  it('shows a suggestion with its kind, category, rationale and evidence', async () => {
    state.overview = overview({ pending: [suggestion()] });
    renderPanel();
    expect(screen.getByDisplayValue('مقدمه را با احوال‌پرسی شروع نکن')).toBeVisible();
    expect(screen.getByText(t('editLearning.categories.OPENING'))).toBeVisible();
    expect(screen.getByText(t('editLearning.seenIn', { count: 2 }))).toBeVisible();
    await userEvent.click(screen.getByText(t('editLearning.evidence')));
    const link = screen.getByRole('link', { name: 'سه اشتباه رایج' });
    expect(link).toHaveAttribute('href', '/app/contents/c1');
    expect(screen.getByText('{-سلام دوستان-} {+امروز+}')).toBeVisible();
  });

  it('accepts as it is: no text or kind is sent when nothing was changed', async () => {
    state.overview = overview({ pending: [suggestion()] });
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: t('editLearning.accept') }));
    expect(state.accept.mock.calls[0]![0]).toEqual({ id: 's1', data: {} });
  });

  it('accepts what the admin reworded and the kind they chose', async () => {
    state.overview = overview({ pending: [suggestion()] });
    renderPanel();
    const box = screen.getByDisplayValue('مقدمه را با احوال‌پرسی شروع نکن');
    await userEvent.clear(box);
    await userEvent.type(box, 'مقدمه کوتاه باشد');
    await userEvent.selectOptions(screen.getByRole('combobox'), 'PREFER');
    await userEvent.click(screen.getByRole('button', { name: t('editLearning.accept') }));
    expect(state.accept.mock.calls[0]![0]).toEqual({
      id: 's1',
      data: { text: 'مقدمه کوتاه باشد', kind: 'PREFER' },
    });
  });

  it('dismisses a suggestion', async () => {
    state.overview = overview({ pending: [suggestion()] });
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: t('editLearning.dismiss') }));
    expect(state.dismiss.mock.calls[0]![0]).toBe('s1');
  });

  it('shows no buttons to someone who may only read the topic', () => {
    state.canEdit = false;
    state.overview = overview({ pending: [suggestion()] });
    renderPanel();
    expect(screen.queryByRole('button', { name: t('editLearning.analyze') })).toBeNull();
    expect(screen.queryByRole('button', { name: t('editLearning.accept') })).toBeNull();
    expect(screen.getByText('مقدمه را با احوال‌پرسی شروع نکن')).toBeVisible();
  });

  it('lists the earlier decisions', async () => {
    state.overview = overview({
      decided: [
        suggestion({ id: 's2', status: 'ACCEPTED', text: 'جمله‌ها کوتاه باشند' }),
        suggestion({ id: 's3', status: 'DISMISSED', text: 'ایموجی نگذار' }),
      ],
    });
    renderPanel();
    await userEvent.click(screen.getByText(t('editLearning.decided', { count: 2 })));
    const list = screen.getByText('جمله‌ها کوتاه باشند').closest('ul')!;
    expect(within(list).getByText(t('editLearning.status.ACCEPTED'))).toBeVisible();
    expect(within(list).getByText(t('editLearning.status.DISMISSED'))).toBeVisible();
  });
});

describe('edit learning texts', () => {
  it('has a name in both languages for every category the server can send', () => {
    for (const category of EditCategory) {
      expect(fa.editLearning.categories[category]).toBeTruthy();
      expect(en.editLearning.categories[category]).toBeTruthy();
    }
  });

  it('names the new AI job in both languages', () => {
    expect(fa.enums.jobType.LEARN_FROM_EDITS).toBeTruthy();
    expect(en.enums.jobType.LEARN_FROM_EDITS).toBeTruthy();
  });
});
