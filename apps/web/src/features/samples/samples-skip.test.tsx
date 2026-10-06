import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { Topic } from '@contenter/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({
  topic: undefined as unknown,
  canEdit: true,
  samples: [] as unknown[],
  mutate: vi.fn(),
}));

vi.mock('@/features/topics/api/topics', () => ({
  useTopic: () => ({ data: state.topic }),
  useCanEditTopic: () => state.canEdit,
  useSetSamplesSkipped: () => ({ mutate: state.mutate, isPending: false }),
}));
vi.mock('./api/samples', () => ({
  useSamples: () => ({ data: state.samples, isLoading: false }),
  useAnalyzeSample: () => ({ mutate: vi.fn(), isPending: false }),
  useRefetchSample: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteSample: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateSample: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('./components/add-sample', () => ({ AddSampleDrawer: () => null }));

import { SamplesPanel } from './components/samples-panel';
import { TopicOverview } from '@/features/topics/components/topic-overview';

const t = (key: Parameters<typeof translate>[1]) => translate('fa', key);

const topic = (samplesSkippedAt: string | null): Topic =>
  ({
    id: 't1',
    title: 'Topic',
    description: 'desc',
    audience: '',
    activeProfileId: null,
    samplesSkippedAt,
    _count: { samples: 0, ideas: 0, contents: 0, profiles: 0 },
  }) as unknown as Topic;

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.canEdit = true;
  state.samples = [];
  state.mutate = vi.fn();
});

describe('SamplesPanel — optional step', () => {
  it('offers to skip an empty, not yet skipped step', async () => {
    state.topic = topic(null);
    render(<SamplesPanel topicId="t1" />);
    const skip = screen.getByRole('button', { name: t('samples.skip') });
    await userEvent.click(skip);
    expect(state.mutate).toHaveBeenCalledWith(true, expect.anything());
    expect(screen.queryByText(t('samples.skippedTitle'))).not.toBeInTheDocument();
  });

  it('shows the skipped state and lets the admin undo it', async () => {
    state.topic = topic('2026-10-06T00:00:00.000Z');
    render(<SamplesPanel topicId="t1" />);
    expect(screen.getByText(t('samples.skippedTitle'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('samples.skip') })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: t('samples.resume') }));
    expect(state.mutate).toHaveBeenCalledWith(false, expect.anything());
  });

  it('hides the skip action from users who cannot edit the project', () => {
    state.topic = topic(null);
    state.canEdit = false;
    render(<SamplesPanel topicId="t1" />);
    expect(screen.queryByRole('button', { name: t('samples.skip') })).not.toBeInTheDocument();
  });

  it('does not offer skipping once samples exist', () => {
    state.topic = topic(null);
    state.samples = [
      {
        id: 's1',
        url: 'https://example.com/post',
        platform: 'WEB',
        mediaType: 'ARTICLE',
        fetchStatus: 'FETCHED',
        analysisStatus: 'PENDING',
        createdAt: '2026-10-06T00:00:00.000Z',
        fetched: null,
        analysis: null,
        manualText: 'text',
        adminNote: '',
      },
    ];
    render(<SamplesPanel topicId="t1" />);
    expect(screen.getByText('https://example.com/post')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('samples.skip') })).not.toBeInTheDocument();
  });
});

describe('TopicOverview — checklist', () => {
  // the label is preceded by its number inside one element
  const byLabel = (label: string) => screen.getByText((content) => content.includes(label));

  const renderOverview = (samplesSkippedAt: string | null) =>
    render(
      <MemoryRouter>
        <TopicOverview topic={topic(samplesSkippedAt)} />
      </MemoryRouter>,
    );

  it('marks both sample steps as skipped and moves on to the profile', () => {
    renderOverview('2026-10-06T00:00:00.000Z');
    expect(screen.getAllByText(t('topics.steps.skipped'))).toHaveLength(2);
    // the highlighted "next" step is the profile, not the samples
    const profile = byLabel(t('topics.steps.profile')).closest('a');
    expect(profile?.className).toContain('ring-primary');
  });

  it('keeps the sample step as the next one without a skip', () => {
    renderOverview(null);
    expect(screen.queryByText(t('topics.steps.skipped'))).not.toBeInTheDocument();
    const samples = byLabel(t('topics.steps.samples')).closest('a');
    expect(samples?.className).toContain('ring-primary');
  });
});
