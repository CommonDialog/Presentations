import { expect, test, type Page } from '@playwright/test';

const uid = Date.now();
const email = `act-${uid}@test.dev`;
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
  await page.getByLabel('Organization name').fill('Activity Org');
  await page.getByLabel('Your name').fill('Act Admin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page).toHaveURL(/\/accounts$/);

  await page.getByRole('button', { name: 'New account' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Timeline Industries');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('link', { name: 'Timeline Industries' })).toBeVisible();
});

test('log a call from the account page; it lands in the timeline', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Timeline Industries' }).click();

  await page.getByRole('button', { name: 'Call', exact: true }).click();
  await page.getByLabel('Subject').fill('Quarterly check-in');
  await page.getByLabel('Notes').fill('All good, renewal likely.');
  await page.getByRole('button', { name: 'Log call' }).click();

  await expect(page.getByTestId('timeline')).toContainText('Call: Quarterly check-in');
});

test('create a linked task, complete it, timeline shows both events', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Tasks' }).click();

  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByLabel('Title').fill('Send renewal quote');
  await page.getByLabel('Account').selectOption({ label: 'Timeline Industries' });
  await page.getByRole('button', { name: 'Create task' }).click();

  await expect(page.getByText('Send renewal quote')).toBeVisible();
  await page.getByLabel('complete Send renewal quote').click();
  // completed tasks drop out of the default open-only view
  await expect(page.getByText('Send renewal quote')).toBeHidden();

  await page.getByRole('link', { name: 'Accounts' }).click();
  await page.getByRole('link', { name: 'Timeline Industries' }).click();
  const timeline = page.getByTestId('timeline');
  await expect(timeline).toContainText('Task "Send renewal quote" created');
  await expect(timeline).toContainText('Task "Send renewal quote" completed');
  // and the earlier call is still there — one chronological stream
  await expect(timeline).toContainText('Call: Quarterly check-in');
});
