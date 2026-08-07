import { expect, test, type Page } from '@playwright/test';

const uid = Date.now();
const email = `tel-${uid}@test.dev`;
const password = 'playwright-pass-123';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/accounts$/);
}

test('setup: org with a phone contact', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /create an organization/i }).click();
  await page.getByLabel('Organization name').fill('Tel Org');
  await page.getByLabel('Your name').fill('Tel Admin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create organization' }).click();

  await page.getByRole('link', { name: 'Contacts' }).click();
  await page.getByRole('button', { name: 'New contact' }).click();
  await page.getByLabel('First name').fill('Ring');
  await page.getByLabel('Last name').fill('Ring');
  await page.getByRole('button', { name: 'Create contact' }).click();
  await page.getByRole('link', { name: 'Ring Ring' }).click();
  await page.getByLabel('Phone').fill('+1 555 0199');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('+1 555 0199')).toBeVisible();
});

test('click-to-call, hang up with transcript: call + AI summary land on the timeline', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Contacts' }).click();
  await page.getByRole('link', { name: 'Ring Ring' }).click();

  await page.getByRole('button', { name: '📞 Call' }).click();
  await expect(page.getByTestId('active-call')).toBeVisible();

  await page.getByLabel('Duration (seconds)').fill('300');
  await page.getByLabel('Disposition').selectOption('connected');
  await page
    .getByLabel(/Transcript/)
    .fill('Customer asked about pricing tiers and wants a follow-up next week with details.');
  await page.getByRole('button', { name: 'Hang up & log' }).click();

  await expect(page.getByTestId('active-call')).toBeHidden();
  await expect(page.getByTestId('timeline')).toContainText('Call with Ring Ring');

  // AI summary arrives via the background capture job; the timeline doesn't
  // live-poll, so reload until the entry lands.
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId('timeline')).toContainText('AI summary', { timeout: 1500 });
  }).toPass({ timeout: 25_000 });
});
