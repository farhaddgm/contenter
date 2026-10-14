/**
 * Monthly AI budget (docs/44-reliability-and-cost.md). Spending is the sum of `AiJob.costUsd`
 * of the jobs that finished in the month. Everything here is pure; the API reads the jobs.
 *
 * The default month is the Persian (Jalali) month, because that is how the owner thinks about
 * it; it is read with `Intl`, never with a hand-written converter (CLAUDE.md). Tehran has no
 * daylight saving since 2022, so its midnight is a fixed +03:30 offset.
 */
import { z } from 'zod';
import { AiJobType } from './enums';

export const BudgetCalendar = ['persian', 'gregory'] as const;
export type BudgetCalendar = (typeof BudgetCalendar)[number];

const usd = z.number().min(0).max(100_000);

export const BudgetSettingsSchema = z.object({
  /** Cap for all AI jobs in one month, in USD; null = no cap. */
  monthlyUsd: usd.nullable(),
  /** The share of a cap (1–100) at which the admins are warned. */
  warnPercent: z.number().int().min(1).max(100),
  /**
   * false: only warn. true: a job asked after the cap is used up is not run and says why;
   * jobs already queued finish.
   */
  hardStop: z.boolean(),
  calendar: z.enum(BudgetCalendar),
  /** Optional cap per business (id → USD), counted from that business's topics and jobs. */
  businesses: z.record(z.string(), usd),
});
export type BudgetSettings = z.infer<typeof BudgetSettingsSchema>;

/** About one monthly ChatGPT subscription (the owner's figure, 13 Oct 2026); warns only. */
export const DEFAULT_BUDGET: BudgetSettings = {
  monthlyUsd: 20,
  warnPercent: 80,
  hardStop: false,
  calendar: 'persian',
  businesses: {},
};

export type BudgetLevel = 'none' | 'ok' | 'warning' | 'exceeded';

/** Where `spent` stands against `cap`; `none` without a cap. */
export function budgetLevel(spent: number, cap: number | null | undefined, warnPercent: number): BudgetLevel {
  if (cap === null || cap === undefined) return 'none';
  if (cap <= 0) return spent > 0 ? 'exceeded' : 'ok';
  if (spent >= cap) return 'exceeded';
  return spent / cap >= warnPercent / 100 ? 'warning' : 'ok';
}

export interface BudgetLine {
  usd: number;
  jobs: number;
}

export interface BudgetUsage {
  /** First instant of the month (ISO) and of the next one. */
  from: string;
  to: string;
  /** "۱۴۰۵/۷" or "2026-10", for display. */
  label: string;
  spentUsd: number;
  capUsd: number | null;
  /** 0–… (can exceed 100); null without a cap. */
  percent: number | null;
  level: BudgetLevel;
  byTask: ({ type: AiJobType } & BudgetLine)[];
  byBusiness: {
    businessId: string;
    name: string;
    usd: number;
    jobs: number;
    capUsd: number | null;
    percent: number | null;
    level: BudgetLevel;
  }[];
}

export interface BudgetResponse {
  settings: BudgetSettings;
  usage: BudgetUsage;
}

// ─────────────────────────────── months ───────────────────────────────

const TEHRAN = 'Asia/Tehran';
const DAY_MS = 24 * 60 * 60 * 1000;

interface DayParts {
  year: number;
  month: number;
  day: number;
  /** Gregorian date in Tehran, YYYY-MM-DD. */
  iso: string;
}

function tehranDay(date: Date, calendar: 'persian' | 'gregory'): DayParts {
  const parts = (cal: string) =>
    Object.fromEntries(
      new Intl.DateTimeFormat(`en-u-ca-${cal}-nu-latn`, {
        timeZone: TEHRAN,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
      })
        .formatToParts(date)
        .filter((p) => p.type !== 'literal')
        .map((p) => [p.type, Number(p.value)]),
    ) as Record<'year' | 'month' | 'day', number>;
  const g = parts('gregory');
  const c = calendar === 'persian' ? parts('persian') : g;
  const pad = (n: number) => String(n).padStart(2, '0');
  return { ...c, iso: `${g.year}-${pad(g.month)}-${pad(g.day)}` };
}

const tehranMidnight = (iso: string) => new Date(`${iso}T00:00:00+03:30`);

/**
 * The month `now` falls in. Persian months start at Tehran midnight of day 1 of the Persian
 * month; Gregorian months at 00:00 UTC of day 1.
 */
export function monthRange(
  now: Date,
  calendar: BudgetCalendar,
): { from: Date; to: Date; label: string } {
  if (calendar === 'gregory') {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { from, to, label: from.toISOString().slice(0, 7) };
  }
  const today = tehranDay(now, 'persian');
  const from = tehranMidnight(tehranDay(new Date(now.getTime() - (today.day - 1) * DAY_MS), 'gregory').iso);
  // forward to the first day of the next Persian month (at most 31 days away)
  let cursor = new Date(from.getTime() + 28 * DAY_MS);
  while (tehranDay(cursor, 'persian').day !== 1) cursor = new Date(cursor.getTime() + DAY_MS);
  const to = tehranMidnight(tehranDay(cursor, 'gregory').iso);
  return { from, to, label: `${today.year}/${today.month}` };
}

/** A key that changes with the month; used to send each alert once per month. */
export const monthKey = (now: Date, calendar: BudgetCalendar) =>
  `${calendar}:${monthRange(now, calendar).label}`;
