import { Api, expect, t, test } from './helpers';

test('the budget card shows this month and keeps a changed cap', async ({ page, request }) => {
  const api = await Api.login(request);
  await page.goto('/app/admin/settings');
  const card = page
    .locator('div.rounded-lg', { has: page.getByRole('heading', { name: t.settings.budget.title }) })
    .last();
  await expect(card).toBeVisible();
  await expect(card.getByText(/^ماه \d+\/\d+$/)).toBeVisible();

  const cap = card.getByLabel(t.settings.budget.cap);
  await cap.fill('37');
  await card.getByRole('button', { name: t.common.save, exact: true }).click();
  await expect(page.getByText(t.common.saved).first()).toBeVisible();

  const saved = await api.get('/admin/settings/budget');
  expect(saved.settings.monthlyUsd).toBe(37);
  await page.reload();
  await expect(
    page
      .locator('div.rounded-lg', { has: page.getByRole('heading', { name: t.settings.budget.title }) })
      .last()
      .getByLabel(t.settings.budget.cap),
  ).toHaveValue('37');

  // leave the shared database as it was found
  await api.send('put', '/admin/settings/budget', { ...saved.settings, monthlyUsd: 20 });
});

test('the fallback and routing card is on the settings page', async ({ page }) => {
  await page.goto('/app/admin/settings');
  await expect(page.getByRole('heading', { name: t.settings.reliability.title })).toBeVisible();
  await expect(page.getByLabel(t.settings.reliability.fallback)).toBeVisible();
});

test('economy mode: the job waits for its batch and the draft arrives', async ({ page, request }) => {
  test.setTimeout(150_000);
  const api = await Api.login(request);
  const topic = await api.createTopic(`E2E اقتصادی ${Date.now()}`);

  // the toggle in the generate dialog explains the trade
  await page.goto(`/app/topics/${topic.id}/contents`);
  await page.getByRole('button', { name: t.contents.generate }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(t.contents.economy.off)).toBeVisible();
  await dialog.getByRole('switch').click();
  await expect(dialog.getByText(t.contents.economy.on)).toBeVisible();
  await dialog.getByRole('button', { name: t.common.cancel }).click();

  const { contentId, jobId } = await api.send('post', `/topics/${topic.id}/contents/generate`, {
    brief: 'یک کپشن کوتاه برای آزمایش حالت اقتصادی',
    format: 'CAPTION',
    economy: true,
  });

  // a moment after the request the job is waiting for the batch, not failed
  await expect
    .poll(async () => (await api.get(`/jobs/${jobId}`)).status, { timeout: 20_000 })
    .toBe('WAITING');

  // the worker submits and collects the (mock) batch on its next round, then the draft is written
  await expect
    .poll(async () => (await api.get(`/jobs/${jobId}`)).status, { timeout: 120_000, intervals: [2_000] })
    .toBe('SUCCEEDED');
  const content = await api.contentReady(contentId);
  expect(content.status).toBe('DRAFT');
  expect(content.currentVersion.body.length).toBeGreaterThan(10);
  const job = await api.get(`/jobs/${jobId}`);
  expect(job.economy).toBe(true);

  await page.goto(`/app/contents/${contentId}`);
  await expect(page.getByText(t.contents.quality.title)).toBeVisible();
});
