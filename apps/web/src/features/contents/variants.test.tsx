import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { VariantGroup, VariantItem } from '@contenter/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({
  group: undefined as unknown,
  canEdit: true,
  pick: vi.fn(),
  pickVars: undefined as unknown,
}));

vi.mock('./api/variants', () => ({
  useVariantGroup: () => ({ data: state.group, isLoading: !state.group }),
  usePickVariant: () => ({ mutate: state.pick, isPending: false, variables: state.pickVars }),
}));
vi.mock('@/features/topics/api/topics', () => ({ useCanEditTopic: () => state.canEdit }));

import { VariantsCompare } from './components/variants-compare';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

const item = (id: string, over: Partial<VariantItem> = {}): VariantItem => ({
  id,
  status: 'DRAFT',
  angle: 'DIRECT',
  title: `عنوان ${id}`,
  body: `متن ${id}`,
  hashtags: ['قهوه'],
  cta: '',
  length: 120,
  maxChars: 2200,
  warnings: 0,
  avgSentenceWords: 8.5,
  readabilityNotes: 0,
  similarTo: 0.2,
  ...over,
});
const group = (items: VariantItem[]): VariantGroup => ({ groupId: 'g1', topicId: 't1', items });

const show = () =>
  render(
    <MemoryRouter>
      <VariantsCompare contentId="a" />
    </MemoryRouter>,
  );

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.canEdit = true;
  state.pick = vi.fn();
  state.pickVars = undefined;
  state.group = undefined;
});

describe('VariantsCompare', () => {
  it('shows each draft with its angle and the numbers counted by code', () => {
    state.group = group([
      item('a'),
      item('b', { angle: 'STORY', warnings: 2, similarTo: 0.7 }),
      item('c', { angle: 'QUESTION', length: 3000 }),
    ]);
    show();
    expect(screen.getByText(t('variants.angles.DIRECT'))).toBeVisible();
    expect(screen.getByText(t('variants.angles.STORY'))).toBeVisible();
    expect(screen.getByText(t('variants.angles.QUESTION'))).toBeVisible();
    // draft b: two warnings and 70% similar are flagged
    const warnings = screen.getAllByText(t('variants.warnings'));
    expect(within(warnings[1]!.parentElement!).getByText('۲')).toHaveClass('text-warning');
    expect(screen.getByText('۷۰٪')).toHaveClass('text-warning');
    // draft c is over the platform limit
    expect(screen.getByText('۳٬۰۰۰ / ۲٬۲۰۰')).toHaveClass('text-warning');
  });

  it('chooses the draft that was clicked', async () => {
    state.group = group([item('a'), item('b', { angle: 'STORY' })]);
    show();
    await userEvent.click(screen.getAllByRole('button', { name: t('variants.pick') })[1]!);
    expect(state.pick.mock.calls[0]![0]).toBe('b');
  });

  it('offers no choice while a draft is still being written, and shows it as writing', () => {
    state.group = group([item('a'), item('b', { status: 'GENERATING', body: '', title: '' })]);
    show();
    expect(screen.queryByRole('button', { name: t('variants.pick') })).toBeNull();
    expect(screen.getByText(t('variants.generating'))).toBeVisible();
    expect(screen.getByText(t('variants.stillWriting'))).toBeVisible();
  });

  it('a rejected draft cannot be chosen', () => {
    state.group = group([item('a'), item('b', { status: 'REJECTED' })]);
    show();
    expect(screen.getAllByRole('button', { name: t('variants.pick') })).toHaveLength(1);
  });

  it('someone who cannot edit the topic cannot choose', () => {
    state.canEdit = false;
    state.group = group([item('a'), item('b')]);
    show();
    expect(screen.queryByRole('button', { name: t('variants.pick') })).toBeNull();
  });

  it('a draft whose writing failed says it has no text', () => {
    state.group = group([item('a'), item('b', { status: 'FAILED', body: '', title: '' })]);
    show();
    expect(screen.getByText(t('variants.noText'))).toBeVisible();
  });
});
