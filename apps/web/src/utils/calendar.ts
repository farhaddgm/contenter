/**
 * Calendar grids for the content calendar. Dates are plain local `Date`s; the Persian (Jalali)
 * calendar is read through `Intl` (ICU does the conversion), so there is no hand-written
 * conversion algorithm to get wrong. Months are found by walking days, which is cheap (≤ 42).
 */
import type { Lang } from '@/stores/ui';

export type CalendarSystem = 'persian' | 'gregory';

/** The calendar a language is read in. */
export const systemFor = (lang: Lang): CalendarSystem => (lang === 'fa' ? 'persian' : 'gregory');

/** First day of the week as `Date#getDay()` (Saturday in Iran, Sunday in the English UI). */
export const weekStartFor = (system: CalendarSystem): number => (system === 'persian' ? 6 : 0);

const formatters = new Map<CalendarSystem, Intl.DateTimeFormat>();

/** Year, month and day of a date in the given calendar system. */
export function calendarDateOf(date: Date, system: CalendarSystem) {
  let f = formatters.get(system);
  if (!f) {
    f = new Intl.DateTimeFormat(`en-US-u-ca-${system}`, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
    formatters.set(system, f);
  }
  const out = { year: 0, month: 0, day: 0 };
  for (const p of f.formatToParts(date)) {
    if (p.type === 'year' || p.type === 'month' || p.type === 'day') out[p.type] = Number(p.value);
  }
  return out;
}

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Calendar-day arithmetic on local dates (immune to a 23- or 25-hour day). */
export const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** `YYYY-MM-DD` of the local day: the key items are grouped by. */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Local midnight of the first day of the calendar month `date` is in. */
export function monthStart(date: Date, system: CalendarSystem): Date {
  const day = startOfDay(date);
  return addDays(day, -(calendarDateOf(day, system).day - 1));
}

/** Local midnight of the first day of the next calendar month. */
export function nextMonthStart(date: Date, system: CalendarSystem): Date {
  const first = monthStart(date, system);
  const month = calendarDateOf(first, system).month;
  // every month has at least 28 days, so +27 is still inside it; then step over the border
  let d = addDays(first, 27);
  while (calendarDateOf(d, system).month === month) d = addDays(d, 1);
  return d;
}

export function prevMonthStart(date: Date, system: CalendarSystem): Date {
  return monthStart(addDays(monthStart(date, system), -1), system);
}

export function weekStart(date: Date, firstDay: number): Date {
  const day = startOfDay(date);
  return addDays(day, -((day.getDay() - firstDay + 7) % 7));
}

export interface GridDay {
  date: Date;
  key: string;
  /** Day of the month in the calendar system. */
  day: number;
  inMonth: boolean;
}

export interface Grid {
  days: GridDay[];
  /** The range the grid shows, `to` exclusive. */
  from: Date;
  to: Date;
}

function daysBetween(
  from: Date,
  to: Date,
  system: CalendarSystem,
  month: number | null,
): GridDay[] {
  const days: GridDay[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) {
    const parts = calendarDateOf(d, system);
    days.push({
      date: d,
      key: dayKey(d),
      day: parts.day,
      inMonth: month === null || parts.month === month,
    });
  }
  return days;
}

/** Whole weeks covering the calendar month of `anchor`. */
export function monthGrid(anchor: Date, system: CalendarSystem): Grid {
  const firstDay = weekStartFor(system);
  const first = monthStart(anchor, system);
  const lastOfMonth = addDays(nextMonthStart(anchor, system), -1);
  const from = weekStart(first, firstDay);
  const to = addDays(weekStart(lastOfMonth, firstDay), 7);
  return { days: daysBetween(from, to, system, calendarDateOf(first, system).month), from, to };
}

/** The seven days of the week `anchor` is in. */
export function weekGrid(anchor: Date, system: CalendarSystem): Grid {
  const from = weekStart(anchor, weekStartFor(system));
  const to = addDays(from, 7);
  return { days: daysBetween(from, to, system, null), from, to };
}

const locale = (lang: Lang, system: CalendarSystem) =>
  lang === 'fa' ? `fa-IR-u-ca-${system}` : `en-US-u-ca-${system}`;

/** "مهر ۱۴۰۵" / "October 2026". */
export function monthTitle(anchor: Date, lang: Lang): string {
  const system = systemFor(lang);
  return new Intl.DateTimeFormat(locale(lang, system), { month: 'long', year: 'numeric' }).format(
    anchor,
  );
}

/** Weekday names starting at the first day of the week. */
export function weekdayLabels(lang: Lang, style: 'short' | 'long' = 'short'): string[] {
  const system = systemFor(lang);
  const f = new Intl.DateTimeFormat(locale(lang, system), { weekday: style });
  const from = weekStart(new Date(2026, 0, 7), weekStartFor(system));
  return Array.from({ length: 7 }, (_, i) => f.format(addDays(from, i)));
}

/** `YYYY-MM-DDTHH:mm` in local time, the value of an `<input type="datetime-local">`. */
export function toLocalInput(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dayKey(d)}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The ISO instant of a `datetime-local` value (read as local time); null when empty or invalid. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** `day` at the same wall-clock time as `time` (or 10:00 when there is none). */
export function moveToDay(day: Date, time: Date | null, defaultHour = 10): Date {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    time ? time.getHours() : defaultHour,
    time ? time.getMinutes() : 0,
  );
}
