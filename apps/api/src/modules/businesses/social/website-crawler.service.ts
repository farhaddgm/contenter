import { Injectable, Logger } from '@nestjs/common';
import type { SocialLink, WebsiteAnalysis, WebsitePageBrief } from '@contenter/shared';
import { FetchError, MediaFetcherService } from '../../samples/media-fetcher.service';
import { parseHtml } from '../../samples/media-parser';
import {
  brandFromTitles,
  extractPageSignals,
  parseRobots,
  parseSitemap,
  robotsSitemaps,
  selectPages,
  sameSite,
  type Candidate,
  type PageSignals,
} from './site-parser';

/** Pages read per website, the start page included. */
export const SITE_MAX_PAGES = 10;
/** Of those, blog posts read as samples of the business's own writing. */
const SITE_ARTICLES = 2;
const CONCURRENCY = 3;
/** The whole crawl stops starting new requests after this long. */
const CRAWL_DEADLINE_MS = 60_000;
const START_PAGE_CHARS = 15_000;
const PAGE_CHARS = 9_000;
/** A page with less readable text than this is a shell (login wall, JavaScript app). */
export const MIN_SITE_PAGE_TEXT = 150;
const MAX_SITEMAP_URLS = 1_000;
const MAX_SOCIAL_LINKS = 12;

interface Page {
  url: string;
  title: string;
  description: string;
  siteName: string;
  text: string;
  signals: PageSignals;
}

export interface WebsiteRead {
  title: string;
  text: string;
  analysis: WebsiteAnalysis;
}

const isHtml = (contentType: string) => !contentType || /html|xml/i.test(contentType);

/**
 * Reads a business website: the start page plus the pages that tell most about the business
 * (about, services, contact, pricing, FAQ, a couple of blog posts), found through the start
 * page's links and the sitemap. Polite and read-only: robots.txt is honored, at most ten pages,
 * a few requests at a time. Pure code, no AI (docs/28-instagram-website-profile.md).
 */
@Injectable()
export class WebsiteCrawlerService {
  private readonly logger = new Logger(WebsiteCrawlerService.name);

  constructor(private readonly fetcher: MediaFetcherService) {}

  async read(startUrl: string): Promise<WebsiteRead> {
    const start = new URL(startUrl);
    const origin = start.origin;
    const deadline = Date.now() + CRAWL_DEADLINE_MS;
    let robotsLimited = false;
    let skipped = 0;

    const robotsText = await this.optionalText(`${origin}/robots.txt`);
    const allowed = robotsText ? parseRobots(robotsText) : () => true;
    const may = (url: string) => {
      const ok = allowed(new URL(url).pathname);
      if (!ok) robotsLimited = true;
      return ok;
    };

    // 1. The start page (and the home page when the link was deeper).
    const seeds = [start.toString()];
    if (start.pathname !== '/' && start.pathname !== '') seeds.push(`${origin}/`);
    const pages: Page[] = [];
    let firstError: unknown = null;
    for (const url of seeds) {
      if (!may(url)) continue;
      try {
        const page = await this.page(url);
        if (page) pages.push(page);
      } catch (err) {
        firstError ??= err;
        this.logger.warn(`website ${url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!pages.length) {
      if (firstError) throw firstError;
      throw new FetchError(
        robotsLimited
          ? 'The robots.txt of this website does not allow reading it. Paste its text instead.'
          : 'This address did not return a web page.',
      );
    }
    if (pages[0]!.text.length < MIN_SITE_PAGE_TEXT && pages.every((p) => p.text.length < MIN_SITE_PAGE_TEXT)) {
      throw new FetchError(
        `Only ${pages[0]!.text.length} characters of readable text were found — the site probably builds its pages with JavaScript or needs a login. Paste the text of its main pages instead.`,
      );
    }

    // 2. Which other pages tell most about the business.
    const candidates: Candidate[] = pages.flatMap((p) =>
      p.signals.links
        .filter((l) => sameSite(new URL(l.url).hostname, start.hostname))
        .map((l) => ({ url: l.url, text: l.text, linked: true })),
    );
    const sitemapUrls = await this.sitemap(origin, robotsText, deadline);
    candidates.push(...sitemapUrls.map((url) => ({ url, text: '', linked: false })));
    const wanted = selectPages({
      origin,
      skip: pages.map((p) => p.url),
      candidates,
      limit: Math.max(0, SITE_MAX_PAGES - pages.length),
      articles: SITE_ARTICLES,
    });

    // 3. Read them, a few at a time.
    const fetched: (Page | null)[] = new Array(wanted.length).fill(null);
    let next = 0;
    const worker = async () => {
      while (next < wanted.length) {
        const i = next++;
        const url = wanted[i]!;
        if (Date.now() > deadline || !may(url)) {
          skipped++;
          continue;
        }
        try {
          fetched[i] = await this.page(url);
          if (!fetched[i]) skipped++;
        } catch {
          skipped++;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, wanted.length) }, worker));
    const seen = new Set(pages.map((p) => p.text.slice(0, 400)));
    for (const page of fetched) {
      if (!page || page.text.length < MIN_SITE_PAGE_TEXT || seen.has(page.text.slice(0, 400))) {
        if (page) skipped++;
        continue;
      }
      seen.add(page.text.slice(0, 400));
      pages.push(page);
    }

    return this.compose(origin, pages, { skipped, robotsLimited, sitemap: sitemapUrls.length > 0 });
  }

  private async page(url: string): Promise<Page | null> {
    const { text: html, finalUrl, contentType } = await this.fetcher.getText(url);
    if (!isHtml(contentType) || !html.trim()) return null;
    const { media } = parseHtml(html, finalUrl);
    return {
      url: finalUrl,
      title: media.title ?? '',
      description: media.description ?? '',
      siteName: media.siteName ?? '',
      text: (media.text ?? '').trim(),
      signals: extractPageSignals(html, finalUrl),
    };
  }

  private async optionalText(url: string): Promise<string | null> {
    try {
      const { text, contentType } = await this.fetcher.getText(url, 'text/plain,*/*;q=0.5');
      // Many sites answer a missing file with their HTML shell.
      return /html/i.test(contentType) ? null : text;
    } catch {
      return null;
    }
  }

  /** URLs listed in the sitemap (one level of sitemap index followed). */
  private async sitemap(origin: string, robots: string | null, deadline: number): Promise<string[]> {
    const roots = [...(robots ? robotsSitemaps(robots) : []), `${origin}/sitemap.xml`];
    const urls: string[] = [];
    const todo = [...new Set(roots)].slice(0, 3);
    let indexes = 0;
    while (todo.length && urls.length < MAX_SITEMAP_URLS && Date.now() < deadline) {
      const location = todo.shift()!;
      let host: string;
      try {
        host = new URL(location).hostname;
      } catch {
        continue;
      }
      if (!sameSite(host, new URL(origin).hostname)) continue;
      const xml = await this.optionalText(location);
      if (!xml) continue;
      const parsed = parseSitemap(xml);
      urls.push(...parsed.urls);
      if (parsed.sitemaps.length && indexes < 1) {
        indexes++;
        todo.push(...parsed.sitemaps.slice(0, 3));
      }
    }
    return urls.slice(0, MAX_SITEMAP_URLS);
  }

  private compose(
    origin: string,
    pages: Page[],
    extra: { skipped: number; robotsLimited: boolean; sitemap: boolean },
  ): WebsiteRead {
    const home = pages[0]!;
    const fields = pages.reduce<Record<string, string>>(
      (acc, p) => ({ ...p.signals.schema.fields, ...acc }),
      {},
    );
    const social: SocialLink[] = [];
    for (const s of pages.flatMap((p) => p.signals.social)) {
      if (!social.some((x) => x.network === s.network && x.url === s.url)) social.push(s);
    }
    const name =
      (fields.name || home.siteName || '').trim() ||
      brandFromTitles(pages.map((p) => p.title)) ||
      new URL(origin).hostname;
    const description = (fields.description || home.description || '').trim();
    const digits = (v: string) => v.replace(/[^\d+]/g, '');
    const emails = [
      ...new Set([...pages.flatMap((p) => p.signals.emails), fields.email?.toLowerCase() ?? '']),
    ]
      .filter(Boolean)
      .slice(0, 5);
    const phones = [
      ...new Set([...pages.flatMap((p) => p.signals.phones), digits(fields.telephone ?? '')]),
    ]
      .filter((p) => p.length >= 6)
      .slice(0, 5);
    const schemaTypes = [...new Set(pages.flatMap((p) => p.signals.schema.types))].slice(0, 20);
    const language = home.signals.lang;

    const briefs: WebsitePageBrief[] = pages.map((p) => ({
      url: p.url,
      title: p.title.slice(0, 200),
      chars: p.text.length,
    }));

    const header = [
      `# Website ${origin} — ${name}`,
      `Read ${pages.length} pages by code (start page, then the pages that tell most about the business).`,
      language ? `Page language: ${language}` : '',
      description ? `Description: ${description}` : '',
      fields.slogan ? `Slogan: ${fields.slogan}` : '',
      fields.foundingDate ? `Founded: ${fields.foundingDate}` : '',
      fields.address ? `Address (structured data): ${fields.address}` : '',
      fields.areaServed ? `Area served: ${fields.areaServed}` : '',
      fields.priceRange ? `Price range: ${fields.priceRange}` : '',
      emails.length ? `Emails: ${emails.join(', ')}` : '',
      phones.length ? `Phones: ${phones.join(', ')}` : '',
      social.length
        ? `Social links on the site: ${social
            .slice(0, MAX_SOCIAL_LINKS)
            .map((s) => `${s.network} ${s.url}`)
            .join(' · ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    const body = pages.map((p, i) => {
      const cap = i === 0 ? START_PAGE_CHARS : PAGE_CHARS;
      const text = p.text.length > cap ? `${p.text.slice(0, cap)}\n[truncated]` : p.text;
      return `## Page ${i + 1}: ${p.title || p.url}\n${p.url}\n\n${text}`;
    });

    return {
      title: name,
      text: [header, ...body].join('\n\n'),
      analysis: {
        type: 'WEBSITE',
        origin,
        name,
        description: description.slice(0, 500),
        language,
        pages: briefs,
        skipped: extra.skipped,
        robotsLimited: extra.robotsLimited,
        sitemap: extra.sitemap,
        schemaTypes,
        emails,
        phones,
        socialLinks: social.slice(0, MAX_SOCIAL_LINKS),
      },
    };
  }
}
