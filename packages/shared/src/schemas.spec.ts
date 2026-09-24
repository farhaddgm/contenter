import { describe, expect, it } from 'vitest';
import {
  CreateSampleSchema,
  CreateTopicSchema,
  GenerateContentSchema,
  IdeateSchema,
  PaginationQuerySchema,
} from './schemas';

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
