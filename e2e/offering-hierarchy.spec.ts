import { Api, expect, t, test } from './helpers';

const o = t.businesses.offerings;
const s = t.businesses.segments;

test.describe('the product tree and the audiences of a business (docs/73)', () => {
  test('a variant is added under its line and counted with its banned phrase', async ({
    page,
    request,
  }) => {
    const api = await Api.login(request);
    const business = await api.send('post', '/businesses', { name: `E2E درخت ${Date.now()}` });
    const line = await api.send('post', `/businesses/${business.id}/offerings`, { name: 'خط وام' });
    await api.send('post', `/business-offerings/${line.id}/confirm`);

    await page.goto(`/app/businesses/${business.id}`);
    await page.getByRole('button', { name: t.businesses.tabs.offerings, exact: true }).first().click();
    await expect(page.getByText('خط وام')).toBeVisible();

    // add a variant from the row's "+" button
    await page.getByRole('button', { name: o.addVariant }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(o.fields.name, { exact: true }).fill('وام خرد');
    await dialog.getByLabel(o.fields.guardrails).fill('سود تضمینی');
    await dialog.getByRole('button', { name: t.common.save }).click();
    await expect(dialog).toBeHidden();

    // the variant is saved under the line, with its banned phrase counted
    const rows = await api.get(`/businesses/${business.id}/offerings`);
    const variant = rows.find((r: { name: string }) => r.name === 'وام خرد');
    expect(variant.parentId).toBe(line.id);
    expect(variant.guardrails).toEqual(['سود تضمینی']);
    await expect(page.getByText(o.variantOf.replace('{{name}}', 'خط وام'))).toBeVisible();
    await expect(page.getByText(o.guardrailsCount.replace('{{count}}', '۱'))).toBeVisible();
  });

  test('an audience is added, linked to an offering, and shown on the audience', async ({ page, request }) => {
    const api = await Api.login(request);
    const business = await api.send('post', '/businesses', { name: `E2E مخاطب ${Date.now()}` });
    const offering = await api.send('post', `/businesses/${business.id}/offerings`, { name: 'پلن طلایی' });
    await api.send('post', `/business-offerings/${offering.id}/confirm`);

    await page.goto(`/app/businesses/${business.id}`);
    await page.getByRole('button', { name: t.businesses.tabs.audiences, exact: true }).click();
    await page.getByRole('button', { name: s.new }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(s.fields.name, { exact: true }).fill('فروشگاه‌های کوچک');
    await dialog.getByRole('button', { name: t.common.save }).or(dialog.getByRole('button', { name: t.common.create })).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('فروشگاه‌های کوچک')).toBeVisible();

    const [segment] = await api.get(`/businesses/${business.id}/segments`);
    await api.send('put', `/business-offerings/${offering.id}/segments`, { links: [{ segmentId: segment.id, fit: 2 }] });
    await page.reload();
    await page.getByRole('button', { name: t.businesses.tabs.audiences, exact: true }).click();
    await expect(page.getByText(s.linked.replace('{{count}}', '۱'))).toBeVisible();
  });
});
