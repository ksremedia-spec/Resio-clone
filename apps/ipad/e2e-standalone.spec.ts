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
  // Phase 7 screens run through the in-page backend as well.
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Leads', exact: true }).click();
  await expect(page.getByTestId('lead-card').filter({ hasText: 'Garcia garage conversion' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Reports', exact: true }).click();
  await page.getByTestId('report-row').filter({ hasText: 'Job cost' }).click();
  await expect(page.getByTestId('report-table')).toContainText('Smith Residence');
  // The AI assistant runs through the in-page backend too: a read answer, then a staged write.
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'AI Assistant', exact: true }).click();
  await page.getByTestId('ai-composer').fill("What's overdue on Smith Residence?");
  await page.getByTestId('ai-send').click();
  await expect(page.getByTestId('ai-message').last()).toContainText(/overdue|Nothing is overdue/, { timeout: 30_000 });
  await page.getByTestId('ai-composer').fill('Create a to-do "Assistant-made item" on Smith Residence due tomorrow');
  await page.getByTestId('ai-send').click();
  await page.getByTestId('pending-action').last().getByTestId('confirm-action').click();
  await expect(page.getByTestId('pending-action').last()).toContainText('Done');
  await page.reload();
  await expect(page.getByTestId('demo-owner').or(page.getByRole('heading', { name: /Good (morning|afternoon|evening)|Smith Residence|AI Assistant/ }))).toBeVisible({ timeout: 60_000 });
});
