import { expect, test, type Page } from '@playwright/test';

const uid = Date.now();
const email = `active-${uid}@test.dev`;
const password = 'playwright-pass-123';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/accounts$/);
}

test('setup: org with an account and a deal', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /create an organization/i }).click();
  await page.getByLabel('Organization name').fill('Active Org');
  await page.getByLabel('Your name').fill('Act Admin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create organization' }).click();

  await page.getByRole('button', { name: 'New account' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Signals Inc');
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.getByRole('link', { name: 'Pipeline' }).click();
  await page.getByRole('button', { name: 'New deal' }).click();
  await page.getByLabel('Deal name').fill('Signals Deal');
  await page.getByLabel('Account').selectOption({ label: 'Signals Inc' });
  await page.getByLabel('Amount').fill('40000');
  await page.getByRole('button', { name: 'Create deal' }).click();
  await expect(page.getByRole('link', { name: 'Signals Deal' })).toBeVisible();
});

test('analyze a deal: insight card renders with health + MEDDIC/BANT', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Pipeline' }).click();
  await page.getByRole('link', { name: 'Signals Deal' }).click();

  await expect(page.getByText('Not analyzed yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Analyze deal' }).click();

  // background job → poll → insight renders (fake provider placeholder output)
  await expect(page.getByTestId('insight-health')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('MEDDIC')).toBeVisible();
  await expect(page.getByText('BANT')).toBeVisible();
  await expect(page.getByText('Champion')).toBeVisible();

  // first insight lands on the deal timeline
  await expect(page.getByTestId('timeline')).toContainText('Deal health assessed');
});
