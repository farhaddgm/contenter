import { describe, expect, it } from 'vitest';
import { calendarMomentOf, calendarStateOf, canPublish, canSchedule } from './calendar';
import { CalendarQuerySchema, PublishContentSchema, ScheduleContentSchema } from './schemas';
import { reviewActionsFor } from './workflow';

const now = new Date('2026-10-10T12:00:00Z');

describe('calendarStateOf', () => {
  it('has no state for a content that is not on the calendar', () => {
    expect(calendarStateOf({ scheduledAt: null, publishedAt: null }, now)).toBeNull();
  });

  it('is scheduled until the planned time passes, then overdue', () => {
    expect(calendarStateOf({ scheduledAt: '2026-10-11T09:00:00Z', publishedAt: null }, now)).toBe(
      'SCHEDULED',
    );
    expect(calendarStateOf({ scheduledAt: '2026-10-09T09:00:00Z', publishedAt: null }, now)).toBe(
      'OVERDUE',
    );
  });

  it('is published as soon as it was published, whatever the plan said', () => {
    expect(
      calendarStateOf(
        { scheduledAt: '2026-10-09T09:00:00Z', publishedAt: '2026-10-09T10:00:00Z' },
        now,
      ),
    ).toBe('PUBLISHED');
  });
});

describe('calendarMomentOf', () => {
  it('places a published content at its publication, the rest at their plan', () => {
    expect(
      calendarMomentOf({
        scheduledAt: '2026-10-09T09:00:00Z',
        publishedAt: '2026-10-10T10:00:00Z',
      })?.toISOString(),
    ).toBe('2026-10-10T10:00:00.000Z');
    expect(
      calendarMomentOf({ scheduledAt: '2026-10-09T09:00:00Z', publishedAt: null })?.toISOString(),
    ).toBe('2026-10-09T09:00:00.000Z');
    expect(calendarMomentOf({ scheduledAt: null, publishedAt: null })).toBeNull();
  });
});

describe('canSchedule / canPublish', () => {
  it('only approved, unpublished content', () => {
    for (const rule of [canSchedule, canPublish]) {
      expect(rule({ status: 'APPROVED', publishedAt: null })).toBe(true);
      expect(rule({ status: 'DRAFT', publishedAt: null })).toBe(false);
      expect(rule({ status: 'IN_REVIEW', publishedAt: null })).toBe(false);
      expect(rule({ status: 'APPROVED', publishedAt: '2026-10-09T10:00:00Z' })).toBe(false);
    }
  });
});

describe('a published content is frozen for review', () => {
  it('offers no review step, not even reopen', () => {
    const subject = {
      status: 'APPROVED' as const,
      reviewStage: null,
      submittedById: null,
      hasVersion: true,
    };
    expect(reviewActionsFor(subject, { id: 'a', role: 'ADMIN' })).toEqual(['reopen']);
    expect(reviewActionsFor({ ...subject, published: true }, { id: 'a', role: 'ADMIN' })).toEqual(
      [],
    );
  });
});

describe('calendar schemas', () => {
  const range = (from: string, to: string) => CalendarQuerySchema.safeParse({ from, to });

  it('accepts a month and rejects an empty, inverted or oversized range', () => {
    expect(range('2026-09-27T00:00:00.000Z', '2026-11-08T00:00:00.000Z').success).toBe(true);
    expect(range('2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z').success).toBe(false);
    expect(range('2026-10-11T00:00:00.000Z', '2026-10-10T00:00:00.000Z').success).toBe(false);
    expect(range('2026-01-01T00:00:00.000Z', '2026-12-31T00:00:00.000Z').success).toBe(false);
  });

  it('wants real timestamps', () => {
    expect(range('yesterday', 'tomorrow').success).toBe(false);
  });

  it('lets a schedule be cleared with null but not left out', () => {
    expect(ScheduleContentSchema.safeParse({ scheduledAt: null }).success).toBe(true);
    expect(
      ScheduleContentSchema.safeParse({ scheduledAt: '2026-10-11T09:00:00+03:30' }).success,
    ).toBe(true);
    expect(ScheduleContentSchema.safeParse({}).success).toBe(false);
  });

  it('takes an optional http(s) link when marking published', () => {
    expect(PublishContentSchema.safeParse({}).success).toBe(true);
    expect(PublishContentSchema.safeParse({ url: 'https://instagram.com/p/abc' }).success).toBe(
      true,
    );
    expect(PublishContentSchema.safeParse({ url: 'javascript:alert(1)' }).success).toBe(false);
  });
});
