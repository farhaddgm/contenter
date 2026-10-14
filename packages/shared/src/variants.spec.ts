import { describe, expect, it } from 'vitest';
import {
  MAX_VARIANTS,
  VARIANT_ANGLES,
  VARIANT_ANGLE_INSTRUCTION,
  VariantSettingsSchema,
  isVariantAngle,
  planPick,
  variantAnglesFor,
  type VariantMember,
} from './variants';
import { GenerateContentSchema } from './schemas';

const m = (id: string, status: VariantMember['status'], hasVersion = true): VariantMember => ({
  id,
  status,
  hasVersion,
});

describe('variant angles', () => {
  it('hands out distinct angles in order, up to the maximum', () => {
    expect(variantAnglesFor(1)).toEqual(['DIRECT']);
    expect(variantAnglesFor(3)).toEqual([...VARIANT_ANGLES]);
    expect(variantAnglesFor(9)).toHaveLength(MAX_VARIANTS);
    expect(variantAnglesFor(0)).toEqual([]);
    expect(new Set(variantAnglesFor(3)).size).toBe(3);
  });

  it('every angle has an instruction and unknown values are not angles', () => {
    for (const a of VARIANT_ANGLES) expect(VARIANT_ANGLE_INSTRUCTION[a].length).toBeGreaterThan(20);
    expect(isVariantAngle('STORY')).toBe(true);
    expect(isVariantAngle('whatever')).toBe(false);
    expect(isVariantAngle(undefined)).toBe(false);
  });
});

describe('planPick', () => {
  it('rejects the other drafts and keeps the chosen one', () => {
    const plan = planPick([m('a', 'DRAFT'), m('b', 'DRAFT'), m('c', 'FAILED', false)], 'b');
    expect(plan).toEqual({ ok: true, reject: ['a', 'c'], keep: [] });
  });

  it('leaves alone a draft someone already sent to review or approved', () => {
    const plan = planPick([m('a', 'DRAFT'), m('b', 'IN_REVIEW'), m('c', 'APPROVED')], 'a');
    expect(plan).toEqual({ ok: true, reject: [], keep: ['b', 'c'] });
  });

  it('refuses while another draft is still being written', () => {
    expect(planPick([m('a', 'DRAFT'), m('b', 'GENERATING', false)], 'a')).toEqual({
      ok: false,
      reason: 'still_generating',
    });
  });

  it('refuses a chosen draft that is not a DRAFT with text, or is not in the group', () => {
    expect(planPick([m('a', 'APPROVED'), m('b', 'DRAFT')], 'a')).toEqual({
      ok: false,
      reason: 'not_draft',
    });
    expect(planPick([m('a', 'DRAFT', false)], 'a')).toEqual({ ok: false, reason: 'not_draft' });
    expect(planPick([m('a', 'DRAFT')], 'zzz')).toEqual({ ok: false, reason: 'not_in_group' });
  });

  it('a group of one just keeps it', () => {
    expect(planPick([m('a', 'DRAFT')], 'a')).toEqual({ ok: true, reject: [], keep: [] });
  });
});

describe('contracts', () => {
  it('GenerateContentSchema defaults to one draft and bounds the count', () => {
    expect(GenerateContentSchema.parse({ brief: 'یک پست دربارهٔ قهوه' }).variants).toBe(1);
    expect(
      GenerateContentSchema.parse({ brief: 'یک پست دربارهٔ قهوه', variants: 3 }).variants,
    ).toBe(3);
    expect(
      GenerateContentSchema.safeParse({ brief: 'یک پست دربارهٔ قهوه', variants: 4 }).success,
    ).toBe(false);
    expect(
      GenerateContentSchema.safeParse({ brief: 'یک پست دربارهٔ قهوه', variants: 0 }).success,
    ).toBe(false);
  });

  it('VariantSettingsSchema has defaults and bounds', () => {
    expect(VariantSettingsSchema.parse({})).toEqual({ maxVariants: 3 });
    expect(VariantSettingsSchema.safeParse({ maxVariants: 4 }).success).toBe(false);
    expect(VariantSettingsSchema.safeParse({ maxVariants: 0 }).success).toBe(false);
  });
});
