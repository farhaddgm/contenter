import { describe, expect, it, vi } from 'vitest';
import type { AccessService } from '../../common/access';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { SettingsService } from '../settings/settings.module';
import { SimilarityService, type SimilaritySubject } from './similarity.module';

const TEXT =
  'قهوه را تازه آسیاب کنید و آب را کمی صبر بدهید تا از جوش بیفتد. بعد آرام روی قهوه بریزید و سی ثانیه صبر کنید. حالا یک فنجان قهوهٔ خوب دارید.';
const OTHER =
  'مسابقهٔ فوتبال شب گذشته با نتیجهٔ دو بر یک به پایان رسید و هواداران تا دیروقت در خیابان‌ها جشن گرفتند. داور بازی هم تحسین شد.';

const admin = { id: 'a', role: 'ADMIN' } as AuthUser;
const editor = { id: 'e', role: 'EDITOR' } as AuthUser;

const subject: SimilaritySubject = {
  id: 'c1',
  topicId: 't1',
  businessId: 'b1',
  ideaId: 'i-own',
  sourceContentId: null,
  title: 'قهوه',
  body: TEXT,
};

function setup(over: { denyBusiness?: boolean; contents?: unknown[]; refs?: unknown[] } = {}) {
  const contentFind = vi.fn(
    async (_args: unknown) =>
      over.contents ?? [
        {
          id: 'c2',
          topicId: 't1',
          title: 'پست قبلی',
          currentVersion: { title: 'قهوه', body: TEXT },
        },
        {
          id: 'c3',
          topicId: 't1',
          title: 'فوتبال',
          currentVersion: { title: 'فوتبال', body: OTHER },
        },
        { id: 'c4', topicId: 't1', title: 'بدون نسخه', currentVersion: null },
      ],
  );
  const ideaFind = vi.fn(async (_args: unknown) => [
    { id: 'i1', topicId: 't1', title: 'ایده', angle: TEXT, hook: '', outline: [] },
  ]);
  const sampleFind = vi.fn(async (_args: unknown) => [
    {
      id: 's1',
      topicId: 't1',
      url: 'https://x.ir/p',
      manualText: OTHER,
      fetched: { title: 'نمونه', text: TEXT },
    },
  ]);
  const refFind = vi.fn(async (_args: unknown) => over.refs ?? []);
  const prisma = {
    content: { findMany: contentFind },
    idea: { findMany: ideaFind },
    sampleContent: { findMany: sampleFind },
    businessReference: { findMany: refFind },
  };
  const assert = vi.fn(async () => {
    if (over.denyBusiness) throw new Error('no access');
  });
  const access = {
    assert,
    visibleTopics: (u: AuthUser) => (u.role === 'ADMIN' ? undefined : { createdById: u.id }),
  };
  const settings = { getSimilarity: async () => ({ warnAt: 0.55, copyAt: 0.8 }) };
  const svc = new SimilarityService(
    prisma as unknown as PrismaService,
    access as unknown as AccessService,
    settings as unknown as SettingsService,
  );
  return { svc, contentFind, ideaFind, sampleFind, refFind, assert };
}

describe('SimilarityService', () => {
  it('compares contents, ideas and samples, and reports the copies best first', async () => {
    const { svc } = setup();
    const r = await svc.forContent(admin, subject);
    expect(r.level).toBe('COPY');
    expect(r.matches.map((m) => `${m.kind}:${m.id}`).sort()).toEqual([
      'CONTENT:c2',
      'IDEA:i1',
      'SAMPLE:s1',
    ]);
    // the content without a current version is not compared
    expect(r.compared).toBe(4);
  });

  it('searches the whole business, and only the topic when there is no business', async () => {
    const a = setup();
    await a.svc.forContent(admin, subject);
    expect(a.contentFind.mock.calls[0]![0]).toMatchObject({
      where: { topic: { businessId: 'b1' } },
    });
    const b = setup();
    await b.svc.forContent(admin, { ...subject, businessId: null });
    expect(b.contentFind.mock.calls[0]![0]).toMatchObject({ where: { topic: { id: 't1' } } });
    expect(b.refFind).not.toHaveBeenCalled();
  });

  it('limits the candidates to the topics the caller can see', async () => {
    const { svc, contentFind, ideaFind, sampleFind } = setup();
    await svc.forContent(editor, subject);
    const visible = { AND: [{ businessId: 'b1' }, { createdById: 'e' }] };
    for (const f of [contentFind, ideaFind, sampleFind]) {
      expect(f.mock.calls[0]![0]).toMatchObject({ where: { topic: visible } });
    }
  });

  it('leaves out the content itself, the idea it came from and its repurposed siblings', async () => {
    const { svc, contentFind, ideaFind } = setup();
    await svc.forContent(admin, { ...subject, sourceContentId: 'src' });
    const where = (contentFind.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where.id).toEqual({ notIn: ['c1', 'src'] });
    // contents that are not repurposed at all (NULL) must stay in
    expect(where.OR).toEqual([
      { sourceContentId: null },
      { sourceContentId: { notIn: ['c1', 'src'] } },
    ]);
    expect((ideaFind.mock.calls[0]![0] as { where: { id: unknown } }).where.id).toEqual({
      not: 'i-own',
    });
  });

  it('reads reference documents only for someone who can see the business', async () => {
    const refs = [{ id: 'r1', title: 'بروشور', url: '', content: TEXT }];
    const allowed = setup({ refs, contents: [] });
    const r = await allowed.svc.forContent(admin, subject);
    expect(r.matches.some((m) => m.kind === 'REFERENCE' && m.id === 'r1')).toBe(true);
    const denied = setup({ refs, contents: [], denyBusiness: true });
    await denied.svc.forContent(admin, subject);
    expect(denied.refFind).not.toHaveBeenCalled();
  });

  it('a different text finds nothing', async () => {
    const { svc } = setup({ contents: [] });
    const r = await svc.forContent(admin, {
      ...subject,
      body: OTHER.replace('فوتبال', 'والیبال'),
      title: 'x',
    });
    expect(r.matches.filter((m) => m.kind === 'CONTENT')).toEqual([]);
  });
});
