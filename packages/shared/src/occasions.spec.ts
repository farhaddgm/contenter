import { describe, expect, it } from 'vitest';
import { occasionDirection, occasionsBetween } from './occasions';

const on = (from: string, to = from) => occasionsBetween(from, to);
const ids = (from: string, to = from) => on(from, to).map((o) => o.id);

describe('occasionsBetween', () => {
  it('finds the fixed Persian-calendar days', () => {
    expect(ids('2027-03-21')).toContain('nowruz-1');
    expect(ids('2026-12-21')).toContain('yalda');
    expect(ids('2027-02-11')).toContain('revolution-day');
    expect(ids('2026-05-02')).toContain('teachers-day');
  });

  it('puts Chaharshanbe Suri on the Tuesday before the last Wednesday of Esfand', () => {
    expect(ids('2027-03-16')).toContain('chaharshanbe-suri');
    expect(ids('2027-03-09')).not.toContain('chaharshanbe-suri');
    expect(ids('2027-03-23')).not.toContain('chaharshanbe-suri');
    // another year: 1404 ended on Friday 2026-03-20, last Wednesday 2026-03-18
    expect(ids('2026-03-17')).toContain('chaharshanbe-suri');
  });

  it('puts Black Friday on the Friday after the fourth Thursday of November', () => {
    expect(ids('2026-11-27')).toContain('black-friday');
    expect(ids('2026-11-20')).not.toContain('black-friday');
    expect(ids('2025-11-28')).toContain('black-friday');
  });

  it('finds Islamic days near their expected date and marks them approximate', () => {
    const ashura = on('2026-06-23', '2026-06-28').find((o) => o.id === 'ashura');
    expect(ashura).toBeDefined();
    expect(ashura!.approximate).toBe(true);
    expect(ashura!.tone).toBe('MOURNING');
    const nowruz = on('2027-03-21').find((o) => o.id === 'nowruz-1');
    expect(nowruz!.approximate).toBe(false);
    expect(nowruz!.holiday).toBe(true);
  });

  it('is sorted by day, deterministic and tolerant of bad input', () => {
    const range = on('2026-12-01', '2027-04-30');
    const days = range.map((o) => o.date);
    expect([...days].sort()).toEqual(days);
    expect(on('2026-12-01', '2027-04-30')).toEqual(range);
    expect(occasionsBetween('nonsense', '2026-01-01')).toEqual([]);
    expect(occasionsBetween('2026-02-01', '2026-01-01')).toEqual([]);
  });

  it('cuts a very long range', () => {
    const long = occasionsBetween('2020-01-01', '2030-01-01');
    expect(long.every((o) => o.date < '2021-03-01')).toBe(true);
  });
});

describe('occasionDirection', () => {
  it('asks for a respectful tone on a mourning day', () => {
    const text = occasionDirection({ fa: 'عاشورای حسینی', tone: 'MOURNING' });
    expect(text).toContain('عاشورای حسینی');
    expect(text).toContain('بدون تبلیغ');
  });
});
