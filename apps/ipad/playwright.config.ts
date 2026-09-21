import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Containers ship a pre-installed Chromium at this path; local machines use Playwright's own download.
const CHROMIUM = process.env.PW_CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

const E2E_DB = process.env.E2E_DATABASE_URL ?? 'postgres://postgres@localhost:5432/buildline_e2e';
const API_PORT = 4100;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5174', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  // iPad Pro 11" geometry and touch, driven by the Chromium engine available in CI containers
  // (WebKit is used on real devices; layouts and interactions are engine-neutral).
  projects: [
    { name: 'iPad landscape', use: { ...devices['iPad Pro 11 landscape'], browserName: 'chromium', defaultBrowserType: 'chromium', hasTouch: true, launchOptions: { executablePath: CHROMIUM } }, testIgnore: /portrait/ },
    { name: 'iPad portrait', use: { ...devices['iPad Pro 11'], browserName: 'chromium', defaultBrowserType: 'chromium', hasTouch: true, launchOptions: { executablePath: CHROMIUM } }, testMatch: /portrait/ },
  ],
  webServer: [
    {
      command: `cd ../api && DATABASE_URL=${E2E_DB} pnpm exec tsx src/db/migrate.ts && DATABASE_URL=${E2E_DB} pnpm exec tsx src/db/reset.ts && DATABASE_URL=${E2E_DB} pnpm exec tsx src/db/seed.ts && DATABASE_URL=${E2E_DB} PORT=${API_PORT} API_URL=http://localhost:${API_PORT} APP_URL=http://localhost:5174 CORS_ORIGINS=http://localhost:5174 EMAIL_DRIVER=console LOG_LEVEL=warn NODE_ENV=development pnpm exec tsx src/main.ts`,
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `VITE_API_URL=http://localhost:${API_PORT} vite --port 5174 --strictPort`,
      url: 'http://localhost:5174',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
