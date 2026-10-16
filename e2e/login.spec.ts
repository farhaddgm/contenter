import { expect, test } from '@playwright/test';
import { ADMIN, t } from './helpers';


test('a wrong password is refused and the page says so', async ({ page }) => {
  await page.goto('/auth/login-up');
  await page.getByLabel(t.auth.email).fill(ADMIN.email);
  await page.getByLabel(t.auth.password).fill('not-the-password-0');
  await page.getByRole('button', { name: t.auth.login, exact: true }).click();
  await expect(page).toHaveURL(/login-up/);
  await expect(page.getByText(t.auth.loginFailed).first()).toBeVisible();
});

test('a visitor without a session is sent to the login page', async ({ page }) => {
  await page.goto('/app/contents');
  await expect(page).toHaveURL(/\/auth\/login/);
});
