import { describe, expect, it } from 'vitest';
import {
  COMPETITORS_BLOCK_END,
  COMPETITORS_BLOCK_START,
  CreateBusinessCompetitorSchema,
  competitorsSectionBlock,
  mergeCompetitorsBlock,
} from './business-competitors';

const card = {
  name: 'برند الف',
  kind: 'DIRECT' as const,
  website: 'https://a.example',
  positioning: 'ارزان و سریع',
  pricing: 'ارزان‌تر',
  strengths: ['ارسال سریع'],
  weaknesses: ['پشتیبانی ضعیف'],
  difference: 'ما گارانتی داریم',
};

describe('competitorsSectionBlock', () => {
  it('is empty without active cards', () => {
    expect(competitorsSectionBlock([])).toBe('');
    expect(competitorsSectionBlock([{ ...card, isActive: false }])).toBe('');
  });

  it('lists only the filled lines of each active card, between markers', () => {
    const out = competitorsSectionBlock([card, { ...card, name: 'ب', isActive: false }]);
    expect(out.startsWith(COMPETITORS_BLOCK_START)).toBe(true);
    expect(out.endsWith(COMPETITORS_BLOCK_END)).toBe(true);
    expect(out).toContain('**برند الف** (direct competitor) — https://a.example');
    expect(out).toContain('Strengths: ارسال سریع');
    expect(out).not.toContain('**ب**');
    const bare = competitorsSectionBlock([{ ...card, website: '', positioning: '', pricing: '', strengths: [], weaknesses: [], difference: '' }]);
    expect(bare.split('\n')).toHaveLength(3);
  });
});

describe('mergeCompetitorsBlock', () => {
  const block = competitorsSectionBlock([card]);

  it('appends after the admin text and replaces its own block on the next run', () => {
    const first = mergeCompetitorsBlock('متن دستی', block);
    expect(first.startsWith('متن دستی\n\n')).toBe(true);
    const next = competitorsSectionBlock([{ ...card, name: 'برند ب' }]);
    const second = mergeCompetitorsBlock(`${first}\n\nپایان`, next);
    expect(second).toContain('برند ب');
    expect(second).not.toContain('برند الف');
    expect(second.startsWith('متن دستی')).toBe(true);
    expect(second.endsWith('پایان')).toBe(true);
    expect(second.match(/competitors:start/g)).toHaveLength(1);
  });

  it('removes the old block, keeping the admin text, when no card is active', () => {
    expect(mergeCompetitorsBlock(`متن\n\n${block}`, '')).toBe('متن');
  });
});

describe('CreateBusinessCompetitorSchema', () => {
  it('needs a name, only accepts http(s) links and at most 6 points', () => {
    expect(CreateBusinessCompetitorSchema.safeParse({ name: ' ' }).success).toBe(false);
    expect(CreateBusinessCompetitorSchema.safeParse({ name: 'x', website: 'javascript:1' }).success).toBe(false);
    expect(CreateBusinessCompetitorSchema.safeParse({ name: 'x', strengths: Array(7).fill('a') }).success).toBe(false);
    expect(CreateBusinessCompetitorSchema.parse({ name: 'x' }).kind).toBe('DIRECT');
  });
});
