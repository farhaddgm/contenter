import { describe, expect, it } from 'vitest';
import {
  buildContextReport,
  calibrateRatio,
  contextWarnings,
  DEFAULT_CHARS_PER_TOKEN,
  estimateTokens,
  MIN_RATIO_SAMPLES,
  type ContextBlock,
} from './context-report';

const block = (over: Partial<ContextBlock> & Pick<ContextBlock, 'id'>): ContextBlock => ({
  chars: 100,
  estTokens: 0,
  cut: false,
  omitted: 0,
  unreviewed: false,
  text: 'x',
  ...over,
});

const samples = (n: number, chars: number, tokens: number) =>
  Array.from({ length: n }, () => ({ chars, tokens }));

describe('estimateTokens', () => {
  it('rounds up and is zero for nothing or a bad ratio', () => {
    expect(estimateTokens(100, 2.5)).toBe(40);
    expect(estimateTokens(101, 2.5)).toBe(41);
    expect(estimateTokens(0, 2.5)).toBe(0);
    expect(estimateTokens(100, 0)).toBe(0);
    expect(estimateTokens(100, Number.NaN)).toBe(0);
  });
});

describe('calibrateRatio', () => {
  it('keeps the default until there are enough measured jobs', () => {
    const r = calibrateRatio(samples(MIN_RATIO_SAMPLES - 1, 3000, 1000));
    expect(r).toEqual({ charsPerToken: DEFAULT_CHARS_PER_TOKEN, source: 'DEFAULT', samples: MIN_RATIO_SAMPLES - 1 });
  });

  it('measures total characters per total token from MIN_RATIO_SAMPLES jobs', () => {
    const r = calibrateRatio(samples(MIN_RATIO_SAMPLES, 3000, 1000));
    expect(r).toEqual({ charsPerToken: 3, source: 'MEASURED', samples: MIN_RATIO_SAMPLES });
  });

  it('ignores jobs without a size or without tokens, and clamps absurd results', () => {
    const mixed = [...samples(MIN_RATIO_SAMPLES, 3000, 1000), { chars: 0, tokens: 5 }, { chars: 5, tokens: 0 }];
    expect(calibrateRatio(mixed).samples).toBe(MIN_RATIO_SAMPLES);
    expect(calibrateRatio(samples(MIN_RATIO_SAMPLES, 100_000, 10)).charsPerToken).toBe(6);
    expect(calibrateRatio(samples(MIN_RATIO_SAMPLES, 10, 1000)).charsPerToken).toBe(1);
  });
});

describe('contextWarnings', () => {
  it('names cut sections, omitted blocks, unreviewed AI text and a missing facts block', () => {
    const w = contextWarnings([
      block({ id: 'HEAD' }),
      block({ id: 'SECTION:OVERVIEW', cut: true }),
      block({ id: 'SECTION:SERVICES', unreviewed: true }),
      block({ id: 'ASSETS', cut: true, omitted: 3 }),
    ]);
    const by = Object.fromEntries(w.map((x) => [x.code, x]));
    expect(by.SECTION_CUT?.blocks).toEqual(['SECTION:OVERVIEW']);
    expect(by.BLOCK_OMITTED?.blocks).toEqual(['ASSETS']);
    expect(by.UNREVIEWED_AI).toMatchObject({ count: 1, blocks: ['SECTION:SERVICES'] });
    expect(by.NO_FACTS).toBeTruthy();
    expect(by.DOCUMENTS_DOMINATE).toBeUndefined();
  });

  it('calls documents out when they are more than half of the prompt', () => {
    const w = contextWarnings([
      block({ id: 'HEAD', chars: 100 }),
      block({ id: 'FACTS', chars: 100 }),
      block({ id: 'DOCUMENTS', chars: 400 }),
    ]);
    expect(w.map((x) => x.code)).toEqual(['DOCUMENTS_DOMINATE']);
  });
});

describe('buildContextReport', () => {
  const ratio = { charsPerToken: 2, source: 'DEFAULT' as const, samples: 0 };
  const blocks = [
    { id: 'HEAD' as const, chars: 10, cut: false, omitted: 0, unreviewed: false, text: '0123456789' },
    { id: 'FACTS' as const, chars: 20, cut: false, omitted: 0, unreviewed: false, text: 'x'.repeat(20) },
  ];

  it('totals the blocks plus the blank lines between them and prices the input', () => {
    const r = buildContextReport({
      target: 'DRAFT',
      topicId: null,
      blocks,
      ratio,
      model: 'm',
      inputPricePerMillion: 4,
      needsTopic: true,
    });
    expect(r.totalChars).toBe(32);
    expect(r.estTokens).toBe(16);
    expect(r.blocks.map((b) => b.estTokens)).toEqual([5, 10]);
    expect(r.estCostUsd).toBeCloseTo(0.000064, 9);
    expect(r.needsTopic).toBe(true);
  });

  it('has no cost without a price', () => {
    const r = buildContextReport({
      target: 'IDEATE',
      topicId: 't',
      blocks,
      ratio,
      model: null,
      inputPricePerMillion: null,
      needsTopic: false,
    });
    expect(r.estCostUsd).toBeNull();
  });
});
