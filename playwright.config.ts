import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests of the main flows (docs/60-reliability-and-cost.md, "E2E"). They run against the
 * real API (built, mock AI, inline queue) and the web dev server on a real Postgres that already
 * has the migrations and the seed. See e2e/README.md.
 *
 * Every test signs in on its own (see `e2e/helpers.ts`): the refresh token rotates on use, so a
 * session saved to a file would work for one test only.
 *
 * CI installs Chromium (`npx playwright install --with-deps chromium`). On a machine with Chrome,
 * set `E2E_CHANNEL=chrome` to use it instead of a download.
 */
const API_PORT = Number(process.env.E2E_API_PORT ?? 4000);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5173);
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const channel = process.env.E2E_CHANNEL || undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // the tests share one database and one seeded account
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: WEB,
    locale: 'fa-IR',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel } }],
  webServer: [
    {
      command: 'node apps/api/dist/main.js',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
      env: {
        ...(process.env as Record<string, string>),
        NODE_ENV: 'development',
        APP_ROLE: 'all',
        PORT: String(API_PORT),
        AI_PROVIDER: 'mock',
        QUEUE_DRIVER: 'inline',
        JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? 'e2e-access-secret-0123456789abcdef',
        JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? 'e2e-refresh-secret-0123456789abcdef',
        CORS_ORIGINS: WEB,
        APP_URL: WEB,
        OWNER_EMAIL: process.env.SEED_ADMIN_EMAIL ?? 'admin@contenter.local',
      },
    },
    {
      command: `npm run dev -w @contenter/web -- --host 127.0.0.1 --port ${WEB_PORT}`,
      url: WEB,
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
      env: {
        ...(process.env as Record<string, string>),
        VITE_API_PROXY: `http://127.0.0.1:${API_PORT}`,
      },
    },
  ],
});
