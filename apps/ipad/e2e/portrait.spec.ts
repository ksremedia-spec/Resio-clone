import { expect, test } from '@playwright/test';
import { nav, openProject, signIn } from './helpers';

test('portrait: sidebar collapses to an overlay and split views stack', async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Clients', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Clients' })).toBeVisible();
  await page.getByRole('button', { name: /Smith/ }).first().click();
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('button', { name: /Smith/ }).first()).toBeVisible();
  await openProject(page, /Smith Residence/);
  await expect(page.getByRole('navigation', { name: 'Project sections' })).toBeVisible();
});
