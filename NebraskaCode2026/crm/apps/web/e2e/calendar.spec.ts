import { expect, test, type Page } from '@playwright/test';

const uid = Date.now();
const email = `cal-${uid}@test.dev`;
const password = 'playwright-pass-123';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/accounts$/);
}

test('setup: org with account + contact', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /create an organization/i }).click();
  await page.getByLabel('Organization name').fill('Calendar Org');
  await page.getByLabel('Your name').fill('Cal Admin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create organization' }).click();

  await page.getByRole('button', { name: 'New account' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Meeting Corp');
  await page.getByLabel('Domain').fill('meetingcorp.example');
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.getByRole('link', { name: 'Contacts' }).click();
  await page.getByRole('button', { name: 'New contact' }).click();
  await page.getByLabel('First name').fill('Ava');
  await page.getByLabel('Last name').fill('Attendee');
  await page.getByLabel('Email').fill('ava@meetingcorp.example');
  await page.getByLabel('Account').selectOption({ label: 'Meeting Corp' });
  await page.getByRole('button', { name: 'Create contact' }).click();
});

test('schedule a meeting; it appears with matched attendee and can be prepared', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Meetings' }).click();
  await page.getByRole('button', { name: 'New meeting' }).click();

  const start = new Date(Date.now() + 2 * 86_400_000);
  const end = new Date(start.getTime() + 3_600_000);
  const toLocal = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T10:00`;

  await page.getByLabel('Title').fill('Renewal planning');
  await page.getByLabel('Starts').fill(toLocal(start));
  await page.getByLabel('Ends').fill(toLocal(end).replace('T10:00', 'T11:00'));
  await page.getByLabel('Attendee emails (comma-separated)').fill('ava@meetingcorp.example');
  await page.getByLabel('Account').selectOption({ label: 'Meeting Corp' });
  await page.getByRole('button', { name: 'Create meeting' }).click();

  const meeting = page.getByTestId('meeting').filter({ hasText: 'Renewal planning' });
  await expect(meeting).toBeVisible();

  // meeting landed on the account timeline
  await page.getByRole('link', { name: 'Accounts' }).click();
  await page.getByRole('link', { name: 'Meeting Corp' }).click();
  await expect(page.getByTestId('timeline')).toContainText('Meeting: Renewal planning');

  // AI prep renders (fake provider placeholder output)
  await page.getByRole('link', { name: 'Meetings' }).click();
  await meeting.getByRole('button', { name: 'Prepare' }).click();
  await expect(page.getByTestId('meeting-prep')).toBeVisible({ timeout: 15_000 });
});
