import { describe, expect, it } from 'vitest';
import { BusinessSectionKey } from './business';
import { PROFILE_QUESTIONS_MAX, answerableSection, buildProfileQuestions, type QuestionInput } from './profile-questions';

const NOW = new Date('2026-10-23T00:00:00Z');
const long = 'ا'.repeat(600);

const full = (): QuestionInput => ({
  sections: BusinessSectionKey.map((key) => ({
    key,
    content: long,
    source: 'ADMIN' as const,
    reviewedAt: NOW,
    updatedAt: NOW,
  })),
  counts: { facts: 3, competitors: 2, offerings: 4, offeringsWithoutClaims: 0, unprovenClaims: 0 },
  skipped: [],
  now: NOW,
});

const codes = (i: QuestionInput) => buildProfileQuestions(i).questions.map((q) => q.code);

describe('buildProfileQuestions', () => {
  it('asks nothing about a complete profile', () => {
    expect(buildProfileQuestions(full())).toEqual({ questions: [], total: 0, skipped: 0 });
  });

  it('asks about empty, thin, unreviewed and stale sections, important ones first', () => {
    const i = full();
    i.sections = i.sections.map((s) => {
      if (s.key === 'OVERVIEW') return { ...s, content: '' };
      if (s.key === 'GUIDELINES') return { ...s, content: 'کوتاه' };
      if (s.key === 'FAQ') return { ...s, source: 'AI' as const, reviewedAt: null };
      if (s.key === 'CALENDAR') return { ...s, updatedAt: new Date('2026-01-01T00:00:00Z') };
      return s;
    });
    expect(codes(i)).toEqual([
      'SECTION_EMPTY:OVERVIEW',
      'SECTION_THIN:GUIDELINES',
      'SECTION_UNREVIEWED:FAQ',
      'SECTION_STALE:CALENDAR',
    ]);
  });

  it('treats a missing section row as empty', () => {
    const i = full();
    i.sections = i.sections.filter((s) => s.key !== 'PERSONAS');
    expect(codes(i)).toEqual(['SECTION_EMPTY:PERSONAS']);
  });

  it('points to the data entry for facts, catalog, proof and competitors', () => {
    const i = full();
    i.counts = { facts: 0, competitors: 0, offerings: 3, offeringsWithoutClaims: 2, unprovenClaims: 5 };
    // the competitors section question gives way to the card question
    i.sections = i.sections.map((s) => (s.key === 'COMPETITORS' ? { ...s, content: '' } : s));
    const out = buildProfileQuestions(i).questions;
    expect(out.map((q) => q.code)).toEqual(['NO_FACTS', 'NO_COMPETITORS', 'CLAIMS_UNPROVEN', 'OFFERINGS_NO_CLAIMS']);
    expect(out.find((q) => q.code === 'CLAIMS_UNPROVEN')).toMatchObject({ count: 5, action: 'GOTO_OFFERINGS' });
    i.counts = { ...i.counts, offerings: 0 };
    expect(codes(i)).toContain('NO_OFFERINGS');
    expect(codes(i)).not.toContain('CLAIMS_UNPROVEN');
  });

  it('hides skipped questions but counts them, and leaves out blocked sections', () => {
    const i = full();
    i.sections = i.sections.map((s) => (s.key === 'OVERVIEW' || s.key === 'FAQ' ? { ...s, content: '' } : s));
    i.skipped = ['SECTION_EMPTY:OVERVIEW'];
    i.blocked = ['FAQ'];
    expect(buildProfileQuestions(i)).toMatchObject({ questions: [], total: 0, skipped: 1 });
  });

  it('shows at most PROFILE_QUESTIONS_MAX but reports the total', () => {
    const i = full();
    i.sections = [];
    const out = buildProfileQuestions(i);
    expect(out.questions).toHaveLength(PROFILE_QUESTIONS_MAX);
    expect(out.total).toBe(BusinessSectionKey.length);
  });
});

describe('answerableSection', () => {
  it('accepts only empty/thin section codes with a real key', () => {
    expect(answerableSection('SECTION_EMPTY:OVERVIEW')).toBe('OVERVIEW');
    expect(answerableSection('SECTION_THIN:FAQ')).toBe('FAQ');
    expect(answerableSection('SECTION_STALE:FAQ')).toBeNull();
    expect(answerableSection('SECTION_EMPTY:NOPE')).toBeNull();
    expect(answerableSection('NO_FACTS')).toBeNull();
  });
});
