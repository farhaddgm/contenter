import { describe, expect, it } from 'vitest';
import {
  detectPlatform,
  isPrivateIp,
  mediaTypeFromContentType,
  mediaTypeFromOgType,
  parseHtml,
} from './media-parser';

describe('detectPlatform', () => {
  it.each([
    ['https://www.instagram.com/p/abc/', 'INSTAGRAM'],
    ['https://youtu.be/xyz', 'YOUTUBE'],
    ['https://m.youtube.com/watch?v=1', 'YOUTUBE'],
    ['https://t.me/channel/12', 'TELEGRAM'],
    ['https://x.com/user/status/1', 'X'],
    ['https://twitter.com/user', 'X'],
    ['https://www.linkedin.com/posts/a', 'LINKEDIN'],
    ['https://virgool.io/@a/post', 'BLOG'],
    ['https://example.com', 'OTHER'],
    ['https://notinstagram.com.evil.io', 'OTHER'],
  ])('%s → %s', (url, expected) => {
    expect(detectPlatform(url)).toBe(expected);
  });
});

describe('isPrivateIp', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])('blocks %s', (ip) => expect(isPrivateIp(ip)).toBe(true));
  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111'])('allows %s', (ip) =>
    expect(isPrivateIp(ip)).toBe(false),
  );
  it('treats non-IPs as unsafe', () => expect(isPrivateIp('not-an-ip')).toBe(true));
});

describe('content type helpers', () => {
  it('maps content types', () => {
    expect(mediaTypeFromContentType('image/png')).toBe('IMAGE');
    expect(mediaTypeFromContentType('video/mp4')).toBe('VIDEO');
    expect(mediaTypeFromContentType('text/html; charset=utf-8')).toBeNull();
  });
  it('maps og:type', () => {
    expect(mediaTypeFromOgType('video.other')).toBe('VIDEO');
    expect(mediaTypeFromOgType('article')).toBe('ARTICLE');
    expect(mediaTypeFromOgType('website')).toBeNull();
  });
});

describe('parseHtml', () => {
  const html = `<!doctype html><html><head>
    <title>Fallback title</title>
    <meta property="og:title" content="عنوان مقاله">
    <meta property="og:description" content="توضیح کوتاه">
    <meta property="og:site_name" content="وبلاگ">
    <meta property="og:type" content="article">
    <meta property="og:image" content="/img/cover.jpg">
    <meta name="author" content="نویسنده">
  </head><body><nav>menu</nav><article><h1>عنوان</h1>
    <p>${'این یک پاراگراف طولانی برای آزمایش استخراج متن است. '.repeat(20)}</p>
  </article><script>evil()</script></body></html>`;

  it('extracts metadata, absolute images and readable text', () => {
    const { media, ogType } = parseHtml(html, 'https://blog.example.com/post/1');
    expect(ogType).toBe('article');
    expect(media.title).toBe('عنوان مقاله');
    expect(media.description).toBe('توضیح کوتاه');
    expect(media.siteName).toBe('وبلاگ');
    expect(media.author).toBe('نویسنده');
    expect(media.images).toEqual(['https://blog.example.com/img/cover.jpg']);
    expect(media.text).toContain('پاراگراف طولانی');
    expect(media.text).not.toContain('evil()');
  });

  it('falls back to <title> when og:title is missing', () => {
    const { media } = parseHtml(
      '<html><head><title>Only title</title></head><body>hi</body></html>',
      'https://a.com',
    );
    expect(media.title).toBe('Only title');
    expect(media.images).toEqual([]);
  });
});
