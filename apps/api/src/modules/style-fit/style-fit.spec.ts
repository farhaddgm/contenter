import { describe, expect, it, vi } from 'vitest';
import type { AccessService } from '../../common/access';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { StyleFitService } from './style-fit.module';
import { BusinessApi } from '../businesses/business-api';

const admin = { id: 'a', role: 'ADMIN' } as AuthUser;

const SAMPLES = [
  'قهوهٔ صبحگاهی را با ۲ قاشق شکر می‌نوشید؟ ☕\n\nما هر روز تازه‌ترین دانه‌ها را برای شما آسیاب می‌کنیم و در بسته‌های کوچک می‌فرستیم. همین حالا سفارش بدهید.\n\n#قهوه #صبحانه',
  'آیا می‌دانستید که آسیاب تازه طعم قهوه را کاملاً عوض می‌کند؟ ☕😍\n\nدانه‌های ما هر هفته برشته می‌شوند و در همان روز بسته‌بندی می‌شوند. برای سفارش دایرکت بدهید.\n\n#قهوه #آسیاب',
  'چای یا قهوه؟ هرکدام را که دوست دارید، تازه‌اش را بنوشید! ☕\n\nما هر دو را با دقت انتخاب می‌کنیم و سر وقت به دست شما می‌رسانیم. همین حالا ثبت‌نام کنید.\n\n#قهوه #چای',
];

const igStats = {
  postsAnalyzed: 20,
  avgCaptionChars: 300,
  avgEmojisPerPost: 2,
  avgHashtagsPerPost: 6,
  scriptShare: { persian: 0.9, latin: 0.1 },
  ctaShare: 0.6,
  questionShare: 0.1,
};

function setup(opts: { samples?: string[]; ig?: unknown; denyBusiness?: boolean } = {}) {
  const sampleFind = vi.fn(async (_a: unknown) =>
    (opts.samples ?? []).map((t) => ({ manualText: t, fetched: null })),
  );
  const refFind = vi.fn(async (_a: unknown) => (opts.ig ? { analysis: opts.ig } : null));
  const prisma = {
    sampleContent: { findMany: sampleFind },
    businessReference: { findFirst: refFind },
  };
  const access = {
    assert: async () => {
      if (opts.denyBusiness) throw new Error('no');
    },
  };
  return {
    svc: new StyleFitService(
      prisma as unknown as PrismaService,
      access as unknown as AccessService,
      new BusinessApi(prisma as unknown as PrismaService),
    ),
    sampleFind,
    refFind,
  };
}

const subject = {
  topicId: 't1',
  businessId: 'b1' as string | null,
  body: 'بهترین قهوه را از کجا بخریم؟ ☕\n\nدانه‌های تازه را هر هفته برشته می‌کنیم و برای شما می‌فرستیم.',
  hashtags: ['قهوه', 'تازه'],
  cta: 'همین حالا سفارش بدهید',
};

describe('StyleFitService', () => {
  it('asks only for analyzed samples of the topic and judges the draft against them', async () => {
    const { svc, sampleFind, refFind } = setup({ samples: SAMPLES });
    const r = await svc.forContent(admin, subject);
    expect(sampleFind.mock.calls[0]![0]).toMatchObject({
      where: { topicId: 't1', analysisStatus: 'DONE' },
    });
    expect(r).toMatchObject({ source: 'SAMPLES', basedOn: 3 });
    expect((r as { total: number }).total).toBeGreaterThanOrEqual(6);
    // samples were enough, so the Instagram account was not even read
    expect(refFind).not.toHaveBeenCalled();
  });

  it('shows no card — not an invented number — for a topic without samples and without Instagram', async () => {
    expect(await setup().svc.forContent(admin, subject)).toBeNull();
    expect(await setup().svc.forContent(admin, { ...subject, businessId: null })).toBeNull();
  });

  it('says "too few" when there are samples but not enough, and there is nothing else to use', async () => {
    const r = await setup({ samples: SAMPLES.slice(0, 2) }).svc.forContent(admin, subject);
    expect(r).toEqual({ tooFew: true, basedOn: 2, needed: 3 });
  });

  it('falls back to the business’s Instagram averages when the samples are too few', async () => {
    const { svc, refFind } = setup({
      samples: SAMPLES.slice(0, 1),
      ig: { type: 'INSTAGRAM', stats: igStats },
    });
    const r = await svc.forContent(admin, subject);
    expect(r).toMatchObject({ source: 'INSTAGRAM', basedOn: 20 });
    expect(refFind.mock.calls[0]![0]).toMatchObject({
      where: { businessId: 'b1', kind: 'INSTAGRAM', status: 'READY', isActive: true },
    });
  });

  it('does not read the Instagram averages for someone without access to the business', async () => {
    const { svc, refFind } = setup({
      ig: { type: 'INSTAGRAM', stats: igStats },
      denyBusiness: true,
    });
    expect(await svc.forContent(admin, subject)).toBeNull();
    expect(refFind).not.toHaveBeenCalled();
  });

  it('ignores an Instagram read with too few posts, and a website reference', async () => {
    const few = setup({ ig: { type: 'INSTAGRAM', stats: { ...igStats, postsAnalyzed: 3 } } });
    expect(await few.svc.forContent(admin, subject)).toBeNull();
    const site = setup({ ig: { type: 'WEBSITE', origin: 'https://x.ir' } });
    expect(await site.svc.forContent(admin, subject)).toBeNull();
  });
});
