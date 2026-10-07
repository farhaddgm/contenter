/**
 * Content calendar rules shared by the API and the web (docs/22-calendar-publishing.md).
 * A content sits on the calendar at the day it was published, or else at its planned day.
 */
import type { ContentStatus } from './enums';

export type CalendarState = 'SCHEDULED' | 'PUBLISHED' | 'OVERDUE';

export interface CalendarSubject {
  status: ContentStatus;
  scheduledAt: Date | string | null;
  publishedAt: Date | string | null;
}

const time = (d: Date | string) => (d instanceof Date ? d : new Date(d)).getTime();

/** Published wins; a planned time in the past that nobody marked published is overdue. */
export function calendarStateOf(
  c: Pick<CalendarSubject, 'scheduledAt' | 'publishedAt'>,
  now: Date = new Date(),
): CalendarState | null {
  if (c.publishedAt) return 'PUBLISHED';
  if (!c.scheduledAt) return null;
  return time(c.scheduledAt) < now.getTime() ? 'OVERDUE' : 'SCHEDULED';
}

/** The moment a content is shown at: its publication, else its plan. */
export function calendarMomentOf(
  c: Pick<CalendarSubject, 'scheduledAt' | 'publishedAt'>,
): Date | null {
  const at = c.publishedAt ?? c.scheduledAt;
  return at ? new Date(time(at)) : null;
}

/** Only an approved, not yet published content may be planned. */
export function canSchedule(c: Pick<CalendarSubject, 'status' | 'publishedAt'>): boolean {
  return c.status === 'APPROVED' && !c.publishedAt;
}

/** Only an approved content can be marked published. */
export function canPublish(c: Pick<CalendarSubject, 'status' | 'publishedAt'>): boolean {
  return c.status === 'APPROVED' && !c.publishedAt;
}
