import { expect, test } from '@playwright/test';
import { nav, openProject, section, signIn } from './helpers';

test.describe('client selections sheet', () => {
  test('team: the Baker sheet shows both lists, a choice with a written answer is recorded, the client signature is captured and the sheet is published', async ({ page }) => {
    await signIn(page);
    await openProject(page, /Baker Addition/);
    await section(page, 'Selections');
    await expect(page.getByTestId('sheet-banner')).toContainText('of');
    await page.getByTestId('open-sheet').click();
    await expect(page.getByTestId('selections-sheet')).toBeVisible();
    await expect(page.getByTestId('selections-sheet')).toContainText('Flooring');
    await expect(page.getByTestId('selections-sheet')).toContainText('Exterior (selection list)');
    await expect(page.getByTestId('sheet-item').filter({ hasText: 'Wood floors' })).toContainText('Decided');
    await expect(page.getByTestId('sheet-item').filter({ hasText: 'Roofing' })).toContainText('Weathered Wood');
    // An undecided written-in item: choose, fill in a field, record who decided.
    await page.getByTestId('sheet-item').filter({ hasText: 'Siding: clapboards' }).click();
    const detail = page.getByRole('dialog').filter({ hasText: 'Siding: clapboards' });
    await detail.getByTestId('selection-option').filter({ hasText: 'Cementitious' }).click();
    await detail.getByTestId('answer-field').first().fill('BM Hale Navy');
    await detail.getByTestId('selection-comment').fill('Sample approved on site.');
    await detail.getByTestId('record-choice').click();
    await page.getByTestId('decided-by').fill('Robert Baker');
    await page.getByTestId('confirm-choice').click();
    await expect(page.getByRole('status').filter({ hasText: 'Choice recorded' })).toBeVisible();
    await page.getByRole('dialog').filter({ hasText: 'Siding: clapboards' }).getByRole('button', { name: 'Cancel' }).first().click();
    await expect(page.getByTestId('sheet-item').filter({ hasText: 'Siding: clapboards' })).toContainText('BM Hale Navy');
    // Sign and publish.
    await page.getByTestId('sign-sheet').click();
    await page.getByRole('dialog').getByPlaceholder("Client's name").fill('Robert Baker');
    await page.getByTestId('signature-text').fill('Robert Baker');
    await page.getByTestId('confirm-sign').click();
    await expect(page.getByTestId('sheet-signoff')).toContainText('Robert Baker');
    await page.getByTestId('publish-sheet').click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved to Documents' })).toBeVisible();
    await section(page, 'Documents');
    await expect(page.getByText(/Selections sheet \(/).first()).toBeVisible();
  });

  test('homeowner: the standard sheet appears in the portal, the client ticks a choice and signs', async ({ page }) => {
    // The builder adds the checklist to the Smith project and releases it.
    await signIn(page);
    await openProject(page, /Smith Residence/);
    await section(page, 'Selections');
    await page.getByTestId('add-template').click();
    await page.getByTestId('template-select').selectOption('checklist');
    await page.getByTestId('apply-template').click();
    await expect(page.getByRole('status').filter({ hasText: /Added \d+ selections/ })).toBeVisible();
    await expect(page.getByTestId('sheet-banner')).toBeVisible();
    // The homeowner sees it, decides an item and signs.
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await signIn(page, 'jane@example.com');
    await expect(page.getByTestId('portal-sheet')).toContainText('Your selections sheet');
    await page.getByTestId('portal-sheet').getByRole('button', { name: 'Open sheet' }).click();
    await page.getByTestId('sheet-item').filter({ hasText: 'Heating fuel' }).click();
    const dlg = page.getByRole('dialog').filter({ hasText: 'Heating fuel' });
    await dlg.getByTestId('selection-option').filter({ hasText: 'Oil' }).click();
    await dlg.getByTestId('record-choice').click();
    await page.getByTestId('confirm-choice').click();
    await expect(page.getByRole('status').filter({ hasText: 'Choice recorded' })).toBeVisible();
    await page.getByRole('dialog').filter({ hasText: 'Heating fuel' }).getByRole('button', { name: 'Cancel' }).first().click();
    await expect(page.getByTestId('sheet-item').filter({ hasText: 'Heating fuel' })).toContainText('Decided');
    await page.getByTestId('sign-sheet').click();
    await page.getByTestId('signature-text').fill('Jane Smith');
    await page.getByTestId('confirm-sign').click();
    await expect(page.getByTestId('sheet-signoff')).toContainText('Jane Smith (client)');
  });

  test('field crew can read the finished picks from field mode', async ({ page }) => {
    await signIn(page, 'jake@demo.buildline.app');
    await page.getByRole('button', { name: 'Client selections' }).click();
    await expect(page.getByTestId('selections-sheet')).toBeVisible();
  });
});
