import { describe, expect, it } from 'vitest';
import {
  BudgetSettingsSchema,
  budgetLevel,
  DEFAULT_BUDGET,
  monthKey,
  monthRange,
} from './budget';

describe('budgetLevel', () => {
  it('is none without a cap', () => {
    expect(budgetLevel(5, null, 80)).toBe('none');
    expect(budgetLevel(5, undefined, 80)).toBe('none');
  });

  it('warns at the chosen share and is exceeded at the cap', () => {
    expect(budgetLevel(15.9, 20, 80)).toBe('ok');
    expect(budgetLevel(16, 20, 80)).toBe('warning');
    expect(budgetLevel(19.99, 20, 80)).toBe('warning');
    expect(budgetLevel(20, 20, 80)).toBe('exceeded');
    expect(budgetLevel(35, 20, 80)).toBe('exceeded');
  });

  it('treats a zero cap as exceeded as soon as anything is spent', () => {
    expect(budgetLevel(0, 0, 80)).toBe('ok');
    expect(budgetLevel(0.01, 0, 80)).toBe('exceeded');
  });
});

describe('monthRange — Persian', () => {
  it('starts at Tehran midnight of day 1 and ends at day 1 of the next month', () => {
    const r = monthRange(new Date('2026-10-14T10:00:00Z'), 'persian');
    expect(r.from.toISOString()).toBe('2026-09-22T20:30:00.000Z'); // 1 Mehr 1405 = 23 Sep, 00:00 Tehran
    expect(r.to.toISOString()).toBe('2026-10-22T20:30:00.000Z'); // 1 Aban 1405 = 23 Oct
    expect(r.label).toBe('1405/7');
  });

  it('puts the last minute of a month and the first of the next in different months', () => {
    const last = monthRange(new Date('2026-09-22T20:29:00Z'), 'persian');
    const first = monthRange(new Date('2026-09-22T20:31:00Z'), 'persian');
    expect(last.label).toBe('1405/6');
    expect(first.label).toBe('1405/7');
    expect(last.to.getTime()).toBe(first.from.getTime());
  });

  it('handles the 29-day Esfand and the year change', () => {
    const esfand = monthRange(new Date('2027-03-20T20:00:00Z'), 'persian');
    expect(esfand.label).toBe('1405/12');
    expect(esfand.to.toISOString()).toBe('2027-03-20T20:30:00.000Z'); // 1 Farvardin 1406 = 21 Mar
    const next = monthRange(new Date('2027-03-21T10:00:00Z'), 'persian');
    expect(next.label).toBe('1406/1');
    expect(next.from.getTime()).toBe(esfand.to.getTime());
  });

  it('covers every instant of a year without gaps or overlaps', () => {
    let t = new Date('2026-03-21T00:00:00Z').getTime();
    let r = monthRange(new Date(t), 'persian');
    for (let i = 0; i < 12; i++) {
      const next = monthRange(r.to, 'persian');
      expect(next.from.getTime()).toBe(r.to.getTime());
      expect(next.to.getTime()).toBeGreaterThan(next.from.getTime());
      const days = (next.to.getTime() - next.from.getTime()) / 86_400_000;
      expect(days).toBeGreaterThanOrEqual(29);
      expect(days).toBeLessThanOrEqual(31);
      r = next;
      t = next.from.getTime();
    }
  });
});

describe('monthRange — Gregorian', () => {
  it('is the UTC calendar month', () => {
    const r = monthRange(new Date('2026-10-14T10:00:00Z'), 'gregory');
    expect(r.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(r.label).toBe('2026-10');
  });

  it('crosses the year', () => {
    expect(monthRange(new Date('2026-12-31T23:00:00Z'), 'gregory').to.toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });
});

describe('monthKey and settings', () => {
  it('changes with the month and with the calendar', () => {
    const a = new Date('2026-10-14T10:00:00Z');
    expect(monthKey(a, 'persian')).toBe('persian:1405/7');
    expect(monthKey(a, 'gregory')).toBe('gregory:2026-10');
    expect(monthKey(new Date('2026-10-24T10:00:00Z'), 'persian')).toBe('persian:1405/8');
  });

  it('accepts the default and rejects nonsense', () => {
    expect(BudgetSettingsSchema.safeParse(DEFAULT_BUDGET).success).toBe(true);
    expect(DEFAULT_BUDGET).toMatchObject({ monthlyUsd: 20, hardStop: false });
    expect(BudgetSettingsSchema.safeParse({ ...DEFAULT_BUDGET, monthlyUsd: -1 }).success).toBe(false);
    expect(BudgetSettingsSchema.safeParse({ ...DEFAULT_BUDGET, warnPercent: 0 }).success).toBe(false);
    expect(BudgetSettingsSchema.safeParse({ ...DEFAULT_BUDGET, calendar: 'x' }).success).toBe(false);
    expect(BudgetSettingsSchema.safeParse({ ...DEFAULT_BUDGET, monthlyUsd: null }).success).toBe(true);
  });
});
