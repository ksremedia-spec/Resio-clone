import { expect, test } from '@playwright/test';

// Smoke test for the browser-only build served statically (no API server, no Postgres).
test('standalone: boots the in-page backend, signs in, creates and lists data', async ({ page }) => {
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto('/');
  await expect(page.getByText('Setting up your private demo')).toBeVisible();
  await expect(page.getByTestId('demo-owner')).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('demo-owner').click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Smith Residence/).first()).toBeVisible();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByTestId('project-row').filter({ hasText: /Smith Residence/ }).first().click();
  await page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name: 'Tasks' }).click();
  await page.getByRole('button', { name: 'To-do', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Standalone punch item');
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
  await expect(page.getByTestId('task-row').filter({ hasText: 'Standalone punch item' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name: 'Daily Logs' }).click();
  await expect(page.getByTestId('daily-log-row').first()).toBeVisible();
  await page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name: 'Budget' }).click();
  await expect(page.getByTestId('budget-line').first()).toBeVisible();
  await page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name: 'Invoices' }).click();
  await expect(page.getByTestId('invoice-row').first()).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('demo-owner').or(page.getByRole('heading', { name: /Good (morning|afternoon|evening)|Smith Residence/ }))).toBeVisible({ timeout: 60_000 });
});
