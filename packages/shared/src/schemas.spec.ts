import { describe, expect, it } from 'vitest';
import {
  CreateCampaignSchema,
  CreateSampleSchema,
  CreateTagSchema,
  CreateTopicSchema,
  GenerateContentSchema,
  IdeateSchema,
  MAX_TAGS_PER_ITEM,
  PaginationQuerySchema,
  SetTagsSchema,
  UpdateCampaignSchema,
  UpdatePrincipleSchema,
  UpdateTagSchema,
  UpdateTopicSchema,
} from './schemas';
import { UpdateBusinessSchema } from './business';

describe('shared schemas', () => {
  it('applies topic defaults', () => {
    const v = CreateTopicSchema.parse({ title: 'عنوان', description: 'یک توضیح کافی و بلند' });
    expect(v).toMatchObject({ platform: 'INSTAGRAM', language: 'fa', audience: '' });
  });

  it('accepts only http(s) sample urls', () => {
    expect(CreateSampleSchema.safeParse({ url: 'https://example.com' }).success).toBe(true);
    expect(CreateSampleSchema.safeParse({ url: 'file:///etc/passwd' }).success).toBe(false);
    expect(CreateSampleSchema.safeParse({ url: 'javascript:alert(1)' }).success).toBe(false);
  });

  it('requires an idea or a brief to generate content', () => {
    expect(GenerateContentSchema.safeParse({}).success).toBe(false);
    expect(GenerateContentSchema.safeParse({ brief: 'short' }).success).toBe(false);
    expect(GenerateContentSchema.safeParse({ brief: 'a sufficiently long brief' }).success).toBe(
      true,
    );
    expect(GenerateContentSchema.safeParse({ ideaId: 'abc' }).success).toBe(true);
  });

  it('bounds ideation count', () => {
    expect(IdeateSchema.safeParse({ count: 0 }).success).toBe(false);
    expect(IdeateSchema.safeParse({ count: 21 }).success).toBe(false);
    expect(IdeateSchema.parse({}).count).toBe(5);
  });

  it('coerces pagination query strings', () => {
    expect(PaginationQuerySchema.parse({ page: '2', pageSize: '10' })).toMatchObject({
      page: 2,
      pageSize: 10,
    });
    expect(PaginationQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
  });
});

describe('tag and campaign schemas', () => {
  it('trims tag names and defaults the color', () => {
    expect(CreateTagSchema.parse({ name: '  آموزشی ' })).toEqual({ name: 'آموزشی', color: 'slate' });
    expect(CreateTagSchema.safeParse({ name: '' }).success).toBe(false);
    expect(CreateTagSchema.safeParse({ name: 'x', color: 'chartreuse' }).success).toBe(false);
  });

  it('a tag PATCH does not reset the color', () => {
    expect(UpdateTagSchema.parse({ name: 'new' })).toEqual({ name: 'new' });
  });

  it('caps the tags of one item', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
    expect(SetTagsSchema.safeParse({ tagIds: ids(MAX_TAGS_PER_ITEM) }).success).toBe(true);
    expect(SetTagsSchema.safeParse({ tagIds: ids(MAX_TAGS_PER_ITEM + 1) }).success).toBe(false);
    expect(SetTagsSchema.safeParse({ tagIds: [] }).success).toBe(true);
  });

  it('rejects a campaign that ends before it starts', () => {
    const base = { name: 'کمپین نوروز' };
    expect(CreateCampaignSchema.safeParse(base).success).toBe(true);
    expect(
      CreateCampaignSchema.safeParse({
        ...base,
        startsAt: '2027-03-21T00:00:00.000Z',
        endsAt: '2027-04-02T00:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      CreateCampaignSchema.safeParse({
        ...base,
        startsAt: '2027-04-02T00:00:00.000Z',
        endsAt: '2027-03-21T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('a campaign PATCH keeps omitted fields out and lets dates be cleared', () => {
    expect(UpdateCampaignSchema.parse({ status: 'ARCHIVED' })).toEqual({ status: 'ARCHIVED' });
    expect(UpdateCampaignSchema.parse({ endsAt: null })).toEqual({ endsAt: null });
  });
});

describe('PATCH schemas (patchOf)', () => {
  it('do not fill omitted fields with create defaults', () => {
    expect(UpdateTopicSchema.parse({ status: 'ARCHIVED' })).toEqual({ status: 'ARCHIVED' });
    expect(UpdatePrincipleSchema.parse({ isActive: false })).toEqual({ isActive: false });
    expect(UpdateBusinessSchema.parse({ status: 'ARCHIVED' })).toEqual({ status: 'ARCHIVED' });
  });

  it('still validate and transform the fields that are sent', () => {
    expect(UpdateBusinessSchema.parse({ tagline: ' x ' })).toEqual({ tagline: 'x' });
    expect(UpdateBusinessSchema.safeParse({ website: 'nope' }).success).toBe(false);
    expect(UpdateTopicSchema.safeParse({ title: 'x' }).success).toBe(false);
  });
});
