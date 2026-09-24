/**
 * Pure, deterministic helpers for turning a URL / HTML page into FetchedMedia.
 * No AI involved — this is the "code" half of sample ingestion.
 */
import { isIP } from 'node:net';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import type { FetchedMedia, MediaType, Platform } from '@contenter/shared';

const MAX_TEXT = 30_000;
const MAX_IMAGES = 8;

const PLATFORM_HOSTS: [RegExp, Platform][] = [
  [/(^|\.)instagram\.com$/, 'INSTAGRAM'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'YOUTUBE'],
  [/(^|\.)(t\.me|telegram\.me|telegram\.org)$/, 'TELEGRAM'],
  [/(^|\.)linkedin\.com$/, 'LINKEDIN'],
  [/(^|\.)(x\.com|twitter\.com)$/, 'X'],
  [/(^|\.)tiktok\.com$/, 'TIKTOK'],
  [/(^|\.)(medium\.com|substack\.com|wordpress\.com|blogspot\.com|virgool\.io)$/, 'BLOG'],
];

export function detectPlatform(url: string): Platform {
  const host = new URL(url).hostname.toLowerCase();
  return PLATFORM_HOSTS.find(([re]) => re.test(host))?.[1] ?? 'OTHER';
}

export function isYouTube(url: string) {
  return detectPlatform(url) === 'YOUTUBE';
}

/** Default media type by platform when the page itself gives no hint. */
export function platformMediaType(platform: Platform): MediaType {
  switch (platform) {
    case 'YOUTUBE':
    case 'TIKTOK':
      return 'VIDEO';
    case 'INSTAGRAM':
    case 'X':
    case 'LINKEDIN':
    case 'TELEGRAM':
      return 'POST';
    case 'BLOG':
      return 'ARTICLE';
    default:
      return 'UNKNOWN';
  }
}

export function mediaTypeFromContentType(contentType: string): MediaType | null {
  const ct = contentType.toLowerCase();
  if (ct.startsWith('image/')) return 'IMAGE';
  if (ct.startsWith('video/')) return 'VIDEO';
  if (ct.startsWith('audio/')) return 'AUDIO';
  if (ct.includes('html')) return null;
  return 'UNKNOWN';
}

/** True for loopback, private, link-local, CGNAT and other non-public addresses. */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === '::1' || s === '::') return true;
    if (s.startsWith('::ffff:')) return isPrivateIp(s.slice(7));
    return /^f[cd]/.test(s) || /^fe[89ab]/.test(s);
  }
  return true;
}

const collapse = (s: string) =>
  s
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

function absolutize(src: string | null | undefined, base: string): string | null {
  if (!src) return null;
  try {
    const u = new URL(src, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export interface ParsedHtml {
  media: FetchedMedia;
  ogType: string | null;
}

export function parseHtml(html: string, url: string): ParsedHtml {
  const { document } = parseHTML(html);
  const meta = (...names: string[]) => {
    for (const n of names) {
      const el =
        document.querySelector(`meta[property="${n}"]`) ??
        document.querySelector(`meta[name="${n}"]`);
      const v = el?.getAttribute('content')?.trim();
      if (v) return v;
    }
    return null;
  };
  const metaAll = (...names: string[]) =>
    names.flatMap((n) =>
      [...document.querySelectorAll(`meta[property="${n}"], meta[name="${n}"]`)].map((el) =>
        el.getAttribute('content'),
      ),
    );

  const title =
    meta('og:title', 'twitter:title') ??
    document.querySelector('title')?.textContent?.trim() ??
    null;
  const description = meta('og:description', 'twitter:description', 'description');

  let text: string | null;
  try {
    // Readability mutates the DOM; give it its own copy.
    const article = new Readability(parseHTML(html).document as unknown as Document).parse();
    text = article?.textContent ? collapse(article.textContent) : null;
  } catch {
    text = null;
  }
  if (!text) {
    const body = document.querySelector('body');
    body
      ?.querySelectorAll('script,style,noscript,svg,nav,footer,header')
      .forEach((el) => el.remove());
    text = body?.textContent ? collapse(body.textContent) : null;
  }

  const images = [...metaAll('og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image')]
    .map((src) => absolutize(src, url))
    .filter((v): v is string => !!v);

  return {
    ogType: meta('og:type'),
    media: {
      title,
      description,
      siteName: meta('og:site_name', 'application-name'),
      author: meta('author', 'article:author', 'twitter:creator'),
      text: text ? text.slice(0, MAX_TEXT) : null,
      images: [...new Set(images)].slice(0, MAX_IMAGES),
      publishedAt: meta('article:published_time', 'og:published_time', 'date'),
      embedHtml: null,
      finalUrl: url,
    },
  };
}

export function mediaTypeFromOgType(ogType: string | null): MediaType | null {
  if (!ogType) return null;
  const t = ogType.toLowerCase();
  if (t.startsWith('video')) return 'VIDEO';
  if (t.startsWith('music')) return 'AUDIO';
  if (t === 'article' || t === 'blog') return 'ARTICLE';
  return null;
}
