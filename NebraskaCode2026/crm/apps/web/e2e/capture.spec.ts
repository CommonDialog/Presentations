import { expect, test, type Page } from '@playwright/test';

const uid = Date.now();
const email = `cap-${uid}@test.dev`;
const password = 'playwright-pass-123';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/accounts$/);
}

test('setup: register org with an account', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /create an organization/i }).click();
  await page.getByLabel('Organization name').fill('Capture Org');
  await page.getByLabel('Your name').fill('Cap Admin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page).toHaveURL(/\/accounts$/);

  await page.getByRole('button', { name: 'New account' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Insight Industries');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('link', { name: 'Insight Industries' })).toBeVisible();
});

test('capture an email: activity logged, AI summary appears on the timeline', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Capture' }).click();

  await page.getByLabel('Subject').fill('Renewal discussion');
  await page.getByLabel('Account').selectOption({ label: 'Insight Industries' });
  await page
    .getByLabel('Content')
    .fill('Hi team, we discussed the renewal today and the customer is interested in expanding.');
  await page.getByRole('button', { name: 'Capture & analyze' }).click();

  // the fake provider returns schema-valid placeholder output — the flow still completes
  await expect(page.getByTestId('capture-summary')).toBeVisible({ timeout: 20_000 });

  // the source email and the AI summary both landed on the account timeline
  await page.getByRole('link', { name: 'Accounts' }).click();
  await page.getByRole('link', { name: 'Insight Industries' }).click();
  const timeline = page.getByTestId('timeline');
  await expect(timeline).toContainText('Email: Renewal discussion');
  await expect(timeline).toContainText('AI summary');
});

test('approvals page shows the review queue', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Approvals' }).click();
  await expect(page.getByText('never changes records directly')).toBeVisible();
  // placeholder analysis proposes nothing → empty pending queue
  await expect(page.getByTestId('approvals-empty')).toBeVisible();
});
