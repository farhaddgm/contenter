import { Inject, Injectable, Logger } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Prisma } from '@prisma/client';
import type { FetchedMedia, MediaType, Platform } from '@contenter/shared';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  detectPlatform,
  isPrivateIp,
  isYouTube,
  mediaTypeFromContentType,
  mediaTypeFromOgType,
  parseHtml,
  platformMediaType,
} from './media-parser';

const MAX_REDIRECTS = 5;
const USER_AGENT =
  'Mozilla/5.0 (compatible; ContenterBot/1.0; +https://github.com/farhaddgm/contenter)';

export interface FetchOutcome {
  platform: Platform;
  mediaType: MediaType;
  media: FetchedMedia;
}

export class FetchError extends Error {}

/**
 * Fetches a sample link and extracts metadata + readable text. Pure code, no AI.
 * SSRF-safe: http(s) only, every hop's host is resolved and private addresses are rejected,
 * bounded redirects, size and time limits.
 */
@Injectable()
export class MediaFetcherService {
  private readonly logger = new Logger(MediaFetcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Fetches a stored sample and persists the outcome (never throws). */
  async fetchAndStore(sampleId: string): Promise<void> {
    const sample = await this.prisma.sampleContent.findUniqueOrThrow({ where: { id: sampleId } });
    try {
      const out = await this.fetch(sample.url);
      await this.prisma.sampleContent.update({
        where: { id: sampleId },
        data: {
          platform: out.platform,
          mediaType: out.mediaType,
          fetched: out.media as unknown as Prisma.InputJsonValue,
          fetchStatus: 'FETCHED',
          fetchError: null,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`fetch failed for ${sample.url}: ${message}`);
      await this.prisma.sampleContent.update({
        where: { id: sampleId },
        data: {
          fetchStatus: 'FAILED',
          fetchError: message.slice(0, 1000),
          platform: detectPlatform(sample.url),
        },
      });
    }
  }

  async fetch(rawUrl: string): Promise<FetchOutcome> {
    const platform = detectPlatform(rawUrl);

    if (isYouTube(rawUrl)) {
      const yt = await this.fetchYouTubeOEmbed(rawUrl).catch(() => null);
      if (yt) return { platform, mediaType: 'VIDEO', media: yt };
    }

    const res = await this.safeFetch(rawUrl);
    const contentType = res.headers.get('content-type') ?? '';
    const finalUrl = res.url || rawUrl;
    const direct = mediaTypeFromContentType(contentType);

    if (direct) {
      await res.body?.cancel();
      return {
        platform,
        mediaType: direct,
        media: {
          title: null,
          description: null,
          siteName: new URL(finalUrl).hostname,
          author: null,
          text: null,
          images: direct === 'IMAGE' ? [finalUrl] : [],
          publishedAt: null,
          embedHtml: null,
          finalUrl,
        },
      };
    }

    const html = await this.readLimited(res);
    const { media, ogType } = parseHtml(html, finalUrl);
    return {
      platform,
      // A generic web page with no stronger hint is treated as an article.
      mediaType:
        mediaTypeFromOgType(ogType) ??
        (platform === 'OTHER' ? 'ARTICLE' : platformMediaType(platform)),
      media,
    };
  }

  private async fetchYouTubeOEmbed(url: string): Promise<FetchedMedia> {
    const endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
    const res = await this.safeFetch(endpoint);
    if (!res.ok) throw new FetchError(`oEmbed ${res.status}`);
    const data = (await res.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
      html?: string;
      provider_name?: string;
    };
    return {
      title: data.title ?? null,
      description: null,
      siteName: data.provider_name ?? 'YouTube',
      author: data.author_name ?? null,
      text: null,
      images: data.thumbnail_url ? [data.thumbnail_url] : [],
      publishedAt: null,
      embedHtml: data.html ?? null,
      finalUrl: url,
    };
  }

  private async assertPublicHost(url: URL) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new FetchError('Only http(s) links are supported');
    }
    if (this.env.FETCH_ALLOW_PRIVATE) return;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host)
      ? [host]
      : (await lookup(host, { all: true })).map((a) => a.address);
    if (!addresses.length || addresses.some(isPrivateIp)) {
      throw new FetchError('Link resolves to a private or reserved address');
    }
  }

  private async safeFetch(rawUrl: string): Promise<Response> {
    let current = new URL(rawUrl);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await this.assertPublicHost(current);
      const res = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(this.env.FETCH_TIMEOUT_MS),
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          'accept-language': 'fa,en;q=0.8',
        },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location')!, current);
        continue;
      }
      if (!res.ok) throw new FetchError(`Remote server responded ${res.status}`);
      Object.defineProperty(res, 'url', { value: current.toString() });
      return res;
    }
    throw new FetchError('Too many redirects');
  }

  private async readLimited(res: Response): Promise<string> {
    const reader = res.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > this.env.FETCH_MAX_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
  }
}
