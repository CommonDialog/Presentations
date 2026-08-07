import { expect, test, type Page } from '@playwright/test';

const uid = Date.now();
const email = `pipe-${uid}@test.dev`;
const password = 'playwright-pass-123';

test.describe.configure({ mode: 'serial' });

/** HTML5 DnD via dispatched events with a real DataTransfer — deterministic in headless runs. */
async function dragCardToColumn(page: Page, cardText: string, columnTestId: string) {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await page.getByText(cardText, { exact: true }).dispatchEvent('dragstart', { dataTransfer });
  await page.getByTestId(columnTestId).dispatchEvent('drop', { dataTransfer });
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/accounts$/);
}

test('setup: register org', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /create an organization/i }).click();
  await page.getByLabel('Organization name').fill('Pipeline Org');
  await page.getByLabel('Your name').fill('Pipe Admin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page).toHaveURL(/\/accounts$/);
});

test('lead lifecycle: create → qualify → convert with deal', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Leads' }).click();
  await page.getByRole('button', { name: 'New lead' }).click();
  await page.getByLabel('First name').fill('Hot');
  await page.getByLabel('Last name').fill('Prospect');
  await page.getByLabel('Company').fill('Prospect Industries');
  await page.getByRole('button', { name: 'Create lead' }).click();

  await page.getByRole('link', { name: 'Hot Prospect' }).click();
  await expect(page.getByTestId('timeline')).toContainText('created');

  await page.getByRole('button', { name: 'Mark qualified' }).click();
  await expect(page.getByRole('button', { name: 'Convert…' })).toBeVisible();

  await page.getByRole('button', { name: 'Convert…' }).click();
  await page.getByLabel('Deal name').fill('Prospect Mega Deal');
  await page.getByLabel('Amount').fill('50000');
  await page.getByRole('button', { name: 'Convert lead' }).click();

  await expect(page.getByText('Converted', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View deal' })).toBeVisible();
});

test('board: drag deal between stages, forecast updates', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Pipeline' }).click();

  // deal from conversion sits in Qualification (10%): weighted 5,000 of 50,000
  const forecast = page.getByTestId('forecast');
  await expect(forecast).toContainText('$50,000');
  await expect(forecast).toContainText('$5,000');

  const proposalColumn = page.getByTestId('column-Proposal');
  await dragCardToColumn(page, 'Prospect Mega Deal', 'column-Proposal');

  await expect(proposalColumn).toContainText('Prospect Mega Deal');
  await expect(forecast).toContainText('$25,000'); // 50% weighted

  // drop on lost column → reason dialog appears, cancel keeps it in place
  await dragCardToColumn(page, 'Prospect Mega Deal', 'column-Closed Lost');
  await expect(page.getByText('Mark "Prospect Mega Deal" as lost')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(proposalColumn).toContainText('Prospect Mega Deal');
});

test('deal detail: win the deal, history is complete', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Pipeline' }).click();
  await page.getByRole('link', { name: 'Prospect Mega Deal' }).click();

  await expect(page.getByText('Expected revenue:')).toBeVisible();
  await page.getByLabel('Move to stage').selectOption({ label: 'Closed Won (won)' });
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.getByText('won', { exact: true })).toBeVisible();

  const history = page.getByTestId('stage-history');
  await expect(history).toContainText('Created in Qualification');
  await expect(history).toContainText('Qualification → Proposal');
  await expect(history).toContainText('Proposal → Closed Won');
  await expect(page.getByTestId('timeline')).toContainText('won');

  // forecast reflects the win
  await page.getByRole('link', { name: '← Board' }).click();
  await expect(page.getByTestId('forecast')).toContainText('Won: 1');
});
