/**
 * Questions that fill the gaps of a business profile (docs/72-profile-questions.md). The gaps are
 * found by code from what is stored (empty or thin sections, no catalog, no proof …); no model
 * writes or ranks them. An answer to a section question is appended to that section by the admin's
 * own words; the other questions point to the place where the data is entered.
 */
import { z } from 'zod';
import { BUSINESS_SECTION_META, BusinessSectionKey } from './business';

/** Where answering a question happens. */
export const ProfileQuestionAction = [
  'ANSWER',
  'GOTO_PROFILE',
  'GOTO_FACTS',
  'GOTO_OFFERINGS',
  'GOTO_COMPETITORS',
] as const;
export type ProfileQuestionAction = (typeof ProfileQuestionAction)[number];

export const PROFILE_QUESTIONS_MAX = 12;
/** A section untouched for this long gets a "still true?" question. */
export const SECTION_STALE_DAYS = 180;
export const PROFILE_ANSWER_MAX = 4000;

export interface ProfileQuestion {
  /** Stable id: `SECTION_EMPTY:OVERVIEW`, `NO_FACTS` … — what a skip is stored by. */
  code: string;
  action: ProfileQuestionAction;
  sectionKey: BusinessSectionKey | null;
  /** Higher first. */
  priority: number;
  /** Numbers the question text shows (e.g. how many offerings lack proof). */
  count: number;
}

export interface QuestionSection {
  key: BusinessSectionKey;
  content: string;
  source: 'ADMIN' | 'AI';
  reviewedAt: string | Date | null;
  updatedAt: string | Date;
}

export interface QuestionInput {
  sections: readonly QuestionSection[];
  counts: {
    facts: number;
    competitors: number;
    offerings: number;
    offeringsWithoutClaims: number;
    unprovenClaims: number;
    /** Offerings whose peak season starts next month (`peakingSoon`). */
    peakSoon?: number;
  };
  /** Codes the admin skipped. */
  skipped: readonly string[];
  /** Sections the asker may not change (lock), left out. */
  blocked?: readonly BusinessSectionKey[];
  now?: Date;
}

const DAY = 86_400_000;

/** `SECTION_EMPTY:KEY` / `SECTION_THIN:KEY` → the key, or null for any other code. */
export function answerableSection(code: string): BusinessSectionKey | null {
  const m = /^SECTION_(?:EMPTY|THIN):(.+)$/.exec(code);
  const parsed = z.enum(BusinessSectionKey).safeParse(m?.[1]);
  return parsed.success ? parsed.data : null;
}

/**
 * The open questions, most important first (at most `PROFILE_QUESTIONS_MAX`), and how many more
 * there are. Pure and deterministic.
 */
export function buildProfileQuestions(input: QuestionInput): {
  questions: ProfileQuestion[];
  total: number;
  skipped: number;
} {
  const now = input.now ?? new Date();
  const skipped = new Set(input.skipped);
  const blocked = new Set(input.blocked ?? []);
  const byKey = new Map(input.sections.map((s) => [s.key, s]));
  const all: ProfileQuestion[] = [];
  const add = (q: Omit<ProfileQuestion, 'count'> & { count?: number }) =>
    all.push({ count: 0, ...q });

  const noCards = input.counts.competitors === 0;
  for (const key of BusinessSectionKey) {
    if (blocked.has(key)) continue;
    const meta = BUSINESS_SECTION_META[key];
    // with no competitor card, the card question below comes first
    if (key === 'COMPETITORS' && noCards) continue;
    const section = byKey.get(key);
    const text = section?.content.trim() ?? '';
    if (!text) {
      add({ code: `SECTION_EMPTY:${key}`, action: 'ANSWER', sectionKey: key, priority: meta.weight * 100 });
    } else if (text.length < meta.minChars) {
      add({ code: `SECTION_THIN:${key}`, action: 'ANSWER', sectionKey: key, priority: meta.weight * 100 - 50 });
    } else if (section?.source === 'AI' && !section.reviewedAt) {
      add({ code: `SECTION_UNREVIEWED:${key}`, action: 'GOTO_PROFILE', sectionKey: key, priority: meta.weight * 100 - 60 });
    } else if (section && now.getTime() - new Date(section.updatedAt).getTime() > SECTION_STALE_DAYS * DAY) {
      add({ code: `SECTION_STALE:${key}`, action: 'GOTO_PROFILE', sectionKey: key, priority: meta.weight * 100 - 80 });
    }
  }
  const c = input.counts;
  if (noCards) add({ code: 'NO_COMPETITORS', action: 'GOTO_COMPETITORS', sectionKey: 'COMPETITORS', priority: 260 });
  if (c.facts === 0) add({ code: 'NO_FACTS', action: 'GOTO_FACTS', sectionKey: null, priority: 280 });
  if ((c.peakSoon ?? 0) > 0) {
    add({ code: 'PEAK_SOON', action: 'GOTO_OFFERINGS', sectionKey: 'CALENDAR', priority: 270, count: c.peakSoon });
  }
  if (c.offerings === 0) {
    add({ code: 'NO_OFFERINGS', action: 'GOTO_OFFERINGS', sectionKey: 'SERVICES', priority: 290 });
  } else {
    if (c.offeringsWithoutClaims > 0) {
      add({ code: 'OFFERINGS_NO_CLAIMS', action: 'GOTO_OFFERINGS', sectionKey: 'SERVICES', priority: 240, count: c.offeringsWithoutClaims });
    }
    if (c.unprovenClaims > 0) {
      add({ code: 'CLAIMS_UNPROVEN', action: 'GOTO_OFFERINGS', sectionKey: 'SERVICES', priority: 245, count: c.unprovenClaims });
    }
  }

  const open = all.filter((q) => !skipped.has(q.code));
  open.sort((a, b) => b.priority - a.priority || a.code.localeCompare(b.code));
  return {
    questions: open.slice(0, PROFILE_QUESTIONS_MAX),
    total: open.length,
    skipped: all.length - open.length,
  };
}

export const AnswerProfileQuestionSchema = z.object({
  code: z.string().trim().min(1).max(80),
  answer: z.string().trim().min(1).max(PROFILE_ANSWER_MAX),
});
export type AnswerProfileQuestionInput = z.input<typeof AnswerProfileQuestionSchema>;

export const SkipProfileQuestionSchema = z.object({ code: z.string().trim().min(1).max(80) });
export type SkipProfileQuestionInput = z.input<typeof SkipProfileQuestionSchema>;

export interface ProfileQuestionList {
  questions: ProfileQuestion[];
  total: number;
  skipped: number;
}
