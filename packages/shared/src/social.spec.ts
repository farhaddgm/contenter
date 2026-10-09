import { describe, expect, it } from 'vitest';
import { AddReferenceSchema } from './business';
import {
  CreateFromPresenceSchema,
  fixMojibake,
  InstagramManualSchema,
  instagramProfileUrl,
  isInstagramUrl,
  parseInstagramExport,
  parseInstagramHandle,
  splitCaptions,
} from './social';

describe('parseInstagramHandle', () => {
  it('accepts handles and profile links', () => {
    expect(parseInstagramHandle('@Brand.Name')).toBe('brand.name');
    expect(parseInstagramHandle('brand_name')).toBe('brand_name');
    expect(parseInstagramHandle('https://www.instagram.com/brand_name/')).toBe('brand_name');
    expect(parseInstagramHandle('https://instagram.com/brand_name/?hl=fa')).toBe('brand_name');
    expect(parseInstagramHandle('instagram.com/brand_name')).toBe('brand_name');
    expect(parseInstagramHandle('https://www.instagram.com/brand_name/reels/')).toBe('brand_name');
  });

  it('rejects posts, reels, reserved paths and malformed names', () => {
    expect(parseInstagramHandle('https://www.instagram.com/p/Cabc123/')).toBeNull();
    expect(parseInstagramHandle('https://www.instagram.com/reel/Cabc123/')).toBeNull();
    expect(parseInstagramHandle('https://www.instagram.com/brand/p/Cabc123/')).toBeNull();
    expect(parseInstagramHandle('https://www.instagram.com/explore/tags/x/')).toBeNull();
    expect(parseInstagramHandle('https://www.instagram.com/')).toBeNull();
    expect(parseInstagramHandle('https://example.com/brand')).toBeNull();
    expect(parseInstagramHandle('a b')).toBeNull();
    expect(parseInstagramHandle('..x')).toBeNull();
    expect(parseInstagramHandle('x'.repeat(31))).toBeNull();
    expect(parseInstagramHandle('')).toBeNull();
  });

  it('builds the canonical link and recognizes instagram hosts', () => {
    expect(instagramProfileUrl('brand')).toBe('https://www.instagram.com/brand/');
    expect(isInstagramUrl('https://m.instagram.com/brand')).toBe(true);
    expect(isInstagramUrl('https://instagram.com.evil.com/brand')).toBe(false);
  });
});

describe('Instagram data export', () => {
  const persianAsLatin1 = (s: string) =>
    [...Buffer.from(s, 'utf8')].map((b) => String.fromCharCode(b)).join('');

  it('repairs text whose UTF-8 bytes were stored as Latin-1', () => {
    const broken = persianAsLatin1('سلام دنیا 😀');
    expect(broken).not.toBe('سلام دنیا 😀');
    expect(fixMojibake(broken)).toBe('سلام دنیا 😀');
  });

  it('leaves correct text alone', () => {
    expect(fixMojibake('سلام')).toBe('سلام');
    expect(fixMojibake('Hello, café')).toBe('Hello, café');
  });

  it('reads posts_1.json, newest first, with carousels and videos', () => {
    const file = JSON.stringify([
      {
        media: [
          {
            uri: 'media/posts/202401/a.jpg',
            creation_timestamp: 1_700_000_000,
            title: persianAsLatin1('پست قدیمی'),
          },
        ],
      },
      {
        title: 'New caption #tag',
        media: [
          { uri: 'media/posts/202402/b.jpg', creation_timestamp: 1_710_000_000 },
          { uri: 'media/posts/202402/c.jpg', creation_timestamp: 1_710_000_000 },
        ],
      },
      {
        media: [{ uri: 'media/reels/202403/d.mp4', creation_timestamp: 1_712_000_000, title: 'r' }],
      },
    ]);
    const posts = parseInstagramExport(file);
    expect(posts.map((p) => p.caption)).toEqual(['r', 'New caption #tag', 'پست قدیمی']);
    expect(posts.map((p) => p.mediaType)).toEqual(['REEL', 'CAROUSEL', 'IMAGE']);
    expect(posts[2]!.takenAt).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it('explains files that are not an export', () => {
    expect(() => parseInstagramExport('not json')).toThrow(/valid JSON/);
    expect(() => parseInstagramExport('{"a": 1}')).toThrow(/No posts/);
    expect(() => parseInstagramExport('[]')).toThrow(/No posts/);
  });
});

describe('manual Instagram input', () => {
  it('needs a bio or a caption', () => {
    expect(InstagramManualSchema.safeParse({}).success).toBe(false);
    expect(InstagramManualSchema.safeParse({ biography: 'x' }).success).toBe(true);
    expect(InstagramManualSchema.safeParse({ posts: [{ caption: 'hello' }] }).success).toBe(true);
    expect(InstagramManualSchema.safeParse({ biography: 'x', handle: 'a b' }).success).toBe(false);
  });

  it('splits pasted captions on --- lines', () => {
    expect(splitCaptions('one\nline\n---\n\ntwo\n  ---  \nthree')).toEqual([
      'one\nline',
      'two',
      'three',
    ]);
    expect(splitCaptions('  \n')).toEqual([]);
  });
});

describe('request schemas', () => {
  it('create-from-presence needs a source and a valid account', () => {
    expect(CreateFromPresenceSchema.safeParse({}).success).toBe(false);
    expect(CreateFromPresenceSchema.safeParse({ instagram: '@brand' }).success).toBe(true);
    expect(CreateFromPresenceSchema.safeParse({ website: 'https://brand.ir' }).success).toBe(true);
    expect(CreateFromPresenceSchema.safeParse({ instagram: 'a b' }).success).toBe(false);
    expect(
      CreateFromPresenceSchema.safeParse({ instagramManual: { biography: 'bio' } }).success,
    ).toBe(true);
    const parsed = CreateFromPresenceSchema.parse({ website: 'https://brand.ir' });
    expect(parsed.scope).toBe('REFERENCES');
    expect(parsed.language).toBe('fa');
  });

  it('add-reference takes exactly one of link, text or Instagram data', () => {
    expect(AddReferenceSchema.safeParse({ url: 'https://brand.ir', site: true }).success).toBe(
      true,
    );
    expect(AddReferenceSchema.safeParse({ site: true }).success).toBe(false);
    expect(AddReferenceSchema.safeParse({ instagram: { biography: 'x' } }).success).toBe(true);
    expect(AddReferenceSchema.safeParse({ url: 'https://brand.ir', content: 'text' }).success).toBe(
      false,
    );
    expect(
      AddReferenceSchema.safeParse({ url: 'https://brand.ir', instagram: { biography: 'x' } })
        .success,
    ).toBe(false);
    expect(AddReferenceSchema.safeParse({}).success).toBe(false);
  });
});
