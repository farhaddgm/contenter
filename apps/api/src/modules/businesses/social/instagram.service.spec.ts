import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../config/env';
import type { MediaFetcherService } from '../../samples/media-fetcher.service';
import { explainGraphError, InstagramError, InstagramService, toPost } from './instagram.service';

const env = (over: Partial<Env> = {}) =>
  ({
    INSTAGRAM_GRAPH_TOKEN: 'secret-token',
    INSTAGRAM_GRAPH_USER_ID: '1784',
    INSTAGRAM_GRAPH_VERSION: 'v25.0',
    INSTAGRAM_GRAPH_BASE_URL: 'https://graph.facebook.com',
    ...over,
  }) as Env;

type Reply = { status: number; body: unknown };
function service(replies: Reply[], e = env()) {
  const urls: string[] = [];
  const getJsonLoose = vi.fn(async (url: string) => {
    urls.push(url);
    return replies.shift() ?? { status: 500, body: null };
  });
  const svc = new InstagramService(e, { getJsonLoose } as unknown as MediaFetcherService);
  return { svc, urls, getJsonLoose };
}

const media = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({
    caption: `post ${from + i}`,
    media_type: 'IMAGE',
    permalink: `https://www.instagram.com/p/${from + i}/`,
    timestamp: '2026-09-01T10:00:00+0000',
    like_count: 10,
    comments_count: 1,
  }));

const discovery = (extra: Record<string, unknown> = {}, items = media(2), after?: string) => ({
  status: 200,
  body: {
    business_discovery: {
      username: 'cafe_noor',
      name: 'Cafe Noor',
      biography: 'bio',
      website: 'https://cafenoor.ir',
      followers_count: 1200,
      follows_count: 10,
      media_count: 30,
      media: { data: items, ...(after ? { paging: { cursors: { after } } } : {}) },
      ...extra,
    },
  },
});

describe('InstagramService', () => {
  it('is off without a token or a user id', () => {
    expect(service([], env({ INSTAGRAM_GRAPH_TOKEN: undefined })).svc.configured).toBe(false);
    expect(service([], env({ INSTAGRAM_GRAPH_USER_ID: undefined })).svc.configured).toBe(false);
    expect(service([]).svc.configured).toBe(true);
  });

  it('refuses to read when it is not set up', async () => {
    const { svc, getJsonLoose } = service([], env({ INSTAGRAM_GRAPH_TOKEN: undefined }));
    await expect(svc.fetchAccount('cafe_noor')).rejects.toThrow(/not set up/);
    expect(getJsonLoose).not.toHaveBeenCalled();
  });

  it('reads the profile and posts through business_discovery', async () => {
    const { svc, urls } = service([discovery()]);
    const { profile, posts } = await svc.fetchAccount('cafe_noor');
    expect(profile).toMatchObject({
      username: 'cafe_noor',
      biography: 'bio',
      website: 'https://cafenoor.ir',
      followers: 1200,
      following: 10,
      mediaCount: 30,
    });
    expect(posts).toHaveLength(2);
    const url = new URL(urls[0]!);
    expect(url.origin + url.pathname).toBe('https://graph.facebook.com/v25.0/1784');
    expect(decodeURIComponent(url.searchParams.get('fields')!)).toContain(
      'business_discovery.username(cafe_noor){',
    );
    expect(url.searchParams.get('access_token')).toBe('secret-token');
  });

  it('follows the cursor to a second page and stops at the limit', async () => {
    const { svc, urls } = service([
      discovery({}, media(50), 'CUR1'),
      discovery({}, media(50, 50), 'CUR2'),
      discovery({}, media(50, 100)),
    ]);
    const { posts } = await svc.fetchAccount('cafe_noor');
    expect(posts).toHaveLength(100);
    expect(urls).toHaveLength(2);
    expect(decodeURIComponent(new URL(urls[1]!).searchParams.get('fields')!)).toContain(
      'media.after(CUR1).limit(50)',
    );
  });

  it('keeps what it has when a later page fails', async () => {
    const { svc } = service([
      discovery({}, media(50), 'CUR1'),
      { status: 500, body: { error: { message: 'boom', code: 1 } } },
    ]);
    expect((await svc.fetchAccount('cafe_noor')).posts).toHaveLength(50);
  });

  it('retries with fewer profile fields when the API refuses one', async () => {
    const { svc, urls } = service([
      {
        status: 400,
        body: { error: { code: 100, message: '(#100) Tried accessing nonexisting field (biography)' } },
      },
      discovery(),
    ]);
    const { profile } = await svc.fetchAccount('cafe_noor');
    expect(urls).toHaveLength(2);
    expect(decodeURIComponent(urls[1]!)).not.toContain('biography');
    expect(profile.username).toBe('cafe_noor');
  });

  it('explains a failure without leaking the token', async () => {
    const { svc } = service([
      { status: 400, body: { error: { code: 110, message: 'Invalid user id' } } },
    ]);
    const err = await svc.fetchAccount('somebody').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InstagramError);
    expect((err as Error).message).toMatch(/Business or Creator/);
    expect((err as Error).message).not.toContain('secret-token');
  });

  it('rejects names that are not Instagram usernames before calling the API', async () => {
    const { svc, getJsonLoose } = service([]);
    await expect(svc.fetchAccount('a{b}')).rejects.toThrow(/valid Instagram username/);
    expect(getJsonLoose).not.toHaveBeenCalled();
  });
});

describe('Graph helpers', () => {
  it('maps media types and keeps hidden counts unknown', () => {
    expect(toPost({ media_type: 'VIDEO', media_product_type: 'REELS' }).mediaType).toBe('REEL');
    expect(toPost({ media_type: 'CAROUSEL_ALBUM' }).mediaType).toBe('CAROUSEL');
    expect(toPost({ media_type: 'IMAGE' }).mediaType).toBe('IMAGE');
    expect(toPost({}).mediaType).toBe('UNKNOWN');
    const hidden = toPost({ caption: 'x', comments_count: 3 });
    expect(hidden.likes).toBeNull();
    expect(hidden.comments).toBe(3);
    expect(toPost({ timestamp: 'garbage' }).takenAt).toBeNull();
  });

  it('turns API errors into advice', () => {
    expect(explainGraphError(400, { code: 190, message: 'expired' })).toMatch(/INSTAGRAM_GRAPH_TOKEN/);
    expect(explainGraphError(400, { code: 4, message: 'limit' })).toMatch(/slow down/);
    expect(explainGraphError(403, { code: 10, message: 'perm' })).toMatch(/permission/);
    expect(explainGraphError(400, { code: 110 })).toMatch(/paste/);
    expect(explainGraphError(502, undefined)).toMatch(/502/);
  });
});
