import { expect, test } from '@playwright/test';

const uid = Date.now();
const email = `e2e-${uid}@test.dev`;
const password = 'playwright-pass-123';

test.describe.configure({ mode: 'serial' });

test('register a new organization', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /create an organization/i }).click();
  await page.getByLabel('Organization name').fill('Playwright Org');
  await page.getByLabel('Your name').fill('E2E Admin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(page.getByText('Playwright Org')).toBeVisible();
});

test('full journey: account → edit → contact → timeline', async ({ page }) => {
  // sign in
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/accounts$/);

  // create account (domain gets normalized server-side)
  await page.getByRole('button', { name: 'New account' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Playwright Corp');
  await page.getByLabel('Domain').fill('https://www.playwright.dev/docs');
  await page.getByLabel('Industry').fill('Testing');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('link', { name: 'Playwright Corp' }).click();

  // detail page shows normalized domain and creation timeline entry
  await expect(page.getByLabel('Domain')).toHaveValue('playwright.dev');
  await expect(page.getByTestId('timeline')).toContainText('Account "Playwright Corp" created');

  // edit → timeline gains an update entry
  await page.getByLabel('Phone').fill('555-0100');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByTestId('timeline')).toContainText('updated (phone)');

  // create a contact attached to the account
  await page.getByRole('link', { name: 'Contacts' }).click();
  await page.getByRole('button', { name: 'New contact' }).click();
  await page.getByLabel('First name').fill('Pat');
  await page.getByLabel('Last name').fill('Tester');
  await page.getByLabel('Email').fill(`pat-${uid}@playwright.dev`);
  await page.getByLabel('Account').selectOption({ label: 'Playwright Corp' });
  await page.getByRole('button', { name: 'Create contact' }).click();

  // contact detail: linked account + its own timeline entry
  await page.getByRole('link', { name: 'Pat Tester' }).click();
  await expect(page.getByText('Account: Playwright Corp')).toBeVisible();
  await expect(page.getByTestId('timeline')).toContainText('added to Playwright Corp');

  // the account timeline sees the contact too
  await page.getByRole('link', { name: 'Playwright Corp' }).click();
  await expect(page.getByTestId('timeline')).toContainText('Contact "Pat Tester" added');
  await expect(page.getByRole('link', { name: 'Pat Tester' })).toBeVisible();

  // search finds the account; a nonsense query doesn't
  await page.getByRole('link', { name: 'Accounts' }).click();
  await page.getByPlaceholder('Search name or domain…').fill('playwright.dev');
  await expect(page.getByRole('link', { name: 'Playwright Corp' })).toBeVisible();
  await page.getByPlaceholder('Search name or domain…').fill('zzz-nothing');
  await expect(page.getByText('No accounts found.')).toBeVisible();

  // sign out ends the session
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
