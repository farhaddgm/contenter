import { describe, expect, it } from 'vitest';
import {
  EditCategory,
  EditLearningResultSchema,
  MAX_EDIT_PAIRS,
  MIN_EDIT_PAIRS,
  MIN_EVIDENCE_PAIRS,
} from './edit-learning';

const suggestion = {
  kind: 'AVOID',
  category: 'OPENING',
  text: 'مقدمه را با احوال‌پرسی شروع نکن',
  rationale: 'در چند محتوا حذف شده',
  evidence: ['P1', 'P2'],
};

describe('EditLearningResultSchema', () => {
  it('accepts suggestions with evidence, and an empty list', () => {
    expect(EditLearningResultSchema.safeParse({ suggestions: [suggestion] }).success).toBe(true);
    expect(EditLearningResultSchema.safeParse({ suggestions: [] }).success).toBe(true);
  });

  it('fills a missing rationale', () => {
    const { rationale: _ignored, ...bare } = suggestion;
    const parsed = EditLearningResultSchema.parse({ suggestions: [bare] });
    expect(parsed.suggestions[0]!.rationale).toBe('');
  });

  it('rejects an unknown kind or category, no evidence, and a too short text', () => {
    const bad = (over: object) =>
      EditLearningResultSchema.safeParse({ suggestions: [{ ...suggestion, ...over }] }).success;
    expect(bad({ kind: 'NEVER' })).toBe(false);
    expect(bad({ category: 'WEATHER' })).toBe(false);
    expect(bad({ evidence: [] })).toBe(false);
    expect(bad({ text: 'کوتاه' })).toBe(true);
    expect(bad({ text: 'abc' })).toBe(false);
  });
});

describe('limits', () => {
  it('need at least two pairs for a pattern, and enough pairs overall to find one', () => {
    expect(MIN_EVIDENCE_PAIRS).toBeGreaterThanOrEqual(2);
    expect(MIN_EDIT_PAIRS).toBeGreaterThanOrEqual(MIN_EVIDENCE_PAIRS);
    expect(MAX_EDIT_PAIRS).toBeGreaterThanOrEqual(MIN_EDIT_PAIRS);
  });

  it('lists the categories the prompt names', () => {
    expect([...EditCategory]).toEqual([
      'LENGTH',
      'OPENING',
      'TONE',
      'TERMINOLOGY',
      'FACTS',
      'STRUCTURE',
      'CTA',
      'FORMATTING',
      'CLARITY',
      'OTHER',
    ]);
  });
});
