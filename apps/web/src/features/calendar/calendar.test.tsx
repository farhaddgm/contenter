import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { CalendarItem, CalendarResponse } from '@contenter/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUi } from '@/stores/ui';
import { toLocalInput } from '@/utils/calendar';

const state = vi.hoisted(() => ({
  data: { items: [], ready: [] } as CalendarResponse,
  params: [] as unknown[],
  schedule: vi.fn(),
}));

vi.mock('./api/calendar', () => ({
  useCalendar: (p: unknown) => {
    state.params.push(p);
    return { data: state.data, isLoading: false };
  },
  useScheduleAny: () => ({ mutate: state.schedule, isPending: false }),
  useSchedule: () => ({ mutate: vi.fn(), isPending: false }),
  usePublish: () => ({ mutate: vi.fn(), isPending: false }),
  useUnpublish: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/topics/api/topics', () => ({
  useTopics: () => ({ data: { items: [{ id: 't1', title: 'سرمایه‌گذاری' }] } }),
  useCanEditTopic: () => true,
}));
vi.mock('@/features/campaigns/api/campaigns', () => ({ useCampaigns: () => ({ data: [] }) }));

import { CalendarView } from './components/calendar-view';

const item = (over: Partial<CalendarItem>): CalendarItem => ({
  id: 'c1',
  title: 'سه اشتباه رایج',
  format: 'POST',
  status: 'APPROVED',
  topic: { id: 't1', title: 'سرمایه‌گذاری', platform: 'INSTAGRAM' },
  platform: 'INSTAGRAM',
  campaign: null,
  tags: [],
  scheduledAt: new Date(2026, 9, 10, 9, 30).toISOString(),
  publishedAt: null,
  publishedUrl: null,
  state: 'SCHEDULED',
  ...over,
});

/** A minimal DataTransfer, which jsdom does not have. */
function transfer() {
  const data: Record<string, string> = {};
  return {
    setData: (k: string, v: string) => void (data[k] = v),
    getData: (k: string) => data[k] ?? '',
    get types() {
      return Object.keys(data);
    },
    effectAllowed: 'none',
  };
}

/** The month heading; ICU puts the Persian year before or after the month depending on version. */
const expectTitle = (month: string, year: string) => {
  const h = screen.getByRole('heading', { level: 2 });
  expect(h).toHaveTextContent(month);
  expect(h).toHaveTextContent(year);
};

const cell = (key: string) => document.querySelector<HTMLElement>(`[data-day="${key}"]`)!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 7, 12, 0));
  useUi.setState({ lang: 'fa' });
  state.data = { items: [], ready: [] };
  state.params = [];
  state.schedule = vi.fn();
});
afterEach(() => vi.useRealTimers());

const renderView = () =>
  render(
    <MemoryRouter>
      <CalendarView />
    </MemoryRouter>,
  );

describe('CalendarView', () => {
  it('shows the Persian month with whole weeks and asks for exactly that range', () => {
    renderView();
    expectTitle('مهر', '۱۴۰۵');
    expect(document.querySelectorAll('[data-day]')).toHaveLength(35);
    const params = state.params.at(-1) as { from: string; to: string };
    expect(new Date(params.from)).toEqual(new Date(2026, 8, 19));
    expect(new Date(params.to)).toEqual(new Date(2026, 9, 24));
  });

  it('puts a planned content on its day, with its time', () => {
    state.data = { items: [item({})], ready: [] };
    renderView();
    const chip = within(cell('2026-10-10')).getByRole('button', { name: /سه اشتباه رایج/ });
    expect(chip).toBeVisible();
    expect(within(cell('2026-10-11')).queryByRole('button')).toBeNull();
  });

  it('moves a content to another day at the same time when it is dropped there', () => {
    state.data = { items: [item({})], ready: [] };
    renderView();
    const dt = transfer();
    fireEvent.dragStart(within(cell('2026-10-10')).getByRole('button'), { dataTransfer: dt });
    fireEvent.dragOver(cell('2026-10-14'), { dataTransfer: dt });
    fireEvent.drop(cell('2026-10-14'), { dataTransfer: dt });
    expect(state.schedule).toHaveBeenCalledTimes(1);
    const [vars] = state.schedule.mock.calls[0]!;
    expect(vars.id).toBe('c1');
    expect(toLocalInput(vars.scheduledAt)).toBe('2026-10-14T09:30');
  });

  it('schedules a ready content at 10:00 on the day it is dropped on', () => {
    state.data = {
      items: [],
      ready: [item({ id: 'r1', title: 'آمادهٔ انتشار', scheduledAt: null, state: null })],
    };
    renderView();
    const chip = screen.getByRole('button', { name: /آمادهٔ انتشار/ });
    const dt = transfer();
    fireEvent.dragStart(chip, { dataTransfer: dt });
    fireEvent.drop(cell('2026-10-02'), { dataTransfer: dt });
    const [vars] = state.schedule.mock.calls[0]!;
    expect(vars.id).toBe('r1');
    expect(toLocalInput(vars.scheduledAt)).toBe('2026-10-02T10:00');
  });

  it('does not let a published content be dragged or moved', () => {
    const published = item({
      state: 'PUBLISHED',
      publishedAt: new Date(2026, 9, 5, 18, 0).toISOString(),
    });
    state.data = { items: [published], ready: [] };
    renderView();
    const chip = within(cell('2026-10-05')).getByRole('button');
    expect(chip).toHaveAttribute('draggable', 'false');
    const dt = transfer();
    fireEvent.dragStart(chip, { dataTransfer: dt });
    fireEvent.drop(cell('2026-10-14'), { dataTransfer: dt });
    expect(state.schedule).not.toHaveBeenCalled();
  });

  it('ignores a drop that carries nothing of ours', () => {
    renderView();
    fireEvent.drop(cell('2026-10-14'), { dataTransfer: transfer() });
    expect(state.schedule).not.toHaveBeenCalled();
  });

  it('goes to the next month and back to today', async () => {
    renderView();
    await userEvent.click(screen.getByRole('button', { name: 'بعدی' }));
    expectTitle('آبان', '۱۴۰۵');
    await userEvent.click(screen.getByRole('button', { name: 'امروز' }));
    expectTitle('مهر', '۱۴۰۵');
  });

  it('switches to a week of seven days', async () => {
    renderView();
    await userEvent.click(screen.getByRole('button', { name: 'هفته' }));
    expect(document.querySelectorAll('[data-day]')).toHaveLength(7);
    // the week of Wednesday 7 Oct 2026 starts on Saturday 3 Oct
    expect(document.querySelectorAll('[data-day]')[0]).toHaveAttribute('data-day', '2026-10-03');
  });

  it('folds a crowded day into "N more" that opens its week', async () => {
    state.data = {
      items: ['a', 'b', 'c', 'd', 'e'].map((id) =>
        item({ id, title: `محتوا ${id}`, scheduledAt: new Date(2026, 9, 10, 9, 0).toISOString() }),
      ),
      ready: [],
    };
    renderView();
    expect(within(cell('2026-10-10')).getAllByRole('button')).toHaveLength(4); // 3 chips + "more"
    await userEvent.click(within(cell('2026-10-10')).getByText(/۲ مورد دیگر/));
    expect(document.querySelectorAll('[data-day]')).toHaveLength(7);
    expect(within(cell('2026-10-10')).getAllByRole('button')).toHaveLength(5);
  });

  it('reads the English calendar left to right, Gregorian, starting on Sunday', () => {
    useUi.setState({ lang: 'en' });
    renderView();
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeVisible();
    expect(document.querySelectorAll('[data-day]')[0]).toHaveAttribute('data-day', '2026-09-27');
  });

  it('opens a content in a dialog with its schedule', async () => {
    state.data = { items: [item({})], ready: [] };
    renderView();
    await userEvent.click(within(cell('2026-10-10')).getByRole('button'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('link', { name: 'باز کردن محتوا' })).toHaveAttribute(
      'href',
      '/app/contents/c1',
    );
    expect(within(dialog).getByDisplayValue('2026-10-10T09:30')).toBeVisible();
  });
});
