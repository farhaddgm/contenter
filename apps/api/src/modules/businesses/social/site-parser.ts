/**
 * Pure code, no AI: the building blocks of the website crawl (docs/28-instagram-website-profile.md)
 * — robots.txt rules, sitemaps, structured data, social links and picking which pages to read.
 */
import { parseHTML } from 'linkedom';
import { parseInstagramHandle, type SocialLink } from '@contenter/shared';

// ---------- robots.txt ----------

interface RobotsRule {
  allow: boolean;
  pattern: RegExp;
  length: number;
}

function ruleRegex(path: string): RegExp {
  const anchored = path.endsWith('$');
  const body = (anchored ? path.slice(0, -1) : path)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/**
 * Whether robots.txt lets `agent` read a path. The group naming the agent wins over `*`; the
 * longest matching rule decides and `Allow` wins a tie (the usual crawler convention).
 */
export function parseRobots(text: string, agent = 'contenterbot'): (path: string) => boolean {
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  let current: { agents: string[]; rules: RobotsRule[] } | null = null;
  let inAgents = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (field === 'user-agent') {
      if (!inAgents || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      inAgents = true;
    } else if ((field === 'allow' || field === 'disallow') && current) {
      inAgents = false;
      if (value) {
        current.rules.push({
          allow: field === 'allow',
          pattern: ruleRegex(value),
          length: value.length,
        });
      }
    } else {
      inAgents = false;
    }
  }
  const named = groups.find((g) => g.agents.some((a) => a !== '*' && agent.includes(a)));
  const rules = (named ?? groups.find((g) => g.agents.includes('*')))?.rules ?? [];
  return (path: string) => {
    let best: RobotsRule | null = null;
    for (const r of rules) {
      if (!r.pattern.test(path)) continue;
      if (!best || r.length > best.length || (r.length === best.length && r.allow)) best = r;
    }
    return best ? best.allow : true;
  };
}

/** `Sitemap:` lines of a robots.txt. */
export function robotsSitemaps(text: string): string[] {
  return [...text.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]!);
}

// ---------- sitemap ----------

const decodeXml = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

/** `<loc>` entries of a sitemap or sitemap index. */
export function parseSitemap(xml: string): { urls: string[]; sitemaps: string[] } {
  const locs = [
    ...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi),
  ].map((m) => decodeXml(m[1]!));
  return /<sitemapindex/i.test(xml) ? { urls: [], sitemaps: locs } : { urls: locs, sitemaps: [] };
}

// ---------- page signals ----------

const NETWORKS: [RegExp, string][] = [
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)(t\.me|telegram\.me)$/, 'telegram'],
  [/(^|\.)linkedin\.com$/, 'linkedin'],
  [/(^|\.)(x\.com|twitter\.com)$/, 'x'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)aparat\.com$/, 'aparat'],
  [/(^|\.)eitaa\.com$/, 'eitaa'],
  [/(^|\.)rubika\.ir$/, 'rubika'],
  [/(^|\.)(bale\.ai|ble\.ir)$/, 'bale'],
  [/(^|\.)facebook\.com$/, 'facebook'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)pinterest\.com$/, 'pinterest'],
  [/(^|\.)(wa\.me|whatsapp\.com)$/, 'whatsapp'],
  [/(^|\.)virgool\.io$/, 'virgool'],
];
const SHARE_LINK = /share|sharer|intent\/|dialog\/|\/plugins\//i;

/** The social network a link points to and, for Instagram, the account. Null for other links. */
export function socialLink(url: string): SocialLink | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || SHARE_LINK.test(`${u.pathname}${u.search}`)) return null;
  const host = u.hostname.toLowerCase();
  const network = NETWORKS.find(([re]) => re.test(host))?.[1];
  if (!network) return null;
  if (network === 'instagram') {
    const handle = parseInstagramHandle(url);
    return handle ? { network, url: `https://www.instagram.com/${handle}/`, handle } : null;
  }
  if (u.pathname === '/' || u.pathname === '') return null; // the network's home, not an account
  return { network, url: `${u.origin}${u.pathname.replace(/\/$/, '')}` };
}

export interface PageLink {
  url: string;
  text: string;
}

export interface SchemaInfo {
  types: string[];
  /** First value found per field over the organization-like entities. */
  fields: Record<string, string>;
  sameAs: string[];
}

export interface PageSignals {
  lang: string;
  links: PageLink[];
  social: SocialLink[];
  emails: string[];
  phones: string[];
  schema: SchemaInfo;
}

const ORG_TYPES =
  /^(Organization|Corporation|LocalBusiness|Store|ProfessionalService|Restaurant|Hotel|MedicalBusiness|EducationalOrganization|OnlineStore|NewsMediaOrganization|[A-Za-z]*Business|[A-Za-z]*Store|[A-Za-z]*Service)$/;
const ORG_FIELDS = [
  'name',
  'alternateName',
  'description',
  'slogan',
  'telephone',
  'email',
  'foundingDate',
  'priceRange',
  'url',
] as const;

function plain(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return plain(v[0]);
  if (v && typeof v === 'object' && 'name' in v) return plain((v as { name: unknown }).name);
  return '';
}

function address(v: unknown): string {
  const a = Array.isArray(v) ? v[0] : v;
  if (!a || typeof a !== 'object') return plain(a);
  const o = a as Record<string, unknown>;
  return [o.streetAddress, o.addressLocality, o.addressRegion, o.addressCountry]
    .map(plain)
    .filter(Boolean)
    .join('، ');
}

function flattenLd(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) node.forEach((n) => flattenLd(n, out));
  else if (node && typeof node === 'object') {
    out.push(node as Record<string, unknown>);
    flattenLd((node as Record<string, unknown>)['@graph'], out);
  }
  return out;
}

/** Organization-like facts from `application/ld+json` blocks (name, phone, address, sameAs …). */
export function parseStructuredData(blocks: string[]): SchemaInfo {
  const info: SchemaInfo = { types: [], fields: {}, sameAs: [] };
  for (const raw of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    for (const node of flattenLd(data)) {
      const types = ([] as unknown[])
        .concat(node['@type'] ?? [])
        .filter((t): t is string => typeof t === 'string');
      for (const t of types) if (!info.types.includes(t)) info.types.push(t);
      if (!types.some((t) => ORG_TYPES.test(t))) continue;
      for (const f of ORG_FIELDS) {
        const v = plain(node[f]);
        if (v && !info.fields[f]) info.fields[f] = v.slice(0, 500);
      }
      const addr = address(node.address);
      if (addr && !info.fields.address) info.fields.address = addr;
      const area = plain(node.areaServed);
      if (area && !info.fields.areaServed) info.fields.areaServed = area;
      for (const s of ([] as unknown[]).concat(node.sameAs ?? [])) {
        if (typeof s === 'string' && !info.sameAs.includes(s)) info.sameAs.push(s);
      }
    }
  }
  info.types = info.types.slice(0, 20);
  info.sameAs = info.sameAs.slice(0, 20);
  return info;
}

const normalizeHost = (h: string) => h.toLowerCase().replace(/^www\./, '');

/** Same site: identical host ignoring `www.`. */
export const sameSite = (a: string, b: string) => normalizeHost(a) === normalizeHost(b);

export function extractPageSignals(html: string, pageUrl: string): PageSignals {
  const { document } = parseHTML(html);
  const links: PageLink[] = [];
  const social: SocialLink[] = [];
  const emails = new Set<string>();
  const phones = new Set<string>();

  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href')?.trim();
    if (!href) continue;
    if (/^mailto:/i.test(href)) {
      const mail = decodeURIComponent(href.slice(7).split('?')[0] ?? '').trim();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) emails.add(mail.toLowerCase());
      continue;
    }
    if (/^tel:/i.test(href)) {
      const tel = decodeURIComponent(href.slice(4)).replace(/[^\d+]/g, '');
      if (tel.length >= 6) phones.add(tel);
      continue;
    }
    let url: URL;
    try {
      url = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol)) continue;
    const s = socialLink(url.toString());
    if (s) {
      // A blogging/social site linking to its own pages (virgool.io → virgool.io/…) is just a link.
      if (!sameSite(url.hostname, new URL(pageUrl).hostname)) social.push(s);
      continue;
    }
    // Posts, share buttons and the like on a social network are not pages of the site.
    if (NETWORKS.some(([re]) => re.test(url.hostname.toLowerCase()))) continue;
    url.hash = '';
    links.push({
      url: url.toString(),
      text: (a.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
    });
  }

  const schema = parseStructuredData(
    [...document.querySelectorAll('script[type="application/ld+json"]')].map(
      (s) => s.textContent ?? '',
    ),
  );
  for (const s of schema.sameAs) {
    const link = socialLink(s);
    if (link) social.push(link);
  }

  const seen = new Set<string>();
  const uniqueSocial = social.filter((s) => {
    const key = `${s.network}:${s.url.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    lang: document.documentElement?.getAttribute('lang')?.trim().toLowerCase() ?? '',
    links,
    social: uniqueSocial,
    emails: [...emails].slice(0, 5),
    phones: [...phones].slice(0, 5),
    schema,
  };
}

// ---------- which pages to read ----------

const KEYWORDS: [number, RegExp][] = [
  [5, /about|درباره|معرفی|who-we|company|تاریخچه|story|ماموریت|رسالت|مأموریت/],
  [5, /services?|خدمات|products?|محصولات|محصول|solutions?|راهکار|shop|فروشگاه|menu|منو/],
  [4, /contact|تماس|ارتباط/],
  [4, /pricing|price|plans?|تعرفه|قیمت|پلن|بسته/],
  [3, /faq|سوالات|سؤالات|پرسش|questions|راهنما|help/],
  [3, /team|تیم|کارکنان|اعضا/],
  [3, /portfolio|projects?|case|نمونه[‌ ]?کار|پروژه|مشتریان|customers|clients|همکاران/],
  [2, /blog|articles?|مقاله|وبلاگ|news|اخبار|مجله|magazine/],
];
const JUNK =
  /login|signin|sign-in|register|signup|cart|checkout|wp-admin|wp-json|wp-content|feed|\/tag\/|\/tags\/|\/category\/|\/page\/\d|privacy|terms|حریم|قوانین|شرایط|my-account|account|پروفایل-کاربر|ورود|ثبت[‌-]?نام|سبد|search|\.(pdf|jpe?g|png|gif|webp|svg|zip|rar|mp4|mp3|css|js|xml|json)$/i;
const ARTICLE = /blog|articles?|مقاله|مقالات|news|post|magazine|مجله|وبلاگ/i;

function decodePath(p: string): string {
  try {
    return decodeURIComponent(p).toLowerCase();
  } catch {
    return p.toLowerCase();
  }
}

/** How useful a page is for understanding the business, from its path and link text. <0 = skip. */
export function scorePage(url: string, anchorText = ''): number {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return -1;
  }
  const path = decodePath(u.pathname);
  if (JUNK.test(path)) return -1;
  const haystack = `${path} ${anchorText.toLowerCase()}`;
  const keyword = KEYWORDS.reduce(
    (best, [w, re]) => (re.test(haystack) ? Math.max(best, w) : best),
    0,
  );
  const depth = path.split('/').filter(Boolean).length;
  return keyword > 0 ? keyword - Math.min(depth, 4) * 0.25 : 0;
}

export const isArticleUrl = (url: string) => {
  try {
    const segments = decodePath(new URL(url).pathname).split('/').filter(Boolean);
    return (
      segments.length >= 2 && ARTICLE.test(segments.join('/')) && !JUNK.test(segments.join('/'))
    );
  } catch {
    return false;
  }
};

export interface Candidate {
  url: string;
  text: string;
  /** Linked from the pages already read (a navigation link) rather than only listed in a sitemap. */
  linked: boolean;
}

const clean = (raw: string, origin: URL): string | null => {
  try {
    const u = new URL(raw, origin);
    if (!/^https?:$/.test(u.protocol) || !sameSite(u.hostname, origin.hostname)) return null;
    u.hash = '';
    u.search = '';
    u.host = origin.host; // www.brand.ir and brand.ir are one site: keep one spelling
    const href = u.toString();
    return href.endsWith('/') && u.pathname !== '/' ? href.slice(0, -1) : href;
  } catch {
    return null;
  }
};

/**
 * Picks the pages to read after the start page: the most telling ones (about, services, contact,
 * pricing, FAQ …) first, then up to `articles` blog posts as samples of the business's own voice.
 */
export function selectPages(args: {
  origin: string;
  skip: string[];
  candidates: Candidate[];
  limit: number;
  articles: number;
}): string[] {
  const origin = new URL(args.origin);
  const skip = new Set(args.skip.map((u) => clean(u, origin)).filter(Boolean));
  const best = new Map<string, { score: number; linked: boolean }>();
  for (const c of args.candidates) {
    const url = clean(c.url, origin);
    if (!url || skip.has(url)) continue;
    const score = scorePage(url, c.text);
    if (score < 0) continue;
    const prev = best.get(url);
    const next = { score: Math.max(score, prev?.score ?? 0), linked: c.linked || !!prev?.linked };
    best.set(url, next);
  }
  const ranked = [...best.entries()]
    .map(([url, v]) => ({ url, ...v, article: isArticleUrl(url) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.linked) - Number(a.linked) ||
        // Posts keep the order of the sitemap (newest first); other pages prefer shorter paths.
        (a.article && b.article ? 0 : a.url.length - b.url.length),
    );

  const core = ranked.filter((c) => !c.article && (c.score > 0 || c.linked));
  const posts = ranked.filter((c) => c.article);
  const picked = core.slice(0, Math.max(0, args.limit - args.articles)).map((c) => c.url);
  const room = args.limit - picked.length;
  return [...picked, ...posts.slice(0, Math.min(args.articles, room)).map((c) => c.url)];
}

// ---------- the business name ----------

const TITLE_SEPARATOR = /\s+[|–—·•:]\s+|\s+-\s+|\s*\|\s*/;

/**
 * The brand a set of page titles shares ("Our Story | Blue Bottle Coffee", "Subscriptions | Blue
 * Bottle Coffee" → "Blue Bottle Coffee"): the title segment that most pages have in common.
 * Empty when no segment repeats (one page cannot tell which part of its title is the brand).
 */
export function brandFromTitles(titles: string[]): string {
  const counts = new Map<string, number>();
  for (const title of titles) {
    const segments = new Set(
      title
        .split(TITLE_SEPARATOR)
        .map((p) => p.trim())
        .filter(Boolean),
    );
    for (const seg of segments) counts.set(seg, (counts.get(seg) ?? 0) + 1);
  }
  let best = '';
  let bestCount = 1;
  for (const [seg, n] of counts) {
    if (seg.length > 60) continue;
    if (n > bestCount || (n === bestCount && best && seg.length < best.length)) {
      best = seg;
      bestCount = n;
    }
  }
  return bestCount >= 2 ? best : '';
}
