import { describe, expect, it } from 'vitest';
import {
  CreateBusinessOfferingSchema,
  OFFERING_GUARDRAILS_MAX,
  OFFERING_TREE_DEPTH_MAX,
  UpdateBusinessOfferingSchema,
  type OfferingCore,
} from './business-catalog';
import {
  CreateBusinessSegmentSchema,
  OFFERING_SEGMENTS_MAX,
  SetOfferingSegmentsSchema,
  UpdateBusinessSegmentSchema,
  orderSegmentLinks,
} from './business-segments';
import {
  effectiveGuardrails,
  hasOfferingTree,
  offeringAncestors,
  offeringParentProblem,
  offeringQualityRules,
  orderOfferingTree,
} from './offering-tree';
import { checkContentQuality } from './quality';

const row = (id: string, parentId: string | null = null, extra: Record<string, unknown> = {}) => ({
  id,
  parentId,
  ...extra,
});

describe('offeringParentProblem', () => {
  // L (line) → P (product) → V (variant)
  const rows = [row('L'), row('P', 'L'), row('V', 'P'), row('X')];

  it('accepts a root, a missing parent id and a valid move', () => {
    expect(offeringParentProblem({ id: 'X', parentId: null, rows })).toBeNull();
    expect(offeringParentProblem({ id: 'X', parentId: undefined, rows })).toBeNull();
    expect(offeringParentProblem({ id: 'X', parentId: 'L', rows })).toBeNull();
    expect(offeringParentProblem({ parentId: 'P', rows })).toBeNull(); // a new variant under a product
  });

  it('refuses a parent that is not one of the business offerings', () => {
    expect(offeringParentProblem({ id: 'X', parentId: 'elsewhere', rows })).toMatch(/same business/);
  });

  it('refuses itself and its own descendants (no cycles)', () => {
    expect(offeringParentProblem({ id: 'L', parentId: 'L', rows })).toMatch(/own parent/);
    expect(offeringParentProblem({ id: 'L', parentId: 'V', rows })).toMatch(/own variants/);
    expect(offeringParentProblem({ id: 'L', parentId: 'P', rows })).toMatch(/own variants/);
  });

  it(`keeps the tree within ${OFFERING_TREE_DEPTH_MAX} levels, counting what hangs under the moved row`, () => {
    // nothing can go under a variant (it is level 3)
    expect(offeringParentProblem({ id: 'X', parentId: 'V', rows })).toMatch(/at most 3 levels/);
    expect(offeringParentProblem({ parentId: 'V', rows })).toMatch(/at most 3 levels/);
    // moving the whole line L (3 levels deep) under X would make 4
    expect(offeringParentProblem({ id: 'L', parentId: 'X', rows })).toMatch(/at most 3 levels/);
    // moving the product P (with its variant) under X (a root) makes 3
    expect(offeringParentProblem({ id: 'P', parentId: 'X', rows })).toBeNull();
  });
});

describe('orderOfferingTree', () => {
  it('puts variants right after their line, keeping the given order among siblings', () => {
    const rows = [row('b'), row('a'), row('a2', 'a'), row('b1', 'b'), row('a1', 'a'), row('a1x', 'a1')];
    expect(orderOfferingTree(rows).map((x) => `${x.depth}:${x.row.id}`)).toEqual([
      '0:b',
      '1:b1',
      '0:a',
      '1:a2',
      '1:a1',
      '2:a1x',
    ]);
  });

  it('shows a row whose parent is not in the list as a root', () => {
    expect(orderOfferingTree([row('c', 'gone'), row('d')]).map((x) => x.depth)).toEqual([0, 0]);
  });

  it('never loses a row, even with a cycle written by hand in the database', () => {
    const out = orderOfferingTree([row('a', 'b'), row('b', 'a')]);
    expect(out.map((x) => x.row.id).sort()).toEqual(['a', 'b']);
  });

  it('knows whether there is a tree at all', () => {
    expect(hasOfferingTree([row('a'), row('b')])).toBe(false);
    expect(hasOfferingTree([row('a'), row('b', 'a')])).toBe(true);
    expect(hasOfferingTree([row('b', 'gone')])).toBe(false);
  });

  it('lists ancestors nearest first', () => {
    const byId = new Map([row('L'), row('P', 'L'), row('V', 'P')].map((r) => [r.id, r]));
    expect(offeringAncestors('V', byId)).toEqual(['P', 'L']);
    expect(offeringAncestors('L', byId)).toEqual([]);
  });
});

describe('effectiveGuardrails', () => {
  const byId = new Map(
    [
      row('L', null, { guardrails: ['سود تضمینی', 'بدون ریسک'] }),
      row('P', 'L', { guardrails: ['سود  تضمینی', 'فوری'] }),
      row('V', 'P'),
    ].map((r) => [r.id, r]),
  );

  it('gives a variant its own phrases and those of the lines above, once each', () => {
    expect(effectiveGuardrails('P', byId)).toEqual(['سود  تضمینی', 'فوری', 'بدون ریسک']);
    expect(effectiveGuardrails('V', byId)).toEqual(['سود  تضمینی', 'فوری', 'بدون ریسک']);
  });

  it('gives a root only its own', () => {
    expect(effectiveGuardrails('L', byId)).toEqual(['سود تضمینی', 'بدون ریسک']);
  });

  it('still applies the phrases of a line that is switched off (absent from the list)', () => {
    // only the variant is usable; its line and the line above it are read through `parent`
    const only = new Map([
      [
        'V',
        {
          ...row('V', 'P', { guardrails: ['فوری'] }),
          parent: { guardrails: ['سود تضمینی'], parent: { guardrails: ['بدون ریسک'] } },
        },
      ],
    ]);
    expect(effectiveGuardrails('V', only)).toEqual(['فوری', 'سود تضمینی', 'بدون ریسک']);
  });
});

describe('never-say phrases in the quality gate (GUARDRAIL_HIT)', () => {
  const core = (id: string, name: string, parentId: string | null, guardrails: string[]): OfferingCore & { id: string } => ({
    id,
    parentId,
    guardrails,
    name,
    aliases: [],
    kind: 'SERVICE',
    status: 'ACTIVE',
    push: 1,
    summary: '',
    features: [],
    priceAmount: null,
    priceCurrency: null,
    priceFrom: false,
    priceUnit: '',
    priceValidUntil: null,
    availableFrom: null,
    availableUntil: null,
  });
  const offerings = offeringQualityRules([
    core('L', 'تسهیلات ویپاد', null, ['سود تضمینی']),
    core('V', 'تسهیلات تجهیزات', 'L', ['بدون ضامن']),
  ]);
  const hits = (body: string) =>
    checkContentQuality({
      title: '',
      body,
      hashtags: [],
      cta: '',
      platform: 'INSTAGRAM',
      format: 'POST',
      offerings,
    }).issues.filter((i) => i.code === 'GUARDRAIL_HIT');

  it('warns when the text about a variant uses its own phrase or its line’s', () => {
    expect(hits('تسهیلات تجهیزات با سود تضمینی.')).toHaveLength(1);
    expect(hits('تسهیلات تجهیزات بدون ضامن.')).toHaveLength(1);
    const both = hits('تسهیلات تجهیزات بدون ضامن و سود تضمینی.');
    expect(both.map((i) => i.params.phrase).sort()).toEqual(['بدون ضامن', 'سود تضمینی']);
    expect(both.every((i) => i.severity === 'warn')).toBe(true);
  });

  it('also finds the phrase in another sentence of a text that names the offering', () => {
    expect(hits('تسهیلات تجهیزات را ببینید. سود تضمینی دریافت کنید.')).toHaveLength(1);
  });

  it('does not bind the line by what is written only for one of its variants', () => {
    expect(hits('تسهیلات ویپاد بدون ضامن.')).toEqual([]);
  });

  it('says nothing when the offering is not mentioned, or the phrase is absent', () => {
    expect(hits('سود تضمینی در هیچ جا نیست؟')).toEqual([]);
    expect(hits('تسهیلات تجهیزات با شرایط روشن.')).toEqual([]);
  });

  it('adds no rule field for an offering without phrases', () => {
    const [plain] = offeringQualityRules([core('Z', 'ساده', null, [])]);
    expect(plain).not.toHaveProperty('guardrails');
  });
});

describe('schemas', () => {
  it('accepts a parent id and phrases, with limits', () => {
    expect(CreateBusinessOfferingSchema.parse({ name: 'x', parentId: 'abc', guardrails: ['ab'] })).toMatchObject({
      parentId: 'abc',
      guardrails: ['ab'],
    });
    expect(CreateBusinessOfferingSchema.parse({ name: 'x' })).toMatchObject({ guardrails: [] });
    expect(
      CreateBusinessOfferingSchema.safeParse({
        name: 'x',
        guardrails: Array.from({ length: OFFERING_GUARDRAILS_MAX + 1 }, (_, i) => `phrase ${i}`),
      }).success,
    ).toBe(false);
    expect(CreateBusinessOfferingSchema.safeParse({ name: 'x', guardrails: ['a'] }).success).toBe(false);
  });

  it('an update that omits them leaves the parent and the phrases alone, and null clears the parent', () => {
    expect(UpdateBusinessOfferingSchema.parse({ push: 2 })).toEqual({ push: 2 });
    expect(UpdateBusinessOfferingSchema.parse({ parentId: null })).toEqual({ parentId: null });
  });

  it('segments: defaults, limits and a patch that keeps what it does not name', () => {
    expect(CreateBusinessSegmentSchema.parse({ name: 'کارمند' })).toMatchObject({
      kind: 'PERSONA',
      goals: [],
      messageAngle: '',
    });
    expect(CreateBusinessSegmentSchema.safeParse({ name: 'x', pains: Array(7).fill('p') }).success).toBe(false);
    expect(CreateBusinessSegmentSchema.safeParse({ name: '  ' }).success).toBe(false);
    expect(UpdateBusinessSegmentSchema.parse({ summary: 's' })).toEqual({ summary: 's' });
  });

  it('links: at most the limit, each audience once, main audience first', () => {
    expect(SetOfferingSegmentsSchema.parse({ links: [] })).toEqual({ links: [] });
    expect(SetOfferingSegmentsSchema.parse({ links: [{ segmentId: 'a' }] }).links[0]!.fit).toBe(2);
    expect(
      SetOfferingSegmentsSchema.safeParse({ links: [{ segmentId: 'a' }, { segmentId: 'a' }] }).success,
    ).toBe(false);
    expect(
      SetOfferingSegmentsSchema.safeParse({
        links: Array.from({ length: OFFERING_SEGMENTS_MAX + 1 }, (_, i) => ({ segmentId: `s${i}` })),
      }).success,
    ).toBe(false);
    expect(SetOfferingSegmentsSchema.safeParse({ links: [{ segmentId: 'a', fit: 3 }] }).success).toBe(false);
    expect(
      orderSegmentLinks([
        { segmentId: 'a', fit: 1 },
        { segmentId: 'b', fit: 2 },
      ]).map((l) => l.segmentId),
    ).toEqual(['b', 'a']);
  });
});
