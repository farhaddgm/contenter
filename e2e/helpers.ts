import { test as base, expect, type APIRequestContext } from '@playwright/test';
import { fa } from '../apps/web/src/i18n/fa';

/** Persian UI text, straight from the app's dictionary, so a renamed label breaks the test, not a guess. */
export const t = fa;

const API = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 4000}/api`;

/** The account the seed creates (docs/08-development.md); override with SEED_ADMIN_*. */
export const ADMIN = {
  email: (process.env.SEED_ADMIN_EMAIL ?? 'admin@contenter.local').toLowerCase(),
  password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!',
};

/** A small typed client of the API for setting up and checking state outside the browser. */
export class Api {
  private constructor(
    private readonly request: APIRequestContext,
    private readonly token: string,
  ) {}

  static async login(request: APIRequestContext): Promise<Api> {
    const res = await request.post(`${API}/auth/login`, { data: ADMIN });
    if (!res.ok()) throw new Error(`API login failed: ${res.status()} ${await res.text()}`);
    return new Api(request, (await res.json()).accessToken);
  }

  private headers() {
    return { authorization: `Bearer ${this.token}` };
  }

  async get<T = any>(path: string): Promise<T> {
    const res = await this.request.get(`${API}${path}`, { headers: this.headers() });
    if (!res.ok()) throw new Error(`GET ${path}: ${res.status()} ${await res.text()}`);
    return res.json();
  }

  async send<T = any>(method: 'post' | 'put' | 'patch', path: string, data?: unknown): Promise<T> {
    const res = await this.request[method](`${API}${path}`, { headers: this.headers(), data });
    if (!res.ok()) throw new Error(`${method.toUpperCase()} ${path}: ${res.status()} ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : (undefined as T);
  }

  /** A topic to put content in. */
  async createTopic(title: string, platform = 'INSTAGRAM') {
    return this.send('post', '/topics', {
      title,
      description: 'موضوع آزمایشی برای تست مرورگر',
      platform,
      language: 'fa',
    });
  }

  /** Waits (polling) until the content has left GENERATING. */
  async contentReady(id: string, timeoutMs = 90_000) {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const c = await this.get(`/contents/${id}`);
      if (c.status !== 'GENERATING') return c;
      if (Date.now() > until) throw new Error(`content ${id} is still generating`);
      await new Promise((r) => setTimeout(r, 700));
    }
  }

  /** A generated draft, walked through review to APPROVED and marked published three days ago. */
  async publishedContent(topicId: string) {
    const { contentId } = await this.send('post', `/topics/${topicId}/contents/generate`, {
      brief: 'یک کپشن کوتاه برای معرفی خدمات برند',
      format: 'CAPTION',
    });
    let c = await this.contentReady(contentId);
    for (let i = 0; i < 6 && c.status !== 'APPROVED'; i++) {
      const action = (c.review.actions as string[]).find((a) => ['submit', 'approve', 'finalize'].includes(a));
      if (!action) break;
      await this.send('post', `/contents/${contentId}/review/${action}`, {});
      c = await this.get(`/contents/${contentId}`);
    }
    if (c.status !== 'APPROVED') throw new Error(`could not approve content ${contentId} (${c.status})`);
    await this.send('post', `/contents/${contentId}/published`, {
      publishedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    });
    return contentId as string;
  }
}

/**
 * `test` whose `page` is already signed in: the login is done through the API into the page's own
 * cookie jar, so each test has a session of its own (a refresh token can be used only once).
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    // The floating Smart assistant covers the corner of the page and swallows clicks there; the
    // header toggle that hides it is remembered in localStorage (features/smart/store.ts).
    await page.addInitScript(() =>
      localStorage.setItem('contenter-smart', JSON.stringify({ state: { enabled: false }, version: 0 })),
    );
    const res = await page.request.post(`${API}/auth/login`, { data: ADMIN });
    if (!res.ok()) throw new Error(`sign-in failed: ${res.status()} ${await res.text()}`);
    await use(page);
  },
});

export { expect };
