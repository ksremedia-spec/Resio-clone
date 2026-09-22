import { expect, test } from '@playwright/test';
import { nav, openProject, section, signIn } from './helpers';

test.describe('money workflows', () => {
  test('estimate: seeded sections price out, a catalog item becomes a line on an unlocked estimate', async ({ page }) => {
    await signIn(page);
    await openProject(page, /Baker Addition/);
    await section(page, 'Estimate');
    await expect(page.getByText('Family room addition').first()).toBeVisible();
    await expect(page.getByTestId('estimate-line')).toHaveCount(2);
    await page.getByRole('button', { name: 'Line', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('Search catalog items').fill('quartz');
    await dialog.getByTestId('catalog-pick').filter({ hasText: 'Quartz' }).click();
    await expect(dialog.getByPlaceholder('Shaker cabinets')).toHaveValue('Quartz countertop, installed');
    await dialog.getByLabel('Quantity').fill('40');
    await dialog.getByLabel('Quantity').blur();
    await dialog.getByRole('button', { name: 'Add line' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('estimate-line')).toHaveCount(3);
    await expect(page.getByTestId('estimate-line').filter({ hasText: 'Quartz countertop' })).toContainText('$3,600.00');
  });

  test('budget: the locked Smith estimate shows job costing with committed and actual cost, and a line drills into its transactions', async ({ page }) => {
    await signIn(page);
    await openProject(page, /Smith Residence/);
    await section(page, 'Budget');
    await expect(page.getByText('Job costing')).toBeVisible();
    const cabinets = page.getByTestId('budget-line').filter({ hasText: 'Shaker cabinets' });
    await expect(cabinets).toBeVisible();
    await cabinets.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Transactions')).toBeVisible();
    await expect(dialog.getByRole('cell', { name: /Purchase order/ }).first()).toBeVisible();
    await expect(dialog.getByRole('cell', { name: /Change order/ }).first()).toBeVisible();
    await expect(dialog.getByRole('cell', { name: /Bill/ }).first()).toBeVisible();
  });

  test('change orders: create, send and approve one; the contract value rises', async ({ page }) => {
    await signIn(page);
    await openProject(page, /Smith Residence/);
    await section(page, 'Change Orders');
    const before = await page.getByText('Revised contract').locator('..').locator('.value').innerText();
    await page.getByRole('button', { name: 'New change order' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('Add pantry cabinets').fill('Playwright skylight');
    await dialog.getByLabel('Line name').fill('Skylight, installed');
    await dialog.getByLabel('Unit cost Material').fill('900');
    await dialog.getByLabel('Unit cost Material').blur();
    await dialog.getByLabel('Unit cost Labor').fill('400');
    await dialog.getByLabel('Unit cost Labor').blur();
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Change order created.')).toBeVisible();
    const detail = page.getByRole('dialog');
    await expect(detail.getByText('Playwright skylight')).toBeVisible();
    await expect(detail.getByText('$1,560.00').first()).toBeVisible(); // 1,300 cost + 20% markup
    await detail.getByRole('button', { name: 'Send to client' }).click();
    await expect(page.getByText('Sent to the client for approval.')).toBeVisible();
    await detail.getByRole('button', { name: 'Record approval' }).click();
    await page.getByRole('dialog').last().getByPlaceholder('Jane Smith').fill('Jane Smith');
    await page.getByRole('dialog').last().getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Approved. The contract and budget are updated.')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('co-row').filter({ hasText: 'Playwright skylight' })).toContainText('approved');
    await expect.poll(async () => page.getByText('Revised contract').locator('..').locator('.value').innerText()).not.toBe(before);
  });

  test('invoices: create a draft from a budget percentage, send it and record a payment', async ({ page }) => {
    await signIn(page);
    await openProject(page, /Smith Residence/);
    await section(page, 'Invoices');
    await expect(page.getByTestId('invoice-row')).toHaveCount(3);
    await page.getByRole('button', { name: 'New invoice' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('Progress draw 2').fill('Playwright draw');
    await dialog.getByLabel('Line description').fill('Roofing — 100%');
    await dialog.getByRole('tab', { name: '% of budget' }).click();
    await dialog.getByRole('combobox').filter({ hasText: 'No budget line' }).selectOption({ label: 'Primary bath · Roofing over addition' });
    await dialog.getByLabel('Percent of budget line').fill('100');
    await dialog.getByLabel('Percent of budget line').blur();
    await dialog.getByRole('button', { name: 'Create draft' }).click();
    await expect(page.getByText('Invoice created as a draft.')).toBeVisible();
    const detail = page.getByRole('dialog');
    await expect(detail.getByText('Playwright draw')).toBeVisible();
    await expect(detail.getByText('$13,440.00').first()).toBeVisible(); // 11,200 × 1.2 markup
    await detail.getByRole('button', { name: 'Send to client' }).click();
    await expect(page.getByText('Invoice sent.')).toBeVisible();
    await detail.getByRole('button', { name: 'Record payment' }).click();
    await page.getByRole('dialog').last().getByRole('button', { name: /^Record \$/ }).click();
    await expect(page.getByText('Payment recorded.')).toBeVisible();
    await expect(detail.getByTestId('payment-row')).toHaveCount(1);
    await expect(detail.locator('.badge').filter({ hasText: 'paid' }).first()).toBeVisible();
  });

  test('purchasing: issue a PO, enter its bill, approve it and the PO becomes matched', async ({ page }) => {
    await signIn(page);
    await openProject(page, /Smith Residence/);
    await section(page, 'Purchasing');
    await expect(page.getByTestId('po-row').first()).toBeVisible();
    await page.getByRole('button', { name: 'New PO' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('Kitchen cabinets').fill('Playwright tile order');
    await dialog.getByRole('combobox').first().selectOption({ label: 'Lone Star Electric · Electrical' });
    await dialog.getByLabel('Line description').fill('Porcelain tile');
    await dialog.getByLabel('Unit cost').fill('2500');
    await dialog.getByLabel('Unit cost').blur();
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Purchase order created.')).toBeVisible();
    const detail = page.getByRole('dialog');
    await detail.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText(/now committed/)).toBeVisible();
    await detail.getByRole('button', { name: 'Issue to vendor' }).click();
    await expect(page.getByText('Issued to the vendor.')).toBeVisible();
    await detail.getByRole('button', { name: 'Enter bill' }).click();
    const bill = page.getByRole('dialog');
    await expect(bill.getByLabel('Line description')).toHaveValue('Porcelain tile');
    await bill.getByPlaceholder('HCC-4471').fill('LSE-9');
    await bill.getByRole('button', { name: 'Enter bill' }).click();
    await expect(page.getByText('Bill entered as a draft.')).toBeVisible();
    const billDetail = page.getByRole('dialog');
    await billDetail.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText(/actual cost/)).toBeVisible();
    await billDetail.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('tab', { name: 'Purchase orders' }).click();
    await expect(page.getByTestId('po-row').filter({ hasText: 'Playwright tile order' })).toContainText('matched');
  });

  test('company pages: vendors, estimating catalog, budget overview and invoices list are reachable', async ({ page }) => {
    await signIn(page);
    await nav(page, 'Vendors');
    await page.getByTestId('vendor-row').filter({ hasText: 'Hill Country Cabinets' }).click();
    await expect(page.getByRole('heading', { name: 'Hill Country Cabinets' })).toBeVisible();
    await expect(page.getByText('PO-0001')).toBeVisible();
    await nav(page, 'Estimating');
    await expect(page.getByTestId('catalog-row').first()).toBeVisible();
    await page.getByRole('tab', { name: 'Cost codes' }).click();
    await expect(page.getByTestId('cost-code-row').filter({ hasText: 'Plumbing' })).toBeVisible();
    await nav(page, 'Budget');
    await expect(page.getByTestId('budget-project-row').filter({ hasText: 'Smith Residence' })).toBeVisible();
    await nav(page, 'Invoices');
    await expect(page.getByTestId('invoice-row').first()).toBeVisible();
    await page.getByRole('tab', { name: 'Paid', exact: true }).click();
    await expect(page.getByTestId('invoice-row').filter({ hasText: 'INV-0001' })).toBeVisible();
  });

  test('estimator sees estimates but cannot approve bills; field crew has no money sections', async ({ page }) => {
    await signIn(page, 'priya@demo.buildline.app');
    await openProject(page, /Smith Residence/);
    await expect(page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name: 'Estimate' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name: 'Purchasing' })).toHaveCount(0);
  });
});
