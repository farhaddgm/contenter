import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import type { Content, SearchResponse } from '@contenter/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({
  repurpose: vi.fn(),
  listParams: [] as unknown[],
  tags: [] as unknown[],
  search: undefined as unknown,
  searchArgs: [] as unknown[],
}));

vi.mock('./api/contents', () => ({
  useRepurpose: () => ({ mutate: state.repurpose, isPending: false }),
  useContents: (params: unknown) => {
    state.listParams.push(params);
    return {
      data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 },
      isLoading: false,
    };
  },
}));
vi.mock('@/features/tags/api/tags', () => ({
  useTags: () => ({ data: state.tags }),
}));
vi.mock('@/features/campaigns/api/campaigns', () => ({
  useCampaigns: () => ({ data: [{ id: 'k1', name: 'نوروز' }] }),
}));
vi.mock('@/features/search/api/search', () => ({
  MIN_SEARCH_LENGTH: 2,
  useSearch: (q: string) => {
    state.searchArgs.push(q);
    return { data: state.search, isFetching: false };
  },
}));

import { ContentsTable } from './components/contents-table';
import { RepurposeDialog } from './components/repurpose';
import { SearchPage } from '@/features/search/components/search-page';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

const content = (over: Partial<Content> = {}): Content =>
  ({
    id: 'c1',
    title: 'سه اشتباه',
    topicId: 't1',
    format: 'POST',
    platform: null,
    topic: { id: 't1', title: 'سرمایه‌گذاری', platform: 'INSTAGRAM' },
    ...over,
  }) as unknown as Content;

/** Shows the current URL, to assert on what the filters wrote there. */
function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.repurpose = vi.fn();
  state.listParams = [];
  state.tags = [];
  state.search = undefined;
  state.searchArgs = [];
});

describe('RepurposeDialog', () => {
  const open = () => render(<RepurposeDialog content={content()} onClose={vi.fn()} />);

  it('cannot be sent before a platform is chosen', () => {
    open();
    expect(
      screen.getByRole('button', { name: t('repurpose.submit', { count: 0 }) }),
    ).toBeDisabled();
  });

  it('marks the platform the content is already for', () => {
    open();
    const row = screen.getByText(t('enums.platform.INSTAGRAM')).closest('li')!;
    expect(within(row).getByText(t('repurpose.current'))).toBeVisible();
  });

  it('suggests the usual format of each chosen platform and lets it be changed', async () => {
    open();
    await userEvent.click(screen.getByRole('checkbox', { name: t('enums.platform.X') }));
    const format = screen.getByRole('combobox', {
      name: `${t('contents.format')} — ${t('enums.platform.X')}`,
    });
    expect(format).toHaveValue('THREAD');
    await userEvent.selectOptions(format, 'POST');
    expect(format).toHaveValue('POST');
  });

  it('sends every chosen platform with its format and the direction', async () => {
    open();
    await userEvent.click(screen.getByRole('checkbox', { name: t('enums.platform.X') }));
    await userEvent.click(screen.getByRole('checkbox', { name: t('enums.platform.LINKEDIN') }));
    await userEvent.type(screen.getByRole('textbox'), 'رسمی‌تر');
    await userEvent.click(
      screen.getByRole('button', { name: t('repurpose.submit', { count: 2 }) }),
    );
    expect(state.repurpose).toHaveBeenCalledWith(
      {
        targets: [
          { platform: 'X', format: 'THREAD' },
          { platform: 'LINKEDIN', format: 'ARTICLE' },
        ],
        notes: 'رسمی‌تر',
      },
      expect.anything(),
    );
  });

  it('unticking a platform removes it', async () => {
    open();
    const x = screen.getByRole('checkbox', { name: t('enums.platform.X') });
    await userEvent.click(x);
    await userEvent.click(x);
    expect(
      screen.getByRole('button', { name: t('repurpose.submit', { count: 0 }) }),
    ).toBeDisabled();
  });
});

describe('ContentsTable filters', () => {
  const renderAt = (url: string, topicId?: string) =>
    render(
      <MemoryRouter initialEntries={[url]}>
        <ContentsTable topicId={topicId} />
        <Where />
      </MemoryRouter>,
    );
  const lastParams = () => state.listParams.at(-1) as Record<string, unknown>;
  const where = () => screen.getByTestId('where').textContent;

  it('asks the API for what the URL says', () => {
    renderAt(
      '/x?statuses=DRAFT,APPROVED&formats=THREAD&platforms=X&schedule=overdue&sort=title&order=asc',
      't1',
    );
    expect(lastParams()).toMatchObject({
      topicId: 't1',
      statuses: 'DRAFT,APPROVED',
      formats: 'THREAD',
      platforms: 'X',
      schedule: 'overdue',
      sort: 'title',
      order: 'asc',
    });
  });

  it('opens the filter panel by itself when an advanced filter is active, and counts the filters', () => {
    renderAt('/x?formats=POST&platforms=X');
    expect(
      screen.getByRole('button', { name: new RegExp(`^${t('filters.more')}`) }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /۲/ })).toBeVisible();
  });

  it('writes a chosen filter to the URL and starts from page one again', async () => {
    renderAt('/x?page=3');
    await userEvent.click(
      screen.getByRole('button', { name: new RegExp(`^${t('filters.more')}`) }),
    );
    await userEvent.click(screen.getByRole('button', { name: t('enums.contentFormat.THREAD') }));
    expect(where()).toBe('/x?formats=THREAD');
    expect(lastParams()).toMatchObject({ formats: 'THREAD', page: 1 });
  });

  it('widens with a second value of the same filter, and narrows again when it is unticked', async () => {
    renderAt('/x?platforms=X');
    await userEvent.click(screen.getByRole('button', { name: t('enums.platform.TELEGRAM') }));
    expect(where()).toBe('/x?platforms=X%2CTELEGRAM');
    await userEvent.click(screen.getByRole('button', { name: t('enums.platform.X') }));
    expect(where()).toBe('/x?platforms=TELEGRAM');
  });

  it('turns the status shortcut into a one-status filter', async () => {
    renderAt('/x');
    await userEvent.click(screen.getByRole('button', { name: t('enums.contentStatus.IN_REVIEW') }));
    expect(where()).toBe('/x?statuses=IN_REVIEW');
  });

  it('offers tags and campaigns only inside a topic', async () => {
    state.tags = [{ id: 'g1', name: 'فروش', color: 'red' }];
    renderAt('/x?formats=POST', 't1');
    expect(screen.getByRole('button', { name: 'فروش' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: t('campaigns.one') })).toBeVisible();
  });

  it('does not offer tags or campaigns across all topics', () => {
    state.tags = [{ id: 'g1', name: 'فروش', color: 'red' }];
    renderAt('/x?formats=POST');
    expect(screen.queryByRole('combobox', { name: t('campaigns.one') })).toBeNull();
  });

  it('keeps the sorting when the filters are cleared', async () => {
    renderAt('/x?statuses=DRAFT&sort=title&order=asc');
    await userEvent.click(screen.getByRole('button', { name: t('filters.clear') }));
    expect(where()).toBe('/x?sort=title&order=asc');
  });

  it('changes the sort and its direction', async () => {
    renderAt('/x');
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: t('filters.sortBy') }),
      'created',
    );
    expect(where()).toBe('/x?sort=created');
    await userEvent.click(screen.getByRole('button', { name: t('filters.descending') }));
    expect(where()).toBe('/x?sort=created&order=asc');
  });
});

describe('SearchPage', () => {
  const response = (): SearchResponse => ({
    terms: ['علی'],
    contents: [
      {
        id: 'c1',
        title: 'علي و كتاب جديد',
        snippet: 'نظر علي دربارهٔ كتاب',
        topic: { id: 't1', title: 'سرمایه‌گذاری' },
        status: 'DRAFT',
        format: 'POST',
        platform: 'INSTAGRAM',
        tags: [],
        score: 9,
      },
    ],
    ideas: [
      {
        id: 'i1',
        title: 'ایدهٔ علی',
        snippet: '',
        topic: { id: 't1', title: 'سرمایه‌گذاری' },
        status: 'PROPOSED',
        score: 4,
      },
    ],
    topics: [],
  });

  const renderAt = (url: string) =>
    render(
      <MemoryRouter initialEntries={[url]}>
        <SearchPage />
      </MemoryRouter>,
    );

  it('asks for nothing while the query is too short', () => {
    renderAt('/search?q=ا');
    expect(screen.getByText(t('search.hint'))).toBeVisible();
  });

  it('shows the hits grouped, linked, and highlighted across Arabic/Persian spellings', () => {
    state.search = response();
    renderAt('/search?q=علی');
    expect(state.searchArgs.at(-1)).toBe('علی');
    const marks = [...document.querySelectorAll('mark')].map((m) => m.textContent);
    // the data says علي, the query says علی: both are marked
    expect(marks).toContain('علي');
    // each hit is a link to its page; the title text still reads whole across the marks
    const contentLink = document.querySelector('a[href="/app/contents/c1"]')!;
    expect(contentLink).toHaveTextContent('علي و كتاب جديد');
    const ideaLink = document.querySelector('a[href="/app/topics/t1/ideas"]')!;
    expect(ideaLink).toHaveTextContent('ایدهٔ علی');
    expect(screen.getByText(t('search.contents'))).toBeVisible();
    expect(screen.queryByText(t('search.topics'))).toBeNull();
  });

  it('says so when nothing matches', () => {
    state.search = { terms: ['x'], contents: [], ideas: [], topics: [] };
    renderAt('/search?q=چیزی');
    expect(screen.getByText(t('search.none', { q: 'چیزی' }))).toBeVisible();
  });
});
