import { describe, expect, it, vi } from 'vitest';
import { FetchError, type MediaFetcherService } from '../../samples/media-fetcher.service';
import { WebsiteCrawlerService } from './website-crawler.service';

const lorem = (topic: string) =>
  `${topic} — ` + 'متن نمونهٔ این صفحه دربارهٔ کسب‌وکار است و جزئیات را توضیح می‌دهد. '.repeat(8);

const page = (title: string, body: string, head = '', links = '') =>
  `<html lang="fa"><head><title>${title}</title>${head}</head><body><nav>${links}</nav><main><h1>${title}</h1><p>${body}</p></main></body></html>`;

const NAV = `<a href="/about">درباره ما</a><a href="/services">خدمات</a><a href="/contact">تماس</a>
  <a href="/cart">سبد</a><a href="https://instagram.com/cafe_noor">ig</a>`;

const LD = `<script type="application/ld+json">{"@type":"LocalBusiness","name":"کافه نور","telephone":"021123","address":{"streetAddress":"ولیعصر","addressLocality":"تهران"}}</script>`;

function site(over: Record<string, string | Error> = {}) {
  const files: Record<string, string | Error> = {
    '/robots.txt': 'User-agent: *\nDisallow: /contact\nSitemap: https://brand.ir/sitemap.xml',
    '/sitemap.xml': `<urlset><url><loc>https://brand.ir/blog/brew-guide</loc></url><url><loc>https://brand.ir/blog/our-beans</loc></url><url><loc>https://brand.ir/blog/third</loc></url></urlset>`,
    '/': page('کافه نور', lorem('خانه'), LD, NAV),
    '/about': page('درباره ما', lorem('درباره')),
    '/services': page('خدمات', lorem('خدمات')),
    '/contact': page('تماس', lorem('تماس')),
    '/blog/brew-guide': page('راهنمای دم‌آوری', lorem('مقاله اول')),
    '/blog/our-beans': page('دانه‌های ما', lorem('مقاله دوم')),
    '/blog/third': page('سوم', lorem('مقاله سوم')),
    ...over,
  };
  const calls: string[] = [];
  const getText = vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    calls.push(path);
    const hit = files[path];
    if (hit === undefined) throw new FetchError('Remote server responded 404');
    if (hit instanceof Error) throw hit;
    const type = path.endsWith('.txt') ? 'text/plain' : path.endsWith('.xml') ? 'application/xml' : 'text/html; charset=utf-8';
    return { text: hit, finalUrl: url, contentType: type };
  });
  const crawler = new WebsiteCrawlerService({ getText } as unknown as MediaFetcherService);
  return { crawler, calls };
}

describe('WebsiteCrawlerService', () => {
  it('reads the start page, the telling pages and some posts, and honors robots.txt', async () => {
    const { crawler, calls } = site();
    const out = await crawler.read('https://brand.ir/');
    const urls = out.analysis.pages.map((p) => new URL(p.url).pathname);
    expect(urls[0]).toBe('/');
    expect(urls).toEqual(expect.arrayContaining(['/about', '/services']));
    expect(urls.filter((u) => u.startsWith('/blog/'))).toHaveLength(2);
    // disallowed by robots.txt: never requested
    expect(calls).not.toContain('/contact');
    expect(urls).not.toContain('/contact');
    expect(urls).not.toContain('/cart');
    expect(out.analysis.robotsLimited).toBe(true);
    expect(out.analysis.sitemap).toBe(true);
  });

  it('builds the snapshot and the analysis', async () => {
    const out = await site().crawler.read('https://brand.ir/');
    expect(out.title).toBe('کافه نور');
    expect(out.text).toContain('# Website https://brand.ir — کافه نور');
    expect(out.text).toContain('Phones: ');
    expect(out.text).toContain('Address (structured data): ولیعصر، تهران');
    expect(out.text).toContain('instagram https://www.instagram.com/cafe_noor/');
    expect(out.text).toContain('## Page 1: کافه نور');
    expect(out.text).toContain('## Page 2:');
    expect(out.analysis.language).toBe('fa');
    expect(out.analysis.schemaTypes).toContain('LocalBusiness');
    expect(out.analysis.socialLinks[0]).toMatchObject({ network: 'instagram', handle: 'cafe_noor' });
  });

  it('starts from the home page too when the link is deeper', async () => {
    const out = await site().crawler.read('https://brand.ir/about');
    const urls = out.analysis.pages.map((p) => new URL(p.url).pathname);
    expect(urls.slice(0, 2)).toEqual(['/about', '/']);
  });

  it('survives failing and empty pages', async () => {
    const { crawler } = site({
      '/services': new FetchError('Remote server responded 500'),
      '/about': page('درباره', 'کوتاه'),
    });
    const out = await crawler.read('https://brand.ir/');
    const urls = out.analysis.pages.map((p) => new URL(p.url).pathname);
    expect(urls).not.toContain('/services');
    expect(urls).not.toContain('/about');
    expect(out.analysis.skipped).toBeGreaterThanOrEqual(2);
  });

  it('fails clearly on a JavaScript shell', async () => {
    const { crawler } = site({ '/': '<html><body><div id="app"></div><script src="/a.js"></script></body></html>' });
    await expect(crawler.read('https://brand.ir/')).rejects.toThrow(/JavaScript or needs a login/);
  });

  it('passes the start page error on (timeout, 404 …)', async () => {
    const { crawler } = site({ '/': new FetchError('brand.ir did not answer within 15 seconds.') });
    await expect(crawler.read('https://brand.ir/')).rejects.toThrow(/did not answer/);
  });

  it('refuses a site whose robots.txt blocks everything', async () => {
    const { crawler, calls } = site({ '/robots.txt': 'User-agent: *\nDisallow: /' });
    await expect(crawler.read('https://brand.ir/')).rejects.toThrow(/robots\.txt/);
    expect(calls).toEqual(['/robots.txt']);
  });

  it('ignores an HTML shell served in place of robots.txt', async () => {
    const { crawler } = site({ '/robots.txt': page('Not found', lorem('x')) });
    const out = await crawler.read('https://brand.ir/');
    expect(out.analysis.pages.length).toBeGreaterThan(1);
    expect(out.analysis.robotsLimited).toBe(false);
  });
});
