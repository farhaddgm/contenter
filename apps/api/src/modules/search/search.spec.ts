import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AccessService } from '../../common/access';
import type { AuthUser } from '../../common/auth.decorators';
import { SearchService } from './search.module';

const editor: AuthUser = { id: 'u1', email: 'e@x.test', role: 'EDITOR' };
const admin: AuthUser = { id: 'a', email: 'a@x.test', role: 'ADMIN' };
const access = {
  visibleTopics: (u: AuthUser) => (u.role === 'ADMIN' ? undefined : { createdById: u.id }),
} as unknown as AccessService;

const tag = {
  id: 'g1',
  topicId: 't1',
  name: 'edu',
  color: 'blue',
  createdAt: new Date('2026-10-01'),
};
const topic = { id: 't1', title: 'سرمایه‌گذاری', platform: 'INSTAGRAM' };

const content = (over: Record<string, unknown>) => ({
  id: 'c',
  title: 'عنوان',
  brief: '',
  status: 'DRAFT',
  format: 'POST',
  platform: null,
  topic,
  tags: [tag],
  currentVersion: { title: 'عنوان', body: '', cta: '', notes: '' },
  ...over,
});

function make(rows: { contents?: unknown[]; ideas?: unknown[]; topics?: unknown[] } = {}) {
  const prisma = {
    content: { findMany: vi.fn(async () => rows.contents ?? []) },
    idea: { findMany: vi.fn(async () => rows.ideas ?? []) },
    topic: { findMany: vi.fn(async () => rows.topics ?? []) },
  };
  return { svc: new SearchService(prisma as unknown as PrismaService, access), prisma };
}

describe('SearchService', () => {
  it('returns nothing, and asks the database nothing, for a query of only punctuation', async () => {
    const { svc, prisma } = make();
    const res = await svc.search({ q: '?!', limit: 8 }, editor);
    expect(res).toEqual({ terms: [], contents: [], ideas: [], topics: [] });
    expect(prisma.content.findMany).not.toHaveBeenCalled();
  });

  it('only looks in the topics the caller can see, and in one topic when asked', async () => {
    const { svc, prisma } = make();
    await svc.search({ q: 'سرمایه', limit: 8, topicId: 't1' }, editor);
    const contentWhere = prisma.content.findMany.mock.calls[0]![0].where;
    expect(contentWhere).toMatchObject({ topic: { createdById: 'u1' }, topicId: 't1' });
    const topicWhere = prisma.topic.findMany.mock.calls[0]![0].where;
    expect(topicWhere.AND).toEqual(expect.arrayContaining([{ createdById: 'u1' }, { id: 't1' }]));
  });

  it('does not limit an admin by topic', async () => {
    const { svc, prisma } = make();
    await svc.search({ q: 'سرمایه', limit: 8 }, admin);
    expect(prisma.content.findMany.mock.calls[0]![0].where.topic).toBeUndefined();
  });

  it('ranks a title match above a body match and keeps the best few', async () => {
    const { svc } = make({
      contents: [
        content({
          id: 'body',
          title: 'یک پست',
          currentVersion: {
            title: 'یک پست',
            body: 'درباره سرمایه‌گذاری هوشمند',
            cta: '',
            notes: '',
          },
        }),
        content({
          id: 'title',
          title: 'سرمایه‌گذاری برای تازه‌کارها',
          currentVersion: { title: 'سرمایه‌گذاری برای تازه‌کارها', body: '', cta: '', notes: '' },
        }),
        content({
          id: 'late',
          title: 'سرمایه',
          currentVersion: { title: 'x', body: '', cta: '', notes: '' },
        }),
      ],
    });
    const res = await svc.search({ q: 'سرمایه', limit: 2 }, editor);
    expect(res.contents.map((c) => c.id)).toEqual(['title', 'late']);
    expect(res.contents[0]!.score).toBeGreaterThan(res.contents[1]!.score);
  });

  it('shows an excerpt around the match, found on the other keyboard too', async () => {
    const body = `${'مقدمهٔ بلند و بی‌ربط. '.repeat(10)}نظر علی دربارهٔ کتاب مهم است ${'پایان. '.repeat(10)}`;
    const { svc } = make({
      contents: [
        content({ id: 'c1', currentVersion: { title: 'عنوان', body, cta: '', notes: '' } }),
      ],
    });
    const res = await svc.search({ q: 'علي', limit: 8 }, editor);
    expect(res.terms).toEqual(['علي']);
    const hit = res.contents[0]!;
    expect(hit.snippet).toContain('علی');
    expect(hit.snippet.startsWith('…')).toBe(true);
  });

  it('describes a hit with its topic, status, format, effective platform and tags', async () => {
    const { svc } = make({ contents: [content({ id: 'c1', platform: 'X', format: 'THREAD' })] });
    const hit = (await svc.search({ q: 'عنوان', limit: 8 }, editor)).contents[0]!;
    expect(hit).toMatchObject({
      id: 'c1',
      topic: { id: 't1', title: 'سرمایه‌گذاری' },
      status: 'DRAFT',
      format: 'THREAD',
      platform: 'X',
    });
    expect(hit.tags).toEqual([{ ...tag, createdAt: '2026-10-01T00:00:00.000Z' }]);
  });

  it('uses the topic’s platform for a content made for none', async () => {
    const { svc } = make({ contents: [content({ id: 'c1' })] });
    expect((await svc.search({ q: 'عنوان', limit: 8 }, editor)).contents[0]!.platform).toBe(
      'INSTAGRAM',
    );
  });

  it('searches ideas and topics, each with their own fields', async () => {
    const { svc, prisma } = make({
      ideas: [
        {
          id: 'i1',
          title: 'ایدهٔ ساده',
          angle: 'زاویهٔ سرمایه',
          hook: 'قلاب',
          rationale: '',
          status: 'PROPOSED',
          format: 'POST',
          topic: { id: 't1', title: 'سرمایه‌گذاری' },
          tags: [],
        },
      ],
      topics: [
        {
          id: 't1',
          title: 'سرمایه‌گذاری',
          description: 'آموزش سرمایه‌گذاری برای تازه‌کارها',
          audience: '',
          platform: 'INSTAGRAM',
          status: 'ACTIVE',
        },
      ],
    });
    const res = await svc.search({ q: 'سرمایه', limit: 8 }, editor);
    expect(res.ideas[0]).toMatchObject({ id: 'i1', status: 'PROPOSED', snippet: 'زاویهٔ سرمایه' });
    expect(res.topics[0]).toMatchObject({ id: 't1', topic: null, platform: 'INSTAGRAM' });
    const ideaWhere = prisma.idea.findMany.mock.calls[0]![0].where.AND[0].OR;
    expect(ideaWhere.map((c: Record<string, unknown>) => Object.keys(c)[0])).toEqual(
      expect.arrayContaining(['title', 'angle', 'hook', 'rationale']),
    );
  });
});
