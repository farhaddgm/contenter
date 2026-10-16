import { Api, expect, t, test } from './helpers';

test.describe('a draft, its quality check, and the numbers of the published post', () => {
  test('the content page shows the quality check of a generated draft', async ({ page, request }) => {
    const api = await Api.login(request);
    const topic = await api.createTopic(`E2E کیفیت ${Date.now()}`);
    const { contentId } = await api.send('post', `/topics/${topic.id}/contents/generate`, {
      brief: 'یک کپشن کوتاه برای معرفی خدمات برند',
      format: 'CAPTION',
    });
    await api.contentReady(contentId);

    await page.goto(`/app/contents/${contentId}`);
    await expect(page.getByText(t.contents.quality.title)).toBeVisible();
    // the card says how long the text is against the platform limit
    await expect(page.getByText(/نویسه/).first()).toBeVisible();
  });

  test('numbers are refused before publishing, then added by hand and by pasting a table', async ({
    page,
    request,
  }) => {
    const api = await Api.login(request);
    const topic = await api.createTopic(`E2E آمار ${Date.now()}`);
    const { contentId } = await api.send('post', `/topics/${topic.id}/contents/generate`, {
      brief: 'یک کپشن کوتاه برای آزمایش آمار عملکرد',
      format: 'CAPTION',
    });
    await api.contentReady(contentId);

    // not published yet: the card explains how to unlock it
    await page.goto(`/app/contents/${contentId}`);
    await expect(page.getByText(t.contents.metrics.notPublished)).toBeVisible();

    // publish through the API, then look again
    let c = await api.get(`/contents/${contentId}`);
    for (let i = 0; i < 6 && c.status !== 'APPROVED'; i++) {
      const action = (c.review.actions as string[]).find((a) => ['submit', 'approve', 'finalize'].includes(a));
      if (!action) break;
      await api.send('post', `/contents/${contentId}/review/${action}`, {});
      c = await api.get(`/contents/${contentId}`);
    }
    await api.send('post', `/contents/${contentId}/published`, {
      publishedAt: new Date(Date.now() - 4 * 86_400_000).toISOString(),
    });
    await page.reload();
    await expect(page.getByText(t.contents.metrics.empty)).toBeVisible();

    // one reading typed in the dialog
    await page.getByRole('button', { name: t.contents.metrics.add }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(t.contents.metrics.fields.views).fill('1200');
    await dialog.getByLabel(t.contents.metrics.fields.likes).fill('90');
    await dialog.getByLabel(t.contents.metrics.fields.saves).fill('30');
    await dialog.getByRole('button', { name: t.common.save, exact: true }).click();
    await expect(page.getByText(t.contents.metrics.saved).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: /۱٬۲۰۰/ })).toBeVisible();

    // and a pasted table with two earlier days
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    await page.getByRole('button', { name: t.contents.metrics.paste }).click();
    const paste = page.getByRole('dialog');
    await paste.getByRole('textbox', { name: t.contents.metrics.table }).fill(
      `date,views,likes\n${day(3)},300,20\n${day(2)},700,45`,
    );
    await expect(paste.getByText(/۲ ردیف قابل ثبت است/)).toBeVisible();
    await paste.getByRole('button', { name: /ثبت ۲ ردیف/ }).click();
    await expect(page.getByRole('cell', { name: /^۳۰۰$/ })).toBeVisible();

    const { items } = await api.get(`/contents/${contentId}/metrics`);
    expect(items).toHaveLength(3);
  });
});
