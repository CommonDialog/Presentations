import { expect, test, type Page } from '@playwright/test';

const uid = Date.now();
const email = `proj-${uid}@test.dev`;
const password = 'playwright-pass-123';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/accounts$/);
}

test('setup: org with an account', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /create an organization/i }).click();
  await page.getByLabel('Organization name').fill('Proj Org');
  await page.getByLabel('Your name').fill('Proj Admin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create organization' }).click();

  await page.getByRole('button', { name: 'New account' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Delivery Inc');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('link', { name: 'Delivery Inc' })).toBeVisible();
});

test('create project, milestones, kanban drag, gantt', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Rollout');
  await page.getByLabel('Account').selectOption({ label: 'Delivery Inc' });
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('link', { name: 'Rollout' }).click();

  // activate + milestone
  await page.getByRole('button', { name: 'Mark active' }).click();
  await page.getByPlaceholder('New milestone…').fill('Phase 1');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('milestones')).toContainText('Phase 1');

  // task onto the kanban
  await page.getByLabel('Title').fill('Install agent');
  await page.getByLabel('Milestone').selectOption({ label: 'Phase 1' });
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByTestId('kanban-open')).toContainText('Install agent');

  // drag to in-progress (DataTransfer dispatch pattern)
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await page
    .getByTestId('kanban-open')
    .getByText('Install agent')
    .dispatchEvent('dragstart', { dataTransfer });
  await page.getByTestId('kanban-in_progress').dispatchEvent('drop', { dataTransfer });
  await expect(page.getByTestId('kanban-in_progress')).toContainText('Install agent');

  // gantt renders
  await page.getByRole('button', { name: 'Gantt' }).click();
  await expect(page.getByTestId('gantt')).toBeVisible();
  await expect(page.getByTestId('gantt')).toContainText('Phase 1');
});

test('customer portal: public page shows status without login', async ({ page, context }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('link', { name: 'Rollout' }).click();

  await page.getByRole('button', { name: 'Enable portal' }).click();
  await expect(page.getByTestId('portal-link')).toBeVisible();
  const link = (await page.getByTestId('portal-link').textContent())!.trim();

  // open in a fresh, unauthenticated context page
  const anon = await context.browser()!.newContext();
  const portalPage = await anon.newPage();
  await portalPage.goto(link);
  await expect(portalPage.getByTestId('portal-title')).toHaveText('Rollout');
  await expect(portalPage.getByText('Delivery Inc')).toBeVisible();
  await expect(portalPage.getByText('Phase 1')).toBeVisible();
  await anon.close();
});
