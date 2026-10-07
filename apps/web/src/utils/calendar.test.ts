import { describe, expect, it } from 'vitest';
import {
  addDays,
  calendarDateOf,
  dayKey,
  fromLocalInput,
  monthGrid,
  monthStart,
  monthTitle,
  moveToDay,
  nextMonthStart,
  prevMonthStart,
  toLocalInput,
  weekdayLabels,
  weekGrid,
} from './calendar';

// local noon, so none of these depend on the time zone the tests run in
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

describe('calendarDateOf', () => {
  it('reads the Persian calendar (Nowruz and the month borders)', () => {
    expect(calendarDateOf(at(2024, 3, 20), 'persian')).toEqual({ year: 1403, month: 1, day: 1 });
    expect(calendarDateOf(at(2025, 3, 21), 'persian')).toEqual({ year: 1404, month: 1, day: 1 });
    expect(calendarDateOf(at(2026, 10, 7), 'persian')).toEqual({ year: 1405, month: 7, day: 15 });
    // Shahrivar has 31 days; Mehr begins the next day
    expect(calendarDateOf(at(2026, 9, 22), 'persian')).toEqual({ year: 1405, month: 6, day: 31 });
    expect(calendarDateOf(at(2026, 9, 23), 'persian')).toEqual({ year: 1405, month: 7, day: 1 });
    // Esfand of a leap year has 30 days
    expect(calendarDateOf(at(2025, 3, 20), 'persian')).toEqual({ year: 1403, month: 12, day: 30 });
  });

  it('reads the Gregorian calendar', () => {
    expect(calendarDateOf(at(2026, 10, 7), 'gregory')).toEqual({ year: 2026, month: 10, day: 7 });
  });
});

describe('month borders', () => {
  it('finds the first day of a Persian month and the next one', () => {
    expect(dayKey(monthStart(at(2026, 10, 7), 'persian'))).toBe('2026-09-23');
    expect(dayKey(nextMonthStart(at(2026, 10, 7), 'persian'))).toBe('2026-10-23');
    expect(dayKey(prevMonthStart(at(2026, 10, 7), 'persian'))).toBe('2026-08-23');
  });

  it('handles 29-, 30- and 31-day months and the year border', () => {
    // Shahrivar 1405 (31 days) → Mehr 1
    expect(dayKey(nextMonthStart(at(2026, 9, 1), 'persian'))).toBe('2026-09-23');
    // Esfand 1403 (leap, 30 days) → Farvardin 1404
    expect(dayKey(nextMonthStart(at(2025, 3, 1), 'persian'))).toBe('2025-03-21');
    // Esfand 1405 (29 days) → Farvardin 1406
    expect(dayKey(nextMonthStart(at(2027, 3, 1), 'persian'))).toBe('2027-03-21');
    expect(dayKey(prevMonthStart(at(2025, 3, 25), 'persian'))).toBe('2025-02-19');
  });

  it('handles February in the Gregorian calendar', () => {
    expect(dayKey(nextMonthStart(at(2028, 2, 10), 'gregory'))).toBe('2028-03-01');
    expect(dayKey(nextMonthStart(at(2027, 2, 10), 'gregory'))).toBe('2027-03-01');
    expect(dayKey(prevMonthStart(at(2026, 1, 15), 'gregory'))).toBe('2025-12-01');
  });
});

describe('monthGrid', () => {
  it('lays Mehr 1405 out in whole weeks that start on Saturday', () => {
    const g = monthGrid(at(2026, 10, 7), 'persian');
    expect(g.days).toHaveLength(35);
    expect(dayKey(g.from)).toBe('2026-09-19');
    expect(dayKey(g.to)).toBe('2026-10-24');
    expect(g.from.getDay()).toBe(6);
    // Mehr 1 is a Wednesday: Saturday, Sunday, Monday and Tuesday come from Shahrivar
    expect(g.days.slice(0, 4).every((d) => !d.inMonth)).toBe(true);
    expect(g.days[4]).toMatchObject({ key: '2026-09-23', day: 1, inMonth: true });
    expect(g.days.filter((d) => d.inMonth)).toHaveLength(30);
    expect(g.days.at(-1)).toMatchObject({ key: '2026-10-23' });
  });

  it('lays October 2026 out in whole weeks that start on Sunday', () => {
    const g = monthGrid(at(2026, 10, 7), 'gregory');
    expect(dayKey(g.from)).toBe('2026-09-27');
    expect(dayKey(g.to)).toBe('2026-11-01');
    expect(g.days.filter((d) => d.inMonth)).toHaveLength(31);
  });

  it('always yields 4 to 6 whole weeks that contain every day of the month, in both calendars', () => {
    for (const system of ['persian', 'gregory'] as const) {
      let anchor = at(2024, 1, 15);
      for (let i = 0; i < 72; i++) {
        const g = monthGrid(anchor, system);
        expect(g.days.length % 7).toBe(0);
        expect(g.days.length).toBeGreaterThanOrEqual(28);
        expect(g.days.length).toBeLessThanOrEqual(42);
        const inMonth = g.days.filter((d) => d.inMonth);
        expect(inMonth.map((d) => d.day)).toEqual(inMonth.map((_, n) => n + 1));
        // consecutive days, no gaps and no repeats
        g.days.forEach((d, n) => expect(d.key).toBe(dayKey(addDays(g.from, n))));
        anchor = nextMonthStart(anchor, system);
      }
    }
  });
});

describe('weekGrid', () => {
  it('is the seven days of the week of the date', () => {
    const g = weekGrid(at(2026, 10, 7), 'persian');
    expect(g.days.map((d) => d.key)).toEqual([
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
    ]);
    expect(g.days.every((d) => d.inMonth)).toBe(true);
  });
});

describe('labels', () => {
  it('names the Persian month and year, and the English one', () => {
    expect(monthTitle(at(2026, 10, 7), 'fa')).toContain('مهر');
    expect(monthTitle(at(2026, 10, 7), 'fa')).toContain('۱۴۰۵');
    expect(monthTitle(at(2026, 10, 7), 'en')).toBe('October 2026');
  });

  it('starts the weekday names at the first day of the week', () => {
    expect(weekdayLabels('fa')[0]).toBe('شنبه');
    expect(weekdayLabels('fa')).toHaveLength(7);
    expect(weekdayLabels('en')[0]).toBe('Sun');
  });
});

describe('local date-time helpers', () => {
  it('round-trips a datetime-local value', () => {
    const iso = fromLocalInput('2026-10-07T09:30')!;
    expect(toLocalInput(iso)).toBe('2026-10-07T09:30');
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('nope')).toBeNull();
    expect(toLocalInput(null)).toBe('');
  });

  it('moves an item to another day at the same time, or at 10:00 when it had none', () => {
    const moved = moveToDay(at(2026, 10, 20, 0), at(2026, 10, 7, 14, 45));
    expect(toLocalInput(moved)).toBe('2026-10-20T14:45');
    expect(toLocalInput(moveToDay(at(2026, 10, 20, 0), null))).toBe('2026-10-20T10:00');
  });
});
