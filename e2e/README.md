# Browser tests (Playwright)

They drive the real web app and the real API (built, `AI_PROVIDER=mock`, inline queue) on a real
Postgres that already has the migrations and the seed. They never call a model.

```bash
# once: a database with migrations and seed (DATABASE_URL in the environment), the shared package, the API build
npm run build -w @contenter/shared && npm run build -w @contenter/api
npx -w @contenter/api prisma migrate deploy && npx -w @contenter/api prisma db seed

npx playwright install chromium     # or: E2E_CHANNEL=chrome to use an installed Chrome
npm run e2e
```

- `playwright.config.ts` starts the API (`node apps/api/dist/main.js`) and the web dev server by itself;
  with `reuseExistingServer` it uses ones that are already running on 4000 and 5173.
- Each test signs in on its own through the API (`test` in `helpers.ts`): the refresh token rotates on use, so a saved session would work for one test only. `login.spec.ts` uses the real login page.
- `helpers.ts` has a small API client for setting up state and `t`, the app's own Persian dictionary, so
  the tests look for the same words the user sees.
- The tests add topics and contents to the database they run on. Use a database you can throw away.
- The economy-mode test waits for the worker's batch round (about 15 seconds after start, then every minute).
- CI: the `e2e` job in `.github/workflows/ci.yml`.
