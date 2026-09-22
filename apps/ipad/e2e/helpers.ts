import { expect, type Page } from '@playwright/test';

export const DEMO = { email: 'owner@demo.buildline.app', password: 'demo-password-123' };

export async function signIn(page: Page, email = DEMO.email, password = DEMO.password) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Office roles land on the dashboard; field roles land in field mode.
  // Office roles land on the dashboard; field roles in field mode; portal accounts on their home page.
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)|Field mode|^Hi / })).toBeVisible();
}

/** Click a sidebar item, opening the overlay menu first in compact (portrait) layouts. */
export async function nav(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Open menu' });
  if (await menu.isVisible().catch(() => false)) await menu.click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name, exact: true }).click();
}

/** Click a project hub section tab. */
export async function section(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name }).click();
}

export async function openProject(page: Page, name: RegExp | string) {
  await nav(page, 'Projects');
  await page.getByTestId('project-row').filter({ hasText: name }).first().click();
  await expect(page.getByRole('heading', { level: 1 }).filter({ hasText: name })).toBeVisible();
}
