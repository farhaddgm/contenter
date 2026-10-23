import { Injectable } from '@nestjs/common';
import {
  BUSINESS_REFERENCE_MAX_CHARS,
  InstagramManualSchema,
  instagramProfileUrl,
  parseInstagramHandle,
  type InstagramManualInput,
  type InstagramPost,
  type InstagramProfile,
  type ReferenceAnalysis,
} from '@contenter/shared';
import { FetchError, MediaFetcherService } from '../../samples/media-fetcher.service';
import { analyzeInstagram, formatInstagramSnapshot } from './instagram-analysis';
import { InstagramService } from './instagram.service';
import { WebsiteCrawlerService } from './website-crawler.service';

/** A web page with less readable text than this is a shell (login wall, JS app), not a source. */
export const MIN_PAGE_TEXT = 200;

/**
 * True when a fetch ended on a sign-in page instead of the requested one (the requested page is
 * private). Such a page must never be stored as the content of a reference.
 */
export function isLoginWall(requestedUrl: string, finalUrl: string): boolean {
  let requested: URL;
  let final: URL;
  try {
    requested = new URL(requestedUrl);
    final = new URL(finalUrl);
  } catch {
    return false;
  }
  const host = final.hostname.toLowerCase();
  if (/^(accounts\.google\.com|login\.microsoftonline\.com|login\.live\.com)$/.test(host)) {
    return true;
  }
  const moved = host !== requested.hostname.toLowerCase() || final.pathname !== requested.pathname;
  return (
    moved &&
    /(^|[/._-])(login|signin|sign-in|sign_in|authwall|sso|auth)([/._?-]|$)/i.test(
      `${host}${final.pathname}`,
    )
  );
}

/** What reading one public source produced. */
export interface SourceRead {
  title: string;
  text: string;
  /** INSTAGRAM / WEBSITE sources: what code computed on the way. */
  analysis?: ReferenceAnalysis;
}

/** Instagram data the admin gave by hand, ready to be stored as a source row. */
export interface ManualInstagramRead {
  /** Profile URL, or '' when the admin gave no handle. */
  url: string;
  title: string;
  /** The text snapshot, cut to `BUSINESS_REFERENCE_MAX_CHARS`. */
  content: string;
  analysis: ReferenceAnalysis;
}

/**
 * Reads one public source into a text snapshot, by code and never by the model: an Instagram
 * account (official Graph API only, never instagram.com), a website (robots.txt, ≤ 10 pages) or a
 * single page. Shared by everything that stores such a snapshot — the business's own references
 * (docs/14, docs/28) and the imitation styles built from other brands' pages (docs/64) — so the
 * rules in CLAUDE.md live in one place. Callers store the result and decide what a failure means.
 */
@Injectable()
export class SourceReader {
  constructor(
    private readonly fetcher: MediaFetcherService,
    private readonly instagram: InstagramService,
    private readonly crawler: WebsiteCrawlerService,
  ) {}

  /** The public data of a Business/Creator account through the Instagram API. */
  async readInstagram(url: string): Promise<SourceRead> {
    const handle = parseInstagramHandle(url);
    if (!handle) throw new FetchError('This link does not point to an Instagram account');
    const { profile, posts } = await this.instagram.fetchAccount(handle);
    const analysis = analyzeInstagram('GRAPH', profile, posts);
    return {
      title: `Instagram @${profile.username}`,
      text: formatInstagramSnapshot({ provider: 'GRAPH', profile, posts, analysis, readAt: new Date() }),
      analysis,
    };
  }

  /** Several pages of a website (home, about, services …), see WebsiteCrawlerService. */
  async readWebsite(url: string): Promise<SourceRead> {
    const out = await this.crawler.read(url);
    return { title: out.title, text: out.text, analysis: out.analysis };
  }

  /** One web page; a sign-in page or a near-empty shell is refused. */
  async readPage(url: string): Promise<SourceRead> {
    const { media } = await this.fetcher.fetch(url);
    if (isLoginWall(url, media.finalUrl ?? url)) {
      throw new FetchError(
        'This page requires signing in, so its content cannot be read. Paste the text instead.',
      );
    }
    const text = (media.text ?? media.description ?? '').trim();
    if (text.length < MIN_PAGE_TEXT) {
      throw new FetchError(
        `Only ${text.length} characters of readable text were found — the page probably needs a login or JavaScript. Paste the text instead.`,
      );
    }
    return { title: media.title ?? '', text };
  }

  /** Bio, counts and captions the admin typed or took from the account's data export. */
  manualInstagram(input: InstagramManualInput): ManualInstagramRead {
    const manual = InstagramManualSchema.parse(input);
    const handle = parseInstagramHandle(manual.handle) ?? '';
    const profile: InstagramProfile = {
      username: handle,
      name: manual.name,
      biography: manual.biography,
      website: manual.website,
      followers: manual.followers ?? null,
      following: manual.following ?? null,
      mediaCount: manual.mediaCount ?? null,
    };
    const posts: InstagramPost[] = manual.posts
      .filter((p) => p.caption)
      .map((p) => ({
        caption: p.caption,
        takenAt:
          p.takenAt && !Number.isNaN(Date.parse(p.takenAt))
            ? new Date(p.takenAt).toISOString()
            : null,
        mediaType: p.mediaType ?? 'UNKNOWN',
        likes: p.likes ?? null,
        comments: p.comments ?? null,
        permalink: p.permalink ?? '',
      }));
    const analysis = analyzeInstagram('MANUAL', profile, posts);
    return {
      url: handle ? instagramProfileUrl(handle) : '',
      title: handle ? `Instagram @${handle}` : 'Instagram (given by hand)',
      content: formatInstagramSnapshot({
        provider: 'MANUAL',
        profile,
        posts,
        analysis,
        readAt: new Date(),
      }).slice(0, BUSINESS_REFERENCE_MAX_CHARS),
      analysis,
    };
  }
}
