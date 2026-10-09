import { describe, expect, it } from 'vitest';
import type { InstagramPost, InstagramProfile } from '@contenter/shared';
import { analyzeInstagram, formatInstagramSnapshot, instagramStats } from './instagram-analysis';

const profile: InstagramProfile = {
  username: 'cafe_noor',
  name: 'کافه نور',
  biography: 'قهوهٔ تخصصی ☕ تهران',
  website: 'https://cafenoor.ir',
  followers: 10_000,
  following: 120,
  mediaCount: 340,
};

const post = (over: Partial<InstagramPost>): InstagramPost => ({
  caption: '',
  takenAt: null,
  mediaType: 'IMAGE',
  likes: null,
  comments: null,
  permalink: '',
  ...over,
});

const posts: InstagramPost[] = [
  post({
    caption: 'قهوهٔ امروز ☕😍\nبرای سفارش دایرکت بدید\n#قهوه #کافه_نور',
    takenAt: '2026-09-01T10:00:00Z',
    mediaType: 'REEL',
    likes: 300,
    comments: 20,
    permalink: 'https://www.instagram.com/p/a/',
  }),
  post({
    caption: 'Behind the scenes @roaster.co #coffee',
    takenAt: '2026-09-08T10:00:00Z',
    mediaType: 'CAROUSEL',
    likes: 100,
    comments: 10,
    permalink: 'https://www.instagram.com/p/b/',
  }),
  post({
    caption: 'کدام را بیشتر دوست دارید؟ #قهوه',
    takenAt: '2026-09-15T10:00:00Z',
    likes: 200,
    comments: 30,
    permalink: 'https://www.instagram.com/p/c/',
  }),
  post({ takenAt: '2026-09-22T10:00:00Z', likes: 50, comments: 0 }),
];

describe('instagramStats', () => {
  const s = instagramStats(profile, posts);

  it('counts posts, rhythm and formats', () => {
    expect(s.postsAnalyzed).toBe(4);
    expect(s.firstPostAt).toBe('2026-09-01T10:00:00.000Z');
    expect(s.lastPostAt).toBe('2026-09-22T10:00:00.000Z');
    // 3 gaps over 21 days = one post a week
    expect(s.postsPerWeek).toBe(1);
    expect(s.formatMix).toEqual({ REEL: 1, CAROUSEL: 1, IMAGE: 2 });
    expect(s.emptyCaptions).toBe(1);
  });

  it('ranks hashtags and mentions', () => {
    expect(s.topHashtags[0]).toEqual({ tag: '#قهوه', count: 2 });
    expect(s.topHashtags.map((h) => h.tag)).toContain('#کافه_نور');
    expect(s.topMentions).toEqual([{ handle: '@roaster.co', count: 1 }]);
    expect(s.avgHashtagsPerPost).toBe(1);
  });

  it('measures script, calls to action and questions', () => {
    expect(s.scriptShare.persian).toBeGreaterThan(s.scriptShare.latin);
    expect(s.ctaShare).toBeCloseTo(0.33, 2); // 1 of the 3 captions that have text
    expect(s.questionShare).toBeCloseTo(0.33, 2);
    expect(s.avgEmojisPerPost).toBe(0.5);
  });

  it('computes engagement and the top posts', () => {
    expect(s.engagement).toEqual({
      postsWithCounts: 4,
      avgLikes: 162.5,
      avgComments: 15,
      ratePct: 1.78,
    });
    expect(s.topPosts.map((p) => p.permalink).slice(0, 2)).toEqual([
      'https://www.instagram.com/p/a/',
      'https://www.instagram.com/p/c/',
    ]);
    expect(s.topPosts[0]!.hook).toBe('قهوهٔ امروز ☕😍');
  });

  it('keeps unknown counts unknown instead of zero', () => {
    const none = instagramStats(profile, [post({ caption: 'x' }), post({ caption: 'y' })]);
    expect(none.engagement).toBeNull();
    expect(none.postsPerWeek).toBeNull();
    const noFollowers = instagramStats({ ...profile, followers: null }, posts);
    expect(noFollowers.engagement?.ratePct).toBeNull();
  });

  it('recognizes Persian calls to action with and without a half-space', () => {
    const zwnj = String.fromCharCode(0x200c);
    const share = (caption: string) => instagramStats(profile, [post({ caption })]).ctaShare;
    expect(share(`همین امروز ثبت${zwnj}نام کنید`)).toBe(1);
    expect(share('همین امروز ثبت نام کنید')).toBe(1);
    expect(share('برای خرید به لینک بیو بروید')).toBe(1);
    expect(share('صبح بخیر')).toBe(0);
  });

  it('handles an empty account', () => {
    const empty = instagramStats(profile, []);
    expect(empty.postsAnalyzed).toBe(0);
    expect(empty.avgCaptionChars).toBe(0);
    expect(empty.topPosts).toEqual([]);
  });
});

describe('formatInstagramSnapshot', () => {
  const analysis = analyzeInstagram('GRAPH', profile, posts);
  const text = formatInstagramSnapshot({
    provider: 'GRAPH',
    profile,
    posts,
    analysis,
    readAt: new Date('2026-10-09T08:00:00Z'),
  });

  it('carries the profile, the computed statistics and the captions', () => {
    expect(text).toContain('# Instagram account @cafe_noor — کافه نور');
    expect(text).toContain('Read on 2026-10-09');
    expect(text).toContain('Bio: قهوهٔ تخصصی ☕ تهران');
    expect(text).toContain('Followers: 10,000');
    expect(text).toContain('computed by code from 4 posts');
    expect(text).toContain('#قهوه (2)');
    expect(text).toContain('Behind the scenes @roaster.co');
    expect(text).toContain('[1] 2026-09-22');
  });

  it('says where the data came from', () => {
    expect(text).toContain('Instagram API (Business Discovery)');
    const manual = formatInstagramSnapshot({
      provider: 'MANUAL',
      profile: { ...profile, username: '' },
      posts: [],
      analysis: analyzeInstagram('MANUAL', { ...profile, username: '' }, []),
      readAt: new Date('2026-10-09T08:00:00Z'),
    });
    expect(manual).toContain('given by the admin');
    expect(manual.startsWith('# Instagram account — کافه نور')).toBe(true);
    expect(manual).not.toContain('Recent captions');
  });

  it('cuts very long captions and caps the list', () => {
    const long = Array.from({ length: 80 }, (_, i) =>
      post({
        caption: 'x'.repeat(2000),
        takenAt: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
      }),
    );
    const out = formatInstagramSnapshot({
      provider: 'GRAPH',
      profile,
      posts: long,
      analysis: analyzeInstagram('GRAPH', profile, long),
      readAt: new Date(),
    });
    expect(out).toContain('(newest first, 60 of 80)');
    expect(out).toContain('[…]');
    expect(out.length).toBeLessThan(80_000);
  });
});
