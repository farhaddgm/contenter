import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { GoldenList } from '@contenter/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({
  list: undefined as unknown,
  set: vi.fn(),
}));

vi.mock('./api/golden', () => ({
  useGoldenExamples: () => ({ data: state.list, isLoading: !state.list }),
  useSetGolden: () => ({ mutate: state.set, isPending: false }),
}));

import { GoldenCard } from './components/golden-card';
import { GoldenExamplesCard } from './components/golden-examples-card';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

const asRole = (role: 'ADMIN' | 'EDITOR') =>
  useAuthStore.setState({ user: { id: 'u1', role } as never, accessToken: 'x' });

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.set = vi.fn();
  state.list = undefined;
});

describe('GoldenCard', () => {
  it('is hidden from everyone but admins', () => {
    asRole('EDITOR');
    const { container } = render(<GoldenCard contentId="c1" goldenAt={null} approved />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is hidden for content that is neither approved nor already marked', () => {
    asRole('ADMIN');
    const { container } = render(<GoldenCard contentId="c1" goldenAt={null} approved={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('marks approved content', async () => {
    asRole('ADMIN');
    render(<GoldenCard contentId="c1" goldenAt={null} approved />);
    await userEvent.click(screen.getByRole('button', { name: t('golden.mark') }));
    expect(state.set.mock.calls[0]![0]).toBe(true);
  });

  it('a marked content can always be unmarked, even when it is no longer approved', async () => {
    asRole('ADMIN');
    render(<GoldenCard contentId="c1" goldenAt="2026-10-10T00:00:00.000Z" approved={false} />);
    expect(screen.getByText(t('golden.isGolden'))).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: t('golden.remove') }));
    expect(state.set.mock.calls[0]![0]).toBe(false);
  });
});

const list = (over: Partial<GoldenList> = {}): GoldenList => ({
  maxExamples: 2,
  maxChars: 1500,
  items: [
    {
      id: 'c1',
      topicId: 't1',
      title: 'پست چای',
      platform: 'INSTAGRAM',
      format: 'POST',
      goldenAt: new Date().toISOString(),
      excerpt: 'چای تازه دم',
      eligible: true,
    },
    {
      id: 'c2',
      topicId: 't1',
      title: 'برگشته',
      platform: 'X',
      format: 'THREAD',
      goldenAt: new Date().toISOString(),
      excerpt: '',
      eligible: false,
    },
  ],
  ...over,
});

const show = () =>
  render(
    <MemoryRouter>
      <GoldenExamplesCard businessId="b1" />
    </MemoryRouter>,
  );

describe('GoldenExamplesCard', () => {
  it('lists the examples with a link, and flags the ones that would not be sent', () => {
    state.list = list();
    show();
    expect(screen.getByRole('link', { name: 'پست چای' })).toHaveAttribute(
      'href',
      '/app/contents/c1',
    );
    expect(screen.getByText('چای تازه دم')).toBeVisible();
    expect(screen.getAllByText(t('golden.notEligible'))).toHaveLength(1);
  });

  it('says so when nothing is marked or when the feature is off', () => {
    state.list = list({ items: [] });
    const { unmount } = show();
    expect(screen.getByText(t('golden.empty'))).toBeVisible();
    unmount();
    state.list = list({ maxExamples: 0 });
    show();
    expect(screen.getByText(t('golden.off'))).toBeVisible();
  });
});
