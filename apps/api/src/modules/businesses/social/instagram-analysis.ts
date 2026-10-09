/**
 * Pure code, no AI: statistics of an Instagram account's recent posts and the text snapshot AI
 * jobs read (docs/28-instagram-website-profile.md). The numbers are computed here so that the
 * model interprets them instead of counting (and never has to be trusted with arithmetic).
 */
import type {
  InstagramAnalysis,
  InstagramMediaType,
  InstagramPost,
  InstagramPostBrief,
  InstagramProfile,
  InstagramProvider,
  InstagramStats,
} from '@contenter/shared';

const HASHTAG = /#[\p{L}\p{N}_‌]+/gu;
const MENTION = /@[a-z0-9._]{2,30}/gi;
const EMOJI = /\p{Extended_Pictographic}/gu;
const PERSIAN_LETTER = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-ﻼ]/g;
const LATIN_LETTER = /[A-Za-z]/g;
/** Calls to action in Persian and English (link in bio, DM, order, book, call …). */
const CTA =
  /(لینک|لینکِ?)\s*(در\s*)?(بیو|پروفایل|صفحه)|بایو|دایرکت|پیام\s*(بدید|بدهید|دهید)|سفارش|ثبت[‌ ]?نام|رزرو|تماس\s*بگیر|خرید|مشاوره|link in bio|\bdm\b|order|book|shop now|call us|sign up|whatsapp|واتس[‌ ]?اپ/i;
const QUESTION = /[?؟]/;

const TOP_HASHTAGS = 15;
const TOP_MENTIONS = 8;
const TOP_POSTS = 5;
const HOOK_CHARS = 140;
/** Captions longer than this are cut in the snapshot (the stats already used the full text). */
const SNAPSHOT_CAPTION_CHARS = 900;
/** The snapshot lists at most this many captions; the rest only count in the statistics. */
const SNAPSHOT_MAX_POSTS = 60;

const round = (n: number, digits = 1) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

const count = (re: RegExp, s: string) => s.match(re)?.length ?? 0;

function rank<T extends string>(items: T[], limit: number): { value: T; count: number }[] {
  const counts = new Map<T, number>();
  for (const i of items) counts.set(i, (counts.get(i) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, c]) => ({ value, count: c }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, limit);
}

const engagementOf = (p: InstagramPost) => (p.likes ?? 0) + (p.comments ?? 0);
const hasCounts = (p: InstagramPost) => p.likes !== null || p.comments !== null;

function firstLine(caption: string): string {
  const line = caption
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  return (line ?? '').slice(0, HOOK_CHARS);
}

const brief = (p: InstagramPost): InstagramPostBrief => ({
  permalink: p.permalink,
  takenAt: p.takenAt,
  mediaType: p.mediaType,
  likes: p.likes,
  comments: p.comments,
  hook: firstLine(p.caption),
});

/** Statistics of `posts` (newest first or any order). */
export function instagramStats(profile: InstagramProfile, posts: InstagramPost[]): InstagramStats {
  const n = posts.length;
  const dates = posts
    .map((p) => (p.takenAt ? Date.parse(p.takenAt) : NaN))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  const spanDays = dates.length > 1 ? (dates[dates.length - 1]! - dates[0]!) / 86_400_000 : 0;

  const captions = posts.map((p) => p.caption);
  const joined = captions.join('\n');
  const persian = count(PERSIAN_LETTER, joined);
  const latin = count(LATIN_LETTER, joined);
  const letters = persian + latin;

  const formatMix: InstagramStats['formatMix'] = {};
  for (const p of posts) formatMix[p.mediaType] = (formatMix[p.mediaType] ?? 0) + 1;

  const tags = captions.flatMap((c) => (c.match(HASHTAG) ?? []).map((t) => t.toLowerCase()));
  const mentions = captions.flatMap((c) => (c.match(MENTION) ?? []).map((m) => m.toLowerCase()));

  const counted = posts.filter(hasCounts);
  const avgLikes = counted.length
    ? counted.reduce((s, p) => s + (p.likes ?? 0), 0) / counted.length
    : 0;
  const avgComments = counted.length
    ? counted.reduce((s, p) => s + (p.comments ?? 0), 0) / counted.length
    : 0;

  const withText = captions.filter((c) => c.trim());
  const top = [...counted].sort((a, b) => engagementOf(b) - engagementOf(a)).slice(0, TOP_POSTS);

  return {
    postsAnalyzed: n,
    firstPostAt: dates.length ? new Date(dates[0]!).toISOString() : null,
    lastPostAt: dates.length ? new Date(dates[dates.length - 1]!).toISOString() : null,
    // N posts span N-1 gaps; a single post or one day carries no rhythm.
    postsPerWeek: spanDays >= 1 && dates.length > 1 ? round(((dates.length - 1) / spanDays) * 7) : null,
    formatMix,
    avgCaptionChars: n ? Math.round(captions.reduce((s, c) => s + c.length, 0) / n) : 0,
    emptyCaptions: n - withText.length,
    avgEmojisPerPost: n ? round(count(EMOJI, joined) / n) : 0,
    avgHashtagsPerPost: n ? round(tags.length / n) : 0,
    topHashtags: rank(tags, TOP_HASHTAGS).map(({ value, count: c }) => ({ tag: value, count: c })),
    topMentions: rank(mentions, TOP_MENTIONS).map(({ value, count: c }) => ({
      handle: value,
      count: c,
    })),
    scriptShare: {
      persian: letters ? round(persian / letters, 2) : 0,
      latin: letters ? round(latin / letters, 2) : 0,
    },
    ctaShare: withText.length ? round(withText.filter((c) => CTA.test(c)).length / withText.length, 2) : 0,
    questionShare: withText.length
      ? round(withText.filter((c) => QUESTION.test(c)).length / withText.length, 2)
      : 0,
    engagement: counted.length
      ? {
          postsWithCounts: counted.length,
          avgLikes: round(avgLikes),
          avgComments: round(avgComments),
          ratePct:
            profile.followers && profile.followers > 0
              ? round(((avgLikes + avgComments) / profile.followers) * 100, 2)
              : null,
        }
      : null,
    topPosts: top.map(brief),
  };
}

export function analyzeInstagram(
  provider: InstagramProvider,
  profile: InstagramProfile,
  posts: InstagramPost[],
): InstagramAnalysis {
  return { type: 'INSTAGRAM', provider, profile, stats: instagramStats(profile, posts) };
}

const fmt = (n: number | null) => (n === null ? 'unknown' : n.toLocaleString('en-US'));
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : 'unknown date');
const pct = (share: number) => `${Math.round(share * 100)}%`;

const FORMAT_LABEL: Record<InstagramMediaType, string> = {
  IMAGE: 'single image',
  VIDEO: 'video',
  CAROUSEL: 'carousel',
  REEL: 'reel',
  UNKNOWN: 'other',
};

/**
 * The text snapshot AI jobs read for an Instagram source: profile, statistics computed by code
 * and the recent captions. Stored in `BusinessReference.content` (the admin can read it).
 */
export function formatInstagramSnapshot(args: {
  provider: InstagramProvider;
  profile: InstagramProfile;
  posts: InstagramPost[];
  analysis: InstagramAnalysis;
  readAt: Date;
}): string {
  const { profile, posts, analysis, provider } = args;
  const s = analysis.stats;
  const source =
    provider === 'GRAPH'
      ? 'Instagram API (Business Discovery) — public data of a professional account'
      : 'given by the admin (pasted or from the account data export)';
  const lines: string[] = [
    `# Instagram account${profile.username ? ` @${profile.username}` : ''}${profile.name ? ` — ${profile.name}` : ''}`,
    `Source: ${source}. Read on ${args.readAt.toISOString().slice(0, 10)}.`,
    '',
    '## Profile',
    `Bio: ${profile.biography.trim() || '(not available)'}`,
    `Link in bio: ${profile.website || '(none)'}`,
    `Followers: ${fmt(profile.followers)} · Following: ${fmt(profile.following)} · Posts: ${fmt(profile.mediaCount)}`,
    '',
    `## Statistics (computed by code from ${s.postsAnalyzed} posts, ${day(s.firstPostAt)} → ${day(s.lastPostAt)})`,
  ];
  if (s.postsPerWeek !== null) lines.push(`- Posting rhythm: about ${s.postsPerWeek} posts per week`);
  const mix = Object.entries(s.formatMix)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${FORMAT_LABEL[k as InstagramMediaType]} ${v}`)
    .join(', ');
  if (mix) lines.push(`- Formats: ${mix}`);
  lines.push(
    `- Captions: average ${s.avgCaptionChars} characters, ${s.emptyCaptions} without text; about ${s.avgEmojisPerPost} emojis and ${s.avgHashtagsPerPost} hashtags per post`,
    `- Script: ${pct(s.scriptShare.persian)} Persian/Arabic letters, ${pct(s.scriptShare.latin)} Latin letters`,
    `- ${pct(s.ctaShare)} of captions contain a call to action; ${pct(s.questionShare)} ask a question`,
  );
  if (s.topHashtags.length) {
    lines.push(`- Most used hashtags: ${s.topHashtags.map((h) => `${h.tag} (${h.count})`).join(' ')}`);
  }
  if (s.topMentions.length) {
    lines.push(`- Most mentioned accounts: ${s.topMentions.map((m) => `${m.handle} (${m.count})`).join(' ')}`);
  }
  if (s.engagement) {
    const e = s.engagement;
    lines.push(
      `- Engagement (${e.postsWithCounts} posts with counts; hidden like counts are missing): average ${e.avgLikes} likes and ${e.avgComments} comments per post${e.ratePct !== null ? `, about ${e.ratePct}% of followers` : ''}`,
    );
  } else {
    lines.push('- Engagement: like/comment counts are not available for this source');
  }
  if (s.topPosts.length) {
    lines.push('', '## Top posts by engagement (likes + comments)');
    s.topPosts.forEach((p, i) => {
      lines.push(
        `${i + 1}. ${day(p.takenAt)} · ${FORMAT_LABEL[p.mediaType]} · ${fmt(p.likes)} likes, ${fmt(p.comments)} comments — ${p.hook || '(no caption)'}`,
      );
    });
  }

  const recent = [...posts]
    .sort((a, b) => (b.takenAt ?? '').localeCompare(a.takenAt ?? ''))
    .slice(0, SNAPSHOT_MAX_POSTS);
  if (recent.length) {
    lines.push('', `## Recent captions (newest first, ${recent.length} of ${posts.length})`);
    recent.forEach((p, i) => {
      const counts =
        p.likes !== null || p.comments !== null
          ? ` · ${fmt(p.likes)} likes, ${fmt(p.comments)} comments`
          : '';
      const caption = p.caption.trim();
      lines.push(
        '',
        `[${i + 1}] ${day(p.takenAt)} · ${FORMAT_LABEL[p.mediaType]}${counts}`,
        caption
          ? caption.length > SNAPSHOT_CAPTION_CHARS
            ? `${caption.slice(0, SNAPSHOT_CAPTION_CHARS)} […]`
            : caption
          : '(no caption)',
      );
    });
  }
  return lines.join('\n');
}
