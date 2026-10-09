import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  INSTAGRAM_CAPTION_MAX,
  INSTAGRAM_MAX_POSTS,
  type InstagramMediaType,
  type InstagramPost,
  type InstagramProfile,
} from '@contenter/shared';
import { ENV, type Env } from '../../../config/env';
import { FetchError, MediaFetcherService } from '../../samples/media-fetcher.service';

const PAGE_SIZE = 50;

/** An Instagram read that failed for a reason the admin can act on. */
export class InstagramError extends FetchError {}

interface GraphMedia {
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
}

interface GraphDiscovery {
  business_discovery?: {
    username?: string;
    name?: string;
    biography?: string;
    website?: string;
    followers_count?: number;
    follows_count?: number;
    media_count?: number;
    media?: { data?: GraphMedia[]; paging?: { cursors?: { after?: string } } };
  };
}

interface GraphError {
  error?: { message?: string; code?: number; error_subcode?: number; type?: string };
}

const MEDIA_FIELDS =
  'caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count';
const PROFILE_FIELDS = 'username,name,biography,website,followers_count,follows_count,media_count';
/** Used when the API refuses the profile fields above (they are not all documented for every version). */
const PROFILE_FIELDS_MINIMAL = 'username,name,followers_count,media_count';

export function mediaTypeOf(m: GraphMedia): InstagramMediaType {
  if (m.media_product_type === 'REELS') return 'REEL';
  switch (m.media_type) {
    case 'IMAGE':
      return 'IMAGE';
    case 'VIDEO':
      return 'VIDEO';
    case 'CAROUSEL_ALBUM':
      return 'CAROUSEL';
    default:
      return 'UNKNOWN';
  }
}

export function toPost(m: GraphMedia): InstagramPost {
  return {
    caption: (m.caption ?? '').slice(0, INSTAGRAM_CAPTION_MAX),
    takenAt:
      m.timestamp && !Number.isNaN(Date.parse(m.timestamp))
        ? new Date(m.timestamp).toISOString()
        : null,
    mediaType: mediaTypeOf(m),
    // Hidden like counts are omitted by the API: keep them as unknown, never as zero.
    likes: typeof m.like_count === 'number' ? m.like_count : null,
    comments: typeof m.comments_count === 'number' ? m.comments_count : null,
    permalink: m.permalink ?? '',
  };
}

/** Translates a Graph API error into something the admin can act on. */
export function explainGraphError(status: number, err: GraphError['error']): string {
  const code = err?.code;
  const detail = err?.message ? ` (${err.message.slice(0, 200)})` : '';
  if (code === 190 || status === 401) {
    return `The Instagram access token was rejected or has expired — create a new one and update INSTAGRAM_GRAPH_TOKEN.${detail}`;
  }
  if (
    code === 4 ||
    code === 17 ||
    code === 32 ||
    code === 613 ||
    code === 80002 ||
    status === 429
  ) {
    return `Instagram asked us to slow down (rate limit). Try again in a while.${detail}`;
  }
  if (code === 10 || code === 200 || code === 299) {
    return `The Instagram token lacks a permission (instagram_basic, instagram_manage_insights, pages_read_engagement).${detail}`;
  }
  if (code === 110 || code === 100 || status === 400 || status === 404) {
    return `Instagram could not read this account. It must exist and be a public Business or Creator account (personal accounts cannot be read) — otherwise paste its bio and captions by hand.${detail}`;
  }
  return `Instagram answered ${status}.${detail}`;
}

/**
 * Reads the public data of a Business/Creator Instagram account through the official
 * "Business Discovery" API of Meta. Pure code, no AI. Web pages of instagram.com are never
 * fetched: its robots.txt forbids automated collection without permission, and a logged-out
 * profile page carries no bio or captions anyway (docs/28).
 */
@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly fetcher: MediaFetcherService,
  ) {}

  get configured(): boolean {
    return !!this.env.INSTAGRAM_GRAPH_TOKEN && !!this.env.INSTAGRAM_GRAPH_USER_ID;
  }

  async fetchAccount(
    handle: string,
  ): Promise<{ profile: InstagramProfile; posts: InstagramPost[] }> {
    if (!this.configured) {
      throw new InstagramError(
        'Reading Instagram accounts is not set up on this server (INSTAGRAM_GRAPH_TOKEN and INSTAGRAM_GRAPH_USER_ID). Paste the bio and captions instead.',
      );
    }
    if (!/^[a-z0-9._]{1,30}$/.test(handle))
      throw new InstagramError('Not a valid Instagram username');

    let first = await this.query(handle, PROFILE_FIELDS, null);
    if (first.fieldRefused) first = await this.query(handle, PROFILE_FIELDS_MINIMAL, null);
    if (first.error) throw new InstagramError(first.error);
    const account = first.account!;

    const posts: GraphMedia[] = [...(account.media?.data ?? [])];
    let after = account.media?.paging?.cursors?.after;
    let lastPage = posts.length;
    while (after && lastPage === PAGE_SIZE && posts.length < INSTAGRAM_MAX_POSTS) {
      const next = await this.query(handle, first.fields, after);
      if (next.error || !next.account) {
        this.logger.warn(`Instagram @${handle}: stopped paging after ${posts.length} posts`);
        break;
      }
      const page = next.account.media?.data ?? [];
      posts.push(...page);
      lastPage = page.length;
      after = next.account.media?.paging?.cursors?.after;
    }

    return {
      profile: {
        username: account.username ?? handle,
        name: account.name ?? '',
        biography: account.biography ?? '',
        website: account.website ?? '',
        followers: typeof account.followers_count === 'number' ? account.followers_count : null,
        following: typeof account.follows_count === 'number' ? account.follows_count : null,
        mediaCount: typeof account.media_count === 'number' ? account.media_count : null,
      },
      posts: posts.slice(0, INSTAGRAM_MAX_POSTS).map(toPost),
    };
  }

  private async query(handle: string, profileFields: string, after: string | null) {
    const media = `media${after ? `.after(${after})` : ''}.limit(${PAGE_SIZE}){${MEDIA_FIELDS}}`;
    const fields = `business_discovery.username(${handle}){${profileFields},${media}}`;
    const url =
      `${this.env.INSTAGRAM_GRAPH_BASE_URL}/${this.env.INSTAGRAM_GRAPH_VERSION}/` +
      `${this.env.INSTAGRAM_GRAPH_USER_ID}?fields=${encodeURIComponent(fields)}` +
      `&access_token=${encodeURIComponent(this.env.INSTAGRAM_GRAPH_TOKEN!)}`;
    // The token travels in the URL (the Graph API's own convention); FetchError messages never
    // include the URL, and it is not logged here.
    const { status, body } = await this.fetcher.getJsonLoose<GraphDiscovery & GraphError>(url);
    if (status >= 200 && status < 300 && body?.business_discovery) {
      return {
        fields: profileFields,
        account: body.business_discovery,
        error: null,
        fieldRefused: false,
      };
    }
    const err = body?.error;
    const fieldRefused =
      err?.code === 100 &&
      /nonexisting field/i.test(err.message ?? '') &&
      profileFields === PROFILE_FIELDS;
    return {
      fields: profileFields,
      account: null,
      error: explainGraphError(status, err),
      fieldRefused,
    };
  }
}
