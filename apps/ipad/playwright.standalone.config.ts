import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
const CHROMIUM = process.env.PW_CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
export default defineConfig({
  testDir: '.',
  testMatch: /e2e-standalone\.spec\.ts/,
  timeout: 240_000,
  workers: 1,
  reporter: [['line']],
  use: { baseURL: 'http://localhost:5180', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'iPad landscape', use: { ...devices['iPad Pro 11 landscape'], browserName: 'chromium', defaultBrowserType: 'chromium', hasTouch: true, launchOptions: { executablePath: CHROMIUM } } }],
  webServer: { command: 'python3 -m http.server 5180 --directory dist-standalone', url: 'http://localhost:5180/', reuseExistingServer: false, timeout: 30_000 },
});
