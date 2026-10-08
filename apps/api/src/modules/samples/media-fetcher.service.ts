import { Inject, Injectable, Logger } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Prisma } from '@prisma/client';
import { fetch as proxyFetch, ProxyAgent } from 'undici';
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

export interface Download {
  buffer: Buffer;
  contentType: string;
  /** From `content-disposition`, when the server sends one. */
  fileName: string | null;
  finalUrl: string;
}

/** True when `host` matches one of the comma-separated domain suffixes (`*` = any host). */
export function matchesHostList(host: string, list: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return list
    .split(',')
    .map((s) =>
      s
        .trim()
        .toLowerCase()
        .replace(/^\*?\./, ''),
    )
    .filter(Boolean)
    .some((s) => s === '*' || h === s || h.endsWith(`.${s}`));
}

/** The file name a `content-disposition` header carries (RFC 5987 form first). */
export function dispositionFileName(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)?'[^']*'([^;]+)/.exec(header)?.[1];
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header)?.[1];
  const raw = (star ?? plain)?.trim();
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Fetches a sample link and extracts metadata + readable text. Pure code, no AI.
 * SSRF-safe: http(s) only, every hop's host is resolved and private addresses are rejected,
 * bounded redirects, size and time limits.
 */
@Injectable()
export class MediaFetcherService {
  private readonly logger = new Logger(MediaFetcherService.name);
  private readonly proxy: ProxyAgent | null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {
    // proxyTunnel: undici 8 forwards plain-http targets without CONNECT unless told otherwise;
    // keep tunnelling every target so the proxy sees the same CONNECT requests as before.
    this.proxy = env.FETCH_PROXY_URL
      ? new ProxyAgent({ uri: env.FETCH_PROXY_URL, proxyTunnel: true })
      : null;
  }

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

  /**
   * Fetches a JSON API (same SSRF rules, redirects and proxy routing as page reads). Throws a
   * FetchError on a non-2xx answer or a body that is not JSON.
   */
  async getJson<T = unknown>(url: string, headers: Record<string, string> = {}): Promise<T> {
    const res = await this.safeFetch(url, {
      headers: { accept: 'application/json, text/plain;q=0.5, */*;q=0.1', ...headers },
    });
    const body = await this.readLimited(res);
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new FetchError(`${new URL(url).hostname} did not answer with JSON`);
    }
  }

  /** Downloads a file (up to `maxBytes`; a larger one is refused, not truncated). */
  async download(
    url: string,
    opts: { maxBytes: number; timeoutMs?: number; headers?: Record<string, string> },
  ): Promise<Download> {
    const timeoutMs = opts.timeoutMs ?? Math.max(this.env.FETCH_TIMEOUT_MS, 60_000);
    const res = await this.safeFetch(url, {
      headers: { accept: '*/*', ...opts.headers },
      timeoutMs,
    });
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > opts.maxBytes) {
      await res.body?.cancel();
      throw new FetchError(`The file is larger than ${Math.round(opts.maxBytes / 1e6)} MB`);
    }
    const buffer = await this.readBytes(res, opts.maxBytes, timeoutMs);
    if (!buffer) {
      throw new FetchError(`The file is larger than ${Math.round(opts.maxBytes / 1e6)} MB`);
    }
    return {
      buffer,
      contentType: res.headers.get('content-type') ?? '',
      fileName: dispositionFileName(res.headers.get('content-disposition')),
      finalUrl: res.url,
    };
  }

  /** Whether requests to `host` go through FETCH_PROXY_URL. */
  usesProxy(host: string): boolean {
    return !!this.proxy && matchesHostList(host, this.env.FETCH_PROXY_HOSTS);
  }

  private send(url: URL, init: RequestInit): Promise<Response> {
    if (this.usesProxy(url.hostname)) {
      return proxyFetch(url, {
        ...(init as Parameters<typeof proxyFetch>[1]),
        dispatcher: this.proxy!,
      }) as unknown as Promise<Response>;
    }
    return fetch(url, init);
  }

  /** A timeout or a refused connection, explained for the admin (the raw text is cryptic). */
  private explain(err: unknown, url: URL, timeoutMs: number): unknown {
    if (err instanceof FetchError) return err;
    const name = (err as { name?: string })?.name;
    const host = url.hostname;
    const hint =
      /\.ir$/i.test(host) && !this.usesProxy(host)
        ? ' Many Iranian sites do not answer servers outside Iran; the server admin can set FETCH_PROXY_URL to a proxy inside Iran (docs/13-operations.md).'
        : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return new FetchError(
        `${host} did not answer within ${Math.max(1, Math.round(timeoutMs / 1000))} seconds.${hint}`,
      );
    }
    if (err instanceof TypeError) {
      const cause = (err as { cause?: { code?: string; message?: string } }).cause;
      return new FetchError(
        `Could not connect to ${host} (${cause?.code ?? cause?.message ?? err.message}).${hint}`,
      );
    }
    return err;
  }

  private async safeFetch(
    rawUrl: string,
    opts: { headers?: Record<string, string>; timeoutMs?: number } = {},
  ): Promise<Response> {
    const timeoutMs = opts.timeoutMs ?? this.env.FETCH_TIMEOUT_MS;
    let current = new URL(rawUrl);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await this.assertPublicHost(current);
      let res: Response;
      try {
        res = await this.send(current, {
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            'user-agent': USER_AGENT,
            accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
            'accept-language': 'fa,en;q=0.8',
            ...opts.headers,
          },
        });
      } catch (err) {
        throw this.explain(err, current, timeoutMs);
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        await res.body?.cancel();
        current = new URL(res.headers.get('location')!, current);
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new FetchError(`Remote server responded ${res.status}`);
      }
      Object.defineProperty(res, 'url', { value: current.toString() });
      return res;
    }
    throw new FetchError('Too many redirects');
  }

  /** The whole body, or null when it is larger than `maxBytes`. */
  private async readBytes(
    res: Response,
    maxBytes: number,
    timeoutMs: number,
  ): Promise<Buffer | null> {
    const reader = res.body?.getReader();
    if (!reader) return Buffer.alloc(0);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader
        .read()
        .catch((err: unknown) => Promise.reject(this.explain(err, new URL(res.url), timeoutMs)));
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }

  private async readLimited(res: Response): Promise<string> {
    const reader = res.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader
        .read()
        .catch((err: unknown) =>
          Promise.reject(this.explain(err, new URL(res.url), this.env.FETCH_TIMEOUT_MS)),
        );
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
