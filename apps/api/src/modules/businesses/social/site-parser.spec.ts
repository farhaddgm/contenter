import { describe, expect, it } from 'vitest';
import {
  brandFromTitles,
  extractPageSignals,
  isArticleUrl,
  parseRobots,
  parseSitemap,
  parseStructuredData,
  robotsSitemaps,
  scorePage,
  selectPages,
  socialLink,
} from './site-parser';

describe('robots.txt', () => {
  const robots = `
# comment
User-agent: *
Disallow: /admin
Disallow: /private/
Allow: /private/public
Disallow: /*.pdf$

User-agent: ContenterBot
Disallow: /secret

Sitemap: https://brand.ir/sitemap.xml
Sitemap: https://brand.ir/sitemap-2.xml
`;

  it('uses the group that names the agent, not the * group', () => {
    const allowed = parseRobots(robots);
    expect(allowed('/secret/page')).toBe(false);
    expect(allowed('/admin')).toBe(true); // only the * group disallows it
  });

  it('applies * rules: prefixes, longest match, wildcards and $', () => {
    const allowed = parseRobots(robots, 'otherbot');
    expect(allowed('/admin/users')).toBe(false);
    expect(allowed('/private/x')).toBe(false);
    expect(allowed('/private/public/x')).toBe(true);
    expect(allowed('/files/a.pdf')).toBe(false);
    expect(allowed('/files/a.pdf.html')).toBe(true);
    expect(allowed('/about')).toBe(true);
  });

  it('allows everything when there is nothing to obey', () => {
    expect(parseRobots('')('/x')).toBe(true);
    expect(parseRobots('User-agent: *\nDisallow:')('/x')).toBe(true);
    expect(parseRobots('User-agent: *\nDisallow: /')('/x')).toBe(false);
  });

  it('lists the sitemaps', () => {
    expect(robotsSitemaps(robots)).toEqual([
      'https://brand.ir/sitemap.xml',
      'https://brand.ir/sitemap-2.xml',
    ]);
  });
});

describe('sitemap', () => {
  it('reads urls, CDATA and entities', () => {
    const xml = `<urlset><url><loc>https://brand.ir/about</loc></url>
      <url><loc><![CDATA[https://brand.ir/a?x=1&amp;y=2]]></loc></url></urlset>`;
    expect(parseSitemap(xml)).toEqual({
      urls: ['https://brand.ir/about', 'https://brand.ir/a?x=1&y=2'],
      sitemaps: [],
    });
  });

  it('tells an index from a sitemap', () => {
    const xml =
      '<sitemapindex><sitemap><loc>https://brand.ir/s1.xml</loc></sitemap></sitemapindex>';
    expect(parseSitemap(xml)).toEqual({ urls: [], sitemaps: ['https://brand.ir/s1.xml'] });
  });
});

describe('social links', () => {
  it('finds networks and Instagram accounts', () => {
    expect(socialLink('https://instagram.com/Cafe_Noor/?hl=fa')).toEqual({
      network: 'instagram',
      url: 'https://www.instagram.com/cafe_noor/',
      handle: 'cafe_noor',
    });
    expect(socialLink('https://t.me/cafenoor')).toEqual({
      network: 'telegram',
      url: 'https://t.me/cafenoor',
    });
    expect(socialLink('https://www.aparat.com/cafenoor/')?.network).toBe('aparat');
  });

  it('ignores share buttons, posts, network home pages and other sites', () => {
    expect(socialLink('https://www.instagram.com/p/Cabc/')).toBeNull();
    expect(socialLink('https://twitter.com/intent/tweet?url=x')).toBeNull();
    expect(socialLink('https://www.facebook.com/sharer/sharer.php?u=x')).toBeNull();
    expect(socialLink('https://t.me/')).toBeNull();
    expect(socialLink('https://brand.ir/about')).toBeNull();
  });
});

describe('structured data', () => {
  it('reads organization facts from JSON-LD, including @graph and sameAs', () => {
    const info = parseStructuredData([
      JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebSite', name: 'Site' },
          {
            '@type': ['LocalBusiness', 'CafeOrCoffeeShop'],
            name: 'کافه نور',
            telephone: '+98 21 1234',
            address: { streetAddress: 'ولیعصر', addressLocality: 'تهران' },
            sameAs: ['https://www.instagram.com/cafe_noor/', 'https://t.me/cafenoor'],
          },
        ],
      }),
      '{ not json',
    ]);
    expect(info.types).toEqual(['WebSite', 'LocalBusiness', 'CafeOrCoffeeShop']);
    expect(info.fields).toMatchObject({
      name: 'کافه نور',
      telephone: '+98 21 1234',
      address: 'ولیعصر، تهران',
    });
    expect(info.sameAs).toHaveLength(2);
  });
});

describe('extractPageSignals', () => {
  const html = `<html lang="fa-IR"><head>
    <script type="application/ld+json">{"@type":"Organization","name":"برند","sameAs":["https://www.linkedin.com/company/brand"]}</script>
    </head><body>
    <a href="/about">درباره ما</a>
    <a href="https://brand.ir/services#top">خدمات</a>
    <a href="https://other.com/x">other</a>
    <a href="mailto:info@brand.ir?subject=hi">mail</a>
    <a href="tel:+98-21-555">call</a>
    <a href="https://instagram.com/brand_ir">ig</a>
    <a href="https://www.instagram.com/p/xyz/">post</a>
    <a href="javascript:void(0)">js</a>
    </body></html>`;
  const sig = extractPageSignals(html, 'https://brand.ir/');

  it('collects links, contacts and language', () => {
    expect(sig.lang).toBe('fa-ir');
    expect(sig.links.map((l) => l.url)).toContain('https://brand.ir/about');
    expect(sig.links.map((l) => l.url)).toContain('https://brand.ir/services');
    expect(sig.emails).toEqual(['info@brand.ir']);
    expect(sig.phones).toEqual(['+98-21-555'.replace(/[^\d+]/g, '')]);
  });

  it('keeps social links out of the page links and merges sameAs', () => {
    expect(sig.social.map((s) => s.network).sort()).toEqual(['instagram', 'linkedin']);
    expect(sig.social.find((s) => s.network === 'instagram')?.handle).toBe('brand_ir');
    expect(sig.links.some((l) => l.url.includes('instagram'))).toBe(false);
  });
});

describe('choosing pages', () => {
  it('scores telling pages higher and junk below zero', () => {
    expect(scorePage('https://brand.ir/about')).toBeGreaterThan(scorePage('https://brand.ir/blog'));
    expect(scorePage('https://brand.ir/درباره-ما')).toBeGreaterThan(0);
    expect(scorePage('https://brand.ir/contact')).toBeGreaterThan(0);
    expect(scorePage('https://brand.ir/random-page')).toBe(0);
    expect(scorePage('https://brand.ir/wp-admin/x')).toBe(-1);
    expect(scorePage('https://brand.ir/cart')).toBe(-1);
    expect(scorePage('https://brand.ir/file.pdf')).toBe(-1);
  });

  it('recognizes blog posts, not the blog index', () => {
    expect(isArticleUrl('https://brand.ir/blog/how-to-brew')).toBe(true);
    expect(isArticleUrl('https://brand.ir/مقاله/قهوه')).toBe(true);
    expect(isArticleUrl('https://brand.ir/blog')).toBe(false);
  });

  it('picks the most telling pages plus a couple of posts, same site only', () => {
    const picked = selectPages({
      origin: 'https://brand.ir',
      skip: ['https://brand.ir/'],
      limit: 6,
      articles: 2,
      candidates: [
        { url: 'https://brand.ir/about', text: 'About us', linked: true },
        { url: 'https://www.brand.ir/services', text: 'Services', linked: true },
        { url: 'https://brand.ir/contact?ref=nav', text: 'تماس', linked: true },
        { url: 'https://brand.ir/random', text: '', linked: false },
        { url: 'https://brand.ir/cart', text: 'Cart', linked: true },
        { url: 'https://other.com/about', text: 'about', linked: true },
        { url: 'https://brand.ir/blog/post-1', text: '', linked: false },
        { url: 'https://brand.ir/blog/post-2', text: '', linked: false },
        { url: 'https://brand.ir/blog/post-3', text: '', linked: false },
        { url: 'https://brand.ir/', text: 'Home', linked: true },
      ],
    });
    expect(picked.slice(0, 3).sort()).toEqual([
      'https://brand.ir/about',
      'https://brand.ir/contact',
      'https://www.brand.ir/services'.replace('www.', ''),
    ]);
    expect(picked.filter((u) => u.includes('/blog/'))).toHaveLength(2);
    expect(picked.some((u) => u.includes('cart') || u.includes('other.com'))).toBe(false);
    expect(picked).not.toContain('https://brand.ir/');
    expect(picked.length).toBeLessThanOrEqual(6);
  });
});

describe('brandFromTitles', () => {
  it('takes the segment the page titles share', () => {
    expect(
      brandFromTitles([
        'Blue Bottle Coffee | Specialty Coffee',
        'Our Story | Blue Bottle Coffee',
        'Specialty Coffee Subscription | Blue Bottle Coffee',
      ]),
    ).toBe('Blue Bottle Coffee');
    expect(brandFromTitles(['خانه - کافه نور', 'درباره ما - کافه نور'])).toBe('کافه نور');
  });

  it('does not guess from a single title or titles with nothing in common', () => {
    expect(brandFromTitles(['Home | Brand'])).toBe('');
    expect(brandFromTitles(['A | B', 'C | D'])).toBe('');
    expect(brandFromTitles([])).toBe('');
  });

  it('does not split on dashes inside words', () => {
    expect(brandFromTitles(['Pre-order', 'Pre-order'])).toBe('Pre-order');
    expect(brandFromTitles(['Pre-order | Brand X', 'Info | Brand X'])).toBe('Brand X');
  });
});

describe('links back to the site itself', () => {
  it('are not social links of the business', () => {
    const html =
      '<a href="https://virgool.io/@someone">a</a><a href="https://virgool.io/">b</a><a href="https://t.me/virgool">c</a>';
    const sig = extractPageSignals(html, 'https://virgool.io/');
    expect(sig.social.map((s) => s.network)).toEqual(['telegram']);
  });
});
