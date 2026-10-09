import { describe, expect, it, vi } from 'vitest';
import type { InstagramPost, InstagramProfile, WebsiteAnalysis } from '@contenter/shared';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { formatReferences } from '../ai/context';
import { referenceSites } from '../ai/runners/business.runners';
import { ReferencesService } from './references.service';
import { InstagramError, type InstagramService } from './social/instagram.service';
import type { WebsiteCrawlerService } from './social/website-crawler.service';

type Row = Record<string, unknown> & { id: string };

/** Just enough of Prisma's businessReference delegate for ReferencesService.add/refresh. */
function fakePrisma() {
  const rows: Row[] = [];
  let n = 0;
  const strip = ({ googleAccount: _g, ...rest }: Record<string, unknown>) => rest;
  const model = {
    count: async () => rows.length,
    findFirst: async ({ where }: { where: { businessId: string; url: string } }) =>
      rows.find((r) => r.businessId === where.businessId && r.url === where.url) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: Row = {
        id: `r${++n}`,
        url: '',
        title: '',
        content: '',
        analysis: null,
        status: 'PENDING',
        error: null,
        isActive: true,
        fetchedAt: null,
        googleAccountId: null,
        createdAt: new Date(),
        ...data,
      };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = rows.find((r) => r.id === where.id)!;
      Object.assign(row, strip(data));
      return row;
    },
    findMany: async ({ where }: { where: { id?: { in: string[] } } }) =>
      rows
        .filter((r) => !where.id || where.id.in.includes(r.id))
        .map((r) => ({ ...r, googleAccount: null })),
    findUnique: async ({ where }: { where: { id: string } }) => {
      const r = rows.find((x) => x.id === where.id);
      return r ? { ...r, googleAccount: null } : null;
    },
  };
  return { rows, prisma: { businessReference: model } as unknown as PrismaService };
}

const profile: InstagramProfile = {
  username: 'cafe_noor',
  name: 'کافه نور',
  biography: 'قهوهٔ تخصصی',
  website: 'https://cafenoor.ir',
  followers: 5000,
  following: 10,
  mediaCount: 2,
};
const posts: InstagramPost[] = [
  {
    caption: 'سلام #قهوه',
    takenAt: '2026-09-01T00:00:00Z',
    mediaType: 'IMAGE',
    likes: 10,
    comments: 1,
    permalink: '',
  },
];

const siteAnalysis: WebsiteAnalysis = {
  type: 'WEBSITE',
  origin: 'https://brand.ir',
  name: 'برند',
  description: '',
  language: 'fa',
  pages: [{ url: 'https://brand.ir/', title: 'خانه', chars: 500 }],
  skipped: 0,
  robotsLimited: false,
  sitemap: false,
  schemaTypes: [],
  emails: [],
  phones: [],
  socialLinks: [],
};

function setup(
  over: { instagram?: Partial<InstagramService>; crawler?: Partial<WebsiteCrawlerService> } = {},
) {
  const { rows, prisma } = fakePrisma();
  const instagram = {
    configured: true,
    fetchAccount: vi.fn(async () => ({ profile, posts })),
    ...over.instagram,
  } as unknown as InstagramService;
  const crawler = {
    read: vi.fn(async () => ({ title: 'برند', text: 'x'.repeat(300), analysis: siteAnalysis })),
    ...over.crawler,
  } as unknown as WebsiteCrawlerService;
  const service = new ReferencesService(
    prisma,
    { log: vi.fn() } as unknown as AuditService,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    instagram,
    crawler,
  );
  return { service, rows, instagram, crawler };
}

const user = { id: 'u1', role: 'ADMIN' } as never;

describe('adding an Instagram account', () => {
  it('reads the account behind a profile link and stores the analysis', async () => {
    const { service, rows, instagram } = setup();
    const out = await service.add('b1', { url: 'https://instagram.com/Cafe_Noor/?hl=fa' }, user);
    expect(instagram.fetchAccount).toHaveBeenCalledWith('cafe_noor');
    expect(out.references).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'INSTAGRAM',
      url: 'https://www.instagram.com/cafe_noor/',
      status: 'READY',
      title: 'Instagram @cafe_noor',
    });
    expect(rows[0]!.content).toContain('Bio: قهوهٔ تخصصی');
    expect(rows[0]!.analysis).toMatchObject({ type: 'INSTAGRAM', provider: 'GRAPH' });
  });

  it('refuses a post link and a duplicate account', async () => {
    const { service } = setup();
    await expect(
      service.add('b1', { url: 'https://www.instagram.com/p/Cabc123/' }, user),
    ).rejects.toThrow(/not an account/);
    await service.add('b1', { url: 'https://www.instagram.com/cafe_noor/' }, user);
    await expect(
      service.add('b1', { url: 'https://instagram.com/cafe_noor' }, user),
    ).rejects.toThrow(/already a reference/);
  });

  it('keeps a failed read as a FAILED reference with the reason', async () => {
    const { service, rows } = setup({
      instagram: {
        configured: false,
        fetchAccount: vi.fn(async () => {
          throw new InstagramError('Reading Instagram accounts is not set up on this server');
        }),
      },
    });
    const out = await service.add('b1', { url: 'https://www.instagram.com/cafe_noor/' }, user);
    expect(out.references[0]!.status).toBe('FAILED');
    expect(rows[0]!.error).toMatch(/not set up/);
  });

  it('stores bio and captions given by hand and does not read them again', async () => {
    const { service, rows, instagram } = setup();
    const out = await service.add(
      'b1',
      {
        instagram: {
          handle: '@cafe_noor',
          biography: 'قهوه',
          followers: 1000,
          posts: [{ caption: 'پست اول', likes: 5, comments: 1 }, { caption: '' }],
        },
      },
      user,
    );
    expect(instagram.fetchAccount).not.toHaveBeenCalled();
    expect(out.references[0]).toMatchObject({ kind: 'INSTAGRAM', status: 'READY' });
    expect(rows[0]!.analysis).toMatchObject({ provider: 'MANUAL' });
    expect((rows[0]!.analysis as { stats: { postsAnalyzed: number } }).stats.postsAnalyzed).toBe(1);
    expect(rows[0]!.content).toContain('given by the admin');
    await expect(service.refresh('r1', user)).rejects.toThrow(/given by hand/);
  });

  it('accepts manual data without a username', async () => {
    const { service, rows } = setup();
    await service.add('b1', { instagram: { biography: 'only a bio' } }, user);
    expect(rows[0]).toMatchObject({ url: '', title: 'Instagram (given by hand)' });
  });
});

describe('adding a website', () => {
  it('reads several pages and keeps the analysis', async () => {
    const { service, rows, crawler } = setup();
    await service.add('b1', { url: 'https://brand.ir/', site: true }, user);
    expect(crawler.read).toHaveBeenCalledWith('https://brand.ir/');
    expect(rows[0]).toMatchObject({ kind: 'WEBSITE', status: 'READY', title: 'برند' });
    expect(rows[0]!.analysis).toMatchObject({ type: 'WEBSITE', origin: 'https://brand.ir' });
  });

  it('refuses a social network or other shared platform as "the website"', async () => {
    const { service } = setup();
    await expect(
      service.add('b1', { url: 'https://t.me/brand', site: true }, user),
    ).rejects.toThrow(/shared platform/);
  });

  it('turns an Instagram link into an account even when the site switch is on', async () => {
    const { service, rows } = setup();
    await service.add('b1', { url: 'https://instagram.com/cafe_noor', site: true }, user);
    expect(rows[0]!.kind).toBe('INSTAGRAM');
  });

  it('stores the crawler error and keeps the earlier snapshot on a failed refresh', async () => {
    const crawl = vi
      .fn()
      .mockResolvedValueOnce({
        title: 'برند',
        text: 'first snapshot '.repeat(30),
        analysis: siteAnalysis,
      })
      .mockRejectedValueOnce(new Error('brand.ir did not answer within 15 seconds.'));
    const { service, rows } = setup({ crawler: { read: crawl } });
    await service.add('b1', { url: 'https://brand.ir/', site: true }, user);
    await service.refresh('r1', user);
    expect(rows[0]).toMatchObject({
      status: 'FAILED',
      error: expect.stringMatching(/did not answer/),
    });
    expect(String(rows[0]!.content)).toContain('first snapshot');
  });
});

describe('what AI jobs receive', () => {
  it('tells the model how to read analyzed sources', () => {
    const out = formatReferences([
      {
        kind: 'INSTAGRAM',
        title: 'Instagram @x',
        url: 'https://www.instagram.com/x/',
        content: 'stats',
      },
      { kind: 'WEBSITE', title: 'Brand', url: 'https://brand.ir', content: 'pages' },
      { kind: 'URL', title: 'Plain', url: 'https://a.ir', content: 'text' },
    ]);
    expect(out).toContain('computed by code');
    expect(out).toContain('authoritative source for what the business offers');
    expect(out.match(/^\(/gm)).toHaveLength(2); // no hint line for a plain link
  });

  it('lets a website reference scope REFERENCE_SITES searches, but never an Instagram one', () => {
    const sites = referenceSites(
      [
        { kind: 'WEBSITE', url: 'https://brand.ir/' },
        { kind: 'INSTAGRAM', url: 'https://www.instagram.com/brand/' },
      ],
      '',
      [],
    );
    expect(sites).toEqual(['brand.ir']);
  });
});
