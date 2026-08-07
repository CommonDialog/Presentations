import { expect, test, type Page } from '@playwright/test';

const uid = Date.now();
const email = `mail-${uid}@test.dev`;
const password = 'playwright-pass-123';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/accounts$/);
}

test('setup: org with a contact', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /create an organization/i }).click();
  await page.getByLabel('Organization name').fill('Mail Org');
  await page.getByLabel('Your name').fill('Mail Admin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create organization' }).click();

  await page.getByRole('link', { name: 'Contacts' }).click();
  await page.getByRole('button', { name: 'New contact' }).click();
  await page.getByLabel('First name').fill('Postal');
  await page.getByLabel('Last name').fill('Worker');
  await page.getByLabel('Email').fill(`postal-${uid}@corp.example`);
  await page.getByRole('button', { name: 'Create contact' }).click();
  await expect(page.getByRole('link', { name: 'Postal Worker' })).toBeVisible();
});

test('send an email from the contact page; it lands on the timeline', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Contacts' }).click();
  await page.getByRole('link', { name: 'Postal Worker' }).click();

  const emailForm = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Send email' }) });
  await emailForm.getByLabel('Subject').fill('Quarterly check-in');
  await emailForm.getByLabel('Message').fill('Hello! Just checking in on how things are going.');
  await emailForm.getByRole('button', { name: 'Send email' }).click();
  await expect(page.getByText('Sent ✓')).toBeVisible();

  await expect(page.getByTestId('timeline')).toContainText('Email: Quarterly check-in');
});

test('inbound email creates a contact automatically (via simulator API)', async ({ page }) => {
  await signIn(page);
  // simulate a provider webhook using the browser session's cookies
  const response = await page.request.post('/api/email/inbound', {
    data: {
      providerMessageId: `e2e-${uid}`,
      from: { email: `stranger-${uid}@newcorp.example`, name: 'Sudden Stranger' },
      to: [{ email: 'me@ourcrm.example' }],
      subject: 'Interested in your product',
      body: 'We saw the demo and would like to talk.',
    },
  });
  expect(response.status()).toBe(201);

  await page.getByRole('link', { name: 'Contacts' }).click();
  await page.getByPlaceholder('Search name or email…').fill('Sudden');
  await expect(page.getByRole('link', { name: 'Sudden Stranger' })).toBeVisible();

  await page.getByRole('link', { name: 'Sudden Stranger' }).click();
  await expect(page.getByTestId('timeline')).toContainText('Email: Interested in your product');
});
