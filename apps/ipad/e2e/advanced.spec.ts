import { expect, test } from '@playwright/test';
import { nav, signIn } from './helpers';

test.describe('leads, reports, automations, offline', () => {
  test('leads: board shows the pipeline; a new lead moves stages, takes a note and converts into a project', async ({ page }) => {
    const name = `Pergola ${Date.now().toString().slice(-5)}`;
    await signIn(page);
    await nav(page, 'Leads');
    await expect(page.getByTestId('lead-board')).toBeVisible();
    await expect(page.getByTestId('lead-card').filter({ hasText: 'Garcia garage conversion' })).toBeVisible();
    await page.getByRole('button', { name: 'New lead' }).click();
    await page.getByTestId('lead-name').fill(name);
    await page.getByRole('dialog').getByLabel('Contact name').fill('Sam Playwright');
    await page.getByTestId('lead-value').fill('12500');
    await page.getByTestId('lead-value').blur();
    await page.getByTestId('save-lead').click();
    await expect(page.getByTestId('lead-title')).toHaveText(name);
    await page.getByTestId('stage-qualified').click();
    await expect(page.getByTestId('stage-qualified')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('lead-note').fill('Site walk booked for Thursday.');
    await page.getByRole('button', { name: 'Log it' }).click();
    await expect(page.getByTestId('lead-activity').filter({ hasText: 'Site walk booked' })).toBeVisible();
    await page.getByTestId('convert-lead').click();
    await page.getByTestId('confirm-convert').click();
    await expect(page.getByRole('heading', { level: 1 }).filter({ hasText: name })).toBeVisible();
    await nav(page, 'Leads');
    await expect(page.getByTestId('lead-card').filter({ hasText: name })).toBeVisible();
  });

  test('reports: receivables aging and job cost read from live data and offer a spreadsheet', async ({ page }) => {
    await signIn(page);
    await nav(page, 'Reports');
    await page.getByTestId('report-row').filter({ hasText: 'Receivables aging' }).click();
    await expect(page.getByRole('heading', { name: 'Receivables aging' })).toBeVisible();
    await expect(page.getByTestId('report-table')).toContainText('Draw 2');
    await page.getByTestId('download-csv').click();
    await expect(page.getByTestId('csv-preview')).toContainText('Invoice,Title,Project');
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
    await page.getByTestId('report-row').filter({ hasText: 'Job cost' }).click();
    await expect(page.getByTestId('report-table')).toContainText('Smith Residence');
    await page.getByTestId('report-row').filter({ hasText: 'Sales pipeline' }).click();
    await expect(page.getByTestId('report-table')).toContainText('Qualified');
  });

  test('automations: create a rule from the builder, see it listed, and run the daily check', async ({ page }) => {
    await signIn(page);
    await nav(page, 'Settings');
    await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Automations' }).click();
    await expect(page.getByTestId('automation-row').filter({ hasText: 'Daily log posted' })).toBeVisible();
    await page.getByTestId('new-automation').click();
    await page.getByTestId('automation-name').fill('Playwright rule');
    await page.getByRole('dialog').getByLabel('Event').selectOption('task.completed');
    await page.getByRole('dialog').getByPlaceholder('Daily log posted on {{project}}').fill('{{object}} finished on {{project}}');
    await page.getByTestId('save-automation').click();
    await expect(page.getByTestId('automation-row').filter({ hasText: 'Playwright rule' })).toBeVisible();
    await page.getByTestId('run-scheduled').click();
    await expect(page.getByRole('status').filter({ hasText: /Ran \d+ automation|Nothing new to act on/ })).toBeVisible();
  });

  test('offline: download everything for offline use', async ({ page }) => {
    await signIn(page);
    await nav(page, 'Settings');
    await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Offline' }).click();
    await expect(page.getByTestId('offline-status')).toContainText('Not downloaded');
    await page.getByTestId('download-offline').click();
    await expect(page.getByTestId('offline-status')).toContainText('Ready for offline', { timeout: 60_000 });
    await expect(page.getByTestId('offline-contents')).toContainText('Daily logs');
    await expect(page.getByTestId('offline-contents')).toContainText('Projects');
  });
});
