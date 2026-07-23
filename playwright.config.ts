import { defineConfig, devices } from '@playwright/test';

/**
 * E2E smoke tests for the browser-only agent build.
 * The web server serves the build-agent/ output so the SPA can load without Tauri.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3421',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm exec serve -s build-agent -p 3421',
    url: 'http://localhost:3421',
    reuseExistingServer: !process.env.CI,
  },
});
