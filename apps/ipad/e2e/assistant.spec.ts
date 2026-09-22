import { expect, test } from '@playwright/test';
import { nav, openProject, section, signIn } from './helpers';

test.describe('AI assistant', () => {
  test('answers from live data and creates a to-do only after confirmation', async ({ page }) => {
    await signIn(page);
    await nav(page, 'AI Assistant');
    await expect(page.getByRole('heading', { name: /What can I help with/ })).toBeVisible();
    await page.getByTestId('ai-composer').fill("What's overdue on Smith Residence?");
    await page.getByTestId('ai-send').click();
    const answer = page.getByTestId('ai-message').last();
    await expect(answer).toContainText(/overdue|Nothing is overdue/, { timeout: 20_000 });
    await expect(page.getByTestId('conversation-row').first()).toContainText('overdue');
    await page.getByTestId('ai-composer').fill('Create a to-do "Confirm the countertop template date" on Smith Residence due tomorrow');
    await page.getByTestId('ai-send').click();
    const pending = page.getByTestId('pending-action').last();
    await expect(pending).toContainText('Waiting for you to confirm');
    await expect(pending).toContainText('Confirm the countertop template date');
    await pending.getByTestId('confirm-action').click();
    await expect(page.getByTestId('pending-action').last()).toContainText('Done');
    await expect(page.getByTestId('ai-message').last()).toContainText(/Done\./);
    await openProject(page, /Smith Residence/);
    await section(page, 'Tasks');
    await expect(page.getByTestId('task-row').filter({ hasText: 'Confirm the countertop template date' })).toBeVisible();
  });

  test('field crew get a plain answer instead of numbers they may not see', async ({ page }) => {
    await signIn(page, 'jake@demo.buildline.app');
    await nav(page, 'AI Assistant');
    await page.getByTestId('ai-composer').fill('How is the Smith Residence budget?');
    await page.getByTestId('ai-send').click();
    await expect(page.getByTestId('ai-message').last()).toContainText(/don't have access/, { timeout: 20_000 });
  });
});

test.describe('AI assistant on a narrow screen', () => {
  test.use({ viewport: { width: 820, height: 1180 } });
  test('New conversation opens the composer and a first question gets an answer', async ({ page }) => {
    await signIn(page);
    await nav(page, 'AI Assistant');
    await page.getByTestId('new-conversation').click();
    await expect(page.getByTestId('ai-composer')).toBeVisible();
    await page.getByTestId('ai-composer').fill('Which projects are active?');
    await page.getByTestId('ai-send').click();
    await expect(page.getByTestId('ai-message').last()).toContainText(/Smith Residence|project/i, { timeout: 20_000 });
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByTestId('conversation-row').first()).toContainText('Which projects');
  });
});
