import { expect, test } from '@playwright/test';
import { DEMO, nav, openProject, section, signIn } from './helpers';

test.describe('iPad workflows', () => {
  test('sign in shows an actionable dashboard with a persistent sidebar', async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await expect(page.getByText('Active projects').first()).toBeVisible();
    await expect(page.getByText(/Smith Residence/).first()).toBeVisible();
    await expect(page.getByText('Recent activity')).toBeVisible();
    // keyboard shortcut navigation
    await page.keyboard.press('Meta+2');
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  });

  test('rejects a bad password with a clear message', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(DEMO.email);
    await page.getByLabel('Password').fill('nope-nope-nope');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
  });

  test('creates a project from a sheet and lands in its hub', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'New project' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Project name').fill('Playwright Deck Build');
    await dialog.getByLabel('Contract value').fill('42,500.00');
    await dialog.getByLabel('City').fill('Austin');
    await dialog.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByRole('heading', { level: 1 }).filter({ hasText: 'Playwright Deck Build' })).toBeVisible();
    await expect(page.getByText('$42,500.00').first()).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Project sections' })).toBeVisible();
    await section(page, 'Activity');
    await expect(page.getByText(/created project/)).toBeVisible();
  });

  test('project hub: schedule timeline, list and calendar views render dependencies', async ({ page }) => {
    await signIn(page);
    await openProject(page, /Smith Residence/);
    await section(page, 'Schedule');
    await page.getByRole('tab', { name: 'Timeline' }).click();
    await expect(page.locator('.gantt-bar').first()).toBeVisible();
    await expect(page.getByText('Rough-in').first()).toBeVisible();
    await page.getByRole('tab', { name: 'List' }).click();
    await expect(page.getByRole('cell', { name: /Plumbing rough-in/ })).toBeVisible();
    await expect(page.getByText(/1 dep/).first()).toBeVisible();
    await page.getByRole('tab', { name: 'Calendar' }).click();
    await expect(page.locator('.calendar')).toBeVisible();
  });

  test('moving a task through the sheet cascades to dependents', async ({ page }) => {
    await signIn(page);
    await openProject(page, /Smith Residence/);
    await section(page, 'Schedule');
    await page.getByRole('tab', { name: 'List' }).click();
    await page.getByRole('cell', { name: /Plumbing rough-in/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Duration (working days)').fill('9');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await section(page, 'Activity');
    await expect(page.getByText(/rescheduled task Frame addition/).first()).toBeVisible();
  });

  test('posts a daily log in a few taps and it becomes a permanent record', async ({ page }) => {
    await signIn(page);
    await openProject(page, /Smith Residence/);
    await section(page, 'Daily Logs');
    await page.getByRole('button', { name: 'New log' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Sunny' }).click();
    await dialog.getByLabel('Increase').first().click();
    await dialog.getByLabel('Increase').first().click();
    await dialog.getByTestId('log-summary').fill('Playwright: set forms for the porch footing. Inspection booked for Friday.');
    await dialog.getByRole('button', { name: 'Delay' }).click();
    await dialog.getByPlaceholder('What was delayed and why').fill('Concrete truck arrived 2 hours late');
    await dialog.getByTestId('save-log').click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/Playwright: set forms/).first()).toBeVisible();
    await expect(page.getByText('Concrete truck arrived 2 hours late')).toBeVisible();
    await expect(page.getByText('permanent record')).toBeVisible();
  });

  test('task manager completes a task with one tap and reflects on the dashboard', async ({ page }) => {
    await signIn(page);
    await nav(page, 'Tasks');
    await page.getByRole('tab', { name: 'Everyone' }).click();
    const row = page.getByTestId('task-row').filter({ hasText: 'Order pot filler' });
    await expect(row).toBeVisible();
    await page.locator('.list-row').filter({ hasText: 'Order pot filler' }).getByRole('button', { name: 'Mark complete' }).click();
    await expect(page.getByTestId('task-row').filter({ hasText: 'Order pot filler' })).toHaveCount(0);
  });

  test('messaging: start a thread and send a message', async ({ page }) => {
    await signIn(page);
    await openProject(page, /Smith Residence/);
    await section(page, 'Messages');
    await page.getByRole('button', { name: 'New thread' }).click();
    await page.getByTestId('thread-subject').fill('Playwright tile question');
    await page.getByTestId('thread-message').fill('Which tile goes in the mudroom?');
    await page.getByTestId('create-thread').click();
    await expect(page.getByRole('heading', { name: 'Playwright tile question' })).toBeVisible();
    await page.getByTestId('composer').fill('Client picked the slate.');
    await page.getByTestId('send').click();
    await expect(page.getByText('Client picked the slate.')).toBeVisible();
    await expect(page.getByTestId('thread-row').filter({ hasText: 'Playwright tile question' })).toBeVisible();
  });

  test('documents: upload a file, see it in the grid, share it with the client', async ({ page }) => {
    await signIn(page);
    await openProject(page, /Smith Residence/);
    await section(page, 'Documents');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Upload' }).click();
    await (await chooser).setFiles({ name: 'site-note.txt', mimeType: 'text/plain', buffer: Buffer.from('north wall framed') });
    await expect(page.getByText('Uploaded site-note.txt.')).toBeVisible();
    await page.getByTestId('document-tile').filter({ hasText: 'site-note.txt' }).click();
    await page.getByRole('dialog').getByRole('switch', { name: 'Visible to client' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
  });

  test('clients: create a client with a contact and see it in the split view', async ({ page }) => {
    await signIn(page);
    await nav(page, 'Clients');
    await page.getByRole('button', { name: 'New client' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Playwright Homeowners');
    await dialog.getByLabel('Email').fill('pw@example.com');
    await dialog.getByRole('button', { name: 'Create client' }).click();
    await expect(page.getByRole('heading', { name: 'Playwright Homeowners' })).toBeVisible();
    await page.getByRole('button', { name: 'Add' }).click();
    await page.getByRole('dialog').getByLabel('First name').fill('Pat');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Pat', { exact: false }).first()).toBeVisible();
  });

  test('settings: invite a team member and manage roles', async ({ page }) => {
    await signIn(page);
    await nav(page, 'Settings');
    await page.getByRole('link', { name: 'Members & invitations' }).click();
    await page.getByRole('button', { name: 'Invite' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Email').fill('newhire@example.com');
    await dialog.getByLabel('Role').selectOption({ label: 'Field Crew' });
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText('newhire@example.com').first()).toBeVisible();
    await page.getByRole('link', { name: 'Roles & permissions' }).click();
    await expect(page.getByText('Owner / Administrator').first()).toBeVisible();
  });

  test('global search finds projects, tasks and logs across the company', async ({ page }) => {
    await signIn(page);
    await page.keyboard.press('Meta+k');
    await page.getByLabel('Global search').fill('pot filler');
    await expect(page.getByRole('dialog').getByText(/pot filler/i).first()).toBeVisible();
  });

  test('offline: a to-do created without connectivity is queued and syncs when back online', async ({ page, context }) => {
    await signIn(page);
    await openProject(page, /Harbor Point/);
    await section(page, 'Tasks');
    await expect(page.getByRole('button', { name: 'To-do' })).toBeVisible();
    await context.setOffline(true);
    await page.getByRole('button', { name: 'To-do' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Offline punch item');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('status').filter({ hasText: /queued to sync|Saved on this iPad; it will sync/ }).first()).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: /offline/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /1 queued/ })).toBeVisible();
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Sync now' }).click();
    await expect(page.getByRole('button', { name: /queued/ })).toHaveCount(0, { timeout: 15_000 });
    await page.reload();
    await expect(page.getByTestId('task-row').filter({ hasText: 'Offline punch item' })).toBeVisible();
  });

  test('field crew sees field mode with only assigned projects and limited navigation', async ({ page }) => {
    await signIn(page, 'jake@demo.buildline.app');
    await expect(page.getByRole('heading', { name: 'Field mode' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Daily log' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Clients' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Invoices' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Take photo' }).isVisible();
  });
});
