import { expect, test } from '@playwright/test';
import { nav, openProject, section, signIn } from './helpers';

test.describe('field and vendors', () => {
  test('field crew clocks in from field mode, takes a break, clocks out; the supervisor approves the week', async ({ page }) => {
    await signIn(page, 'jake@demo.buildline.app');
    await expect(page.getByRole('heading', { name: 'Field mode' })).toBeVisible();
    const clock = page.getByTestId('clock-widget');
    await clock.getByLabel('Clock in cost code').selectOption({ index: 1 });
    await clock.getByTestId('clock-in').click();
    await expect(page.getByText('Clocked in.')).toBeVisible();
    await expect(clock.getByText('Clocked in', { exact: false }).first()).toBeVisible();
    await clock.getByRole('button', { name: 'Start break' }).click();
    await expect(clock.getByText('On break', { exact: false }).first()).toBeVisible();
    await clock.getByRole('button', { name: 'End break' }).click();
    await clock.getByTestId('clock-out').click();
    await expect(page.getByText(/Clocked out:/)).toBeVisible();
    await expect(clock.getByTestId('clock-in')).toBeVisible();
    // Crew see their own week and can add forgotten time.
    await nav(page, 'Time');
    await expect(page.getByRole('heading', { name: 'Time' })).toBeVisible();
    await expect(page.getByTestId('timesheet-row').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Payroll export' })).toHaveCount(0);
  });

  test('supervisor approves pending time and the owner exports payroll', async ({ page }) => {
    await signIn(page, 'rosa@demo.buildline.app');
    await nav(page, 'Time');
    await page.getByRole('button', { name: 'Previous week' }).click();
    await expect(page.getByTestId('timesheet-row')).toHaveCount(2);
    await expect(page.getByText(/h pending/).first()).toBeVisible();
    await page.getByTestId('approve-time').click();
    await expect(page.getByText(/entries approved/)).toBeVisible();
    await expect(page.getByText(/h pending/)).toHaveCount(0);
  });

  test('owner exports payroll for the approved week', async ({ page }) => {
    await signIn(page);
    await nav(page, 'Time');
    await page.getByRole('button', { name: 'Previous week' }).click();
    await page.getByRole('button', { name: 'Payroll export' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/approved entr/)).toBeVisible();
    await expect(dialog.getByLabel('CSV')).toHaveValue(/Employee/);
    await dialog.getByRole('button', { name: /Mark \d+ entries exported/ }).click();
    await expect(page.getByText(/marked exported/)).toBeVisible();
  });

  test('project manager requests bids, the office keys in a bid and awards it, creating a draft PO', async ({ page }) => {
    await signIn(page);
    await openProject(page, /Smith Residence/);
    await section(page, 'Purchasing');
    await page.getByRole('tab', { name: 'Bid requests' }).click();
    await page.getByRole('button', { name: 'Request bids' }).first().click();
    const form = page.getByRole('dialog');
    await form.getByPlaceholder('Plumbing rough-in').fill('Playwright roofing');
    await form.getByTestId('vendor-chip').first().click();
    await form.getByTestId('vendor-chip').nth(1).click();
    await form.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByText(/Bid request created/)).toBeVisible();
    const detail = page.getByRole('dialog');
    await expect(detail.getByTestId('bid-row')).toHaveCount(2);
    await detail.getByRole('button', { name: 'Send to vendors' }).click();
    await expect(page.getByText('Sent to the invited vendors.')).toBeVisible();
    await detail.getByRole('button', { name: 'Enter bid' }).first().click();
    const bid = page.getByRole('dialog').last();
    await bid.getByLabel('Bid amount').fill('12500');
    await bid.getByLabel('Bid amount').blur();
    await bid.getByRole('button', { name: 'Save bid' }).click();
    await expect(page.getByText('Bid recorded.')).toBeVisible();
    await detail.getByRole('button', { name: 'Award', exact: true }).click();
    await page.getByRole('dialog').last().getByRole('button', { name: 'Award and create PO' }).click();
    await expect(page.getByText(/Draft purchase order created/)).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('tab', { name: 'Purchase orders' }).click();
    await expect(page.getByTestId('po-row').filter({ hasText: 'Playwright roofing' })).toContainText('draft');
  });

  test('vendor portal: the subcontractor sees the bid request, submits a price and acknowledges a PO', async ({ page }) => {
    await signIn(page, 'orders@hillcountrycabinets.example');
    await expect(page.getByRole('heading', { name: /Hi Hank/ })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Vendors' })).toHaveCount(0);
    await expect(page.getByTestId('vendor-po').first()).toBeVisible();
    await page.getByTestId('vendor-po').filter({ hasText: 'PO-0001' }).getByRole('button', { name: 'Acknowledge' }).click();
    await expect(page.getByText(/Acknowledged/)).toBeVisible();
    await page.getByTestId('vendor-bid').filter({ hasText: 'Foundation and slab' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText(/Excavate, form and pour/)).toBeVisible();
    await sheet.getByLabel('Bid amount').fill('18900');
    await sheet.getByLabel('Bid amount').blur();
    await sheet.getByTestId('submit-bid').click();
    await expect(page.getByText(/Bid submitted/)).toBeVisible();
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('vendor-bid').filter({ hasText: 'Foundation and slab' })).toContainText('$18,900.00');
  });
});
