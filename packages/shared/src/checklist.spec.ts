import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_MAX_ITEMS,
  SaveChecklistsSchema,
  checklistItemsFor,
  requiredOpenCount,
  type ChecklistTemplate,
} from './checklist';

const item = (id: string, text: string, required = false) => ({
  id,
  text,
  required,
  auto: null,
});

describe('SaveChecklistsSchema', () => {
  const ok = {
    templates: [{ platform: null, items: [{ text: 'لینک بیو عوض شده؟', required: true }] }],
  };

  it('accepts points with defaults and trims them', () => {
    const parsed = SaveChecklistsSchema.parse({
      templates: [{ platform: 'INSTAGRAM', items: [{ text: '  عکس مجوز دارد؟  ' }] }],
    });
    expect(parsed.templates[0]!.items[0]).toEqual({
      text: 'عکس مجوز دارد؟',
      required: false,
      auto: null,
    });
    expect(SaveChecklistsSchema.safeParse(ok).success).toBe(true);
  });

  it('rejects more than the maximum points, a too short point and an unknown platform', () => {
    const many = Array.from({ length: CHECKLIST_MAX_ITEMS + 1 }, (_, i) => ({
      text: `نکتهٔ ${i + 1}`,
    }));
    expect(
      SaveChecklistsSchema.safeParse({ templates: [{ platform: null, items: many }] }).success,
    ).toBe(false);
    expect(
      SaveChecklistsSchema.safeParse({ templates: [{ platform: null, items: [{ text: 'ا' }] }] })
        .success,
    ).toBe(false);
    expect(
      SaveChecklistsSchema.safeParse({ templates: [{ platform: 'MYSPACE', items: [] }] }).success,
    ).toBe(false);
  });

  it('rejects two checklists for one platform, and a required automatic point', () => {
    expect(
      SaveChecklistsSchema.safeParse({
        templates: [
          { platform: 'X', items: [] },
          { platform: 'X', items: [] },
        ],
      }).success,
    ).toBe(false);
    expect(
      SaveChecklistsSchema.safeParse({
        templates: [
          {
            platform: null,
            items: [{ text: 'بدون هشدار', auto: 'QUALITY_CLEAN', required: true }],
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('checklistItemsFor', () => {
  const templates: ChecklistTemplate[] = [
    {
      platform: null,
      items: [item('g1', 'لینک بیو عوض شده؟', true), item('g2', 'هشتگ برند هست؟')],
    },
    { platform: 'INSTAGRAM', items: [item('i1', 'کاور ۱:۱ است؟'), item('i2', 'هشتگ برند هست؟')] },
    { platform: 'X', items: [item('x1', 'کمتر از ۲۸۰ نویسه؟')] },
  ];

  it('puts the general points first, then those of the platform, without repeats', () => {
    expect(checklistItemsFor(templates, 'INSTAGRAM').map((i) => i.id)).toEqual(['g1', 'g2', 'i1']);
    expect(checklistItemsFor(templates, 'X').map((i) => i.id)).toEqual(['g1', 'g2', 'x1']);
  });

  it('gives only the general points for a platform without its own, and nothing without templates', () => {
    expect(checklistItemsFor(templates, 'TELEGRAM').map((i) => i.id)).toEqual(['g1', 'g2']);
    expect(checklistItemsFor([], 'INSTAGRAM')).toEqual([]);
  });
});

describe('requiredOpenCount', () => {
  it('counts the required points that are not ticked', () => {
    expect(
      requiredOpenCount([
        { required: true, checked: false },
        { required: true, checked: true },
        { required: false, checked: false },
      ]),
    ).toBe(1);
    expect(requiredOpenCount([])).toBe(0);
  });
});
