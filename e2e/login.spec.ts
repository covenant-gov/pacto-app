import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const TEST_PIN = '123456';

test.describe('login screen', () => {
  test('loads the welcome screen and saves a screenshot', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('.welcome-container');
    await expect(page.getByRole('heading', { level: 1, name: 'Pacto' })).toBeVisible();

    const outDir = 'test-results';
    fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, 'login-screen.png') });
  });

  test('creates an account, logs in, and shows the main navbar', async ({ page }) => {
    await page.goto('/');

    // Welcome screen
    await page.waitForSelector('.welcome-container');
    await page.click('button:has-text("Create Account")');

    // Create PIN
    await page.getByRole('heading', { name: 'Create your PIN' }).waitFor();
    for (const digit of TEST_PIN) {
      await page.keyboard.press(digit);
    }

    // Confirm PIN
    await page.getByRole('heading', { name: 'Retype your PIN' }).waitFor();
    for (const digit of TEST_PIN) {
      await page.keyboard.press(digit);
    }

    // Backup modal auto-opens over the shell after create.
    await page.getByRole('button', { name: 'Do this later' }).click({ timeout: 15000 });

    // Authenticated layout should render
    await page.waitForSelector('.navbar', { timeout: 10000 });
    await expect(page.locator('.navbar')).toBeVisible();

    const outDir = 'test-results';
    fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, 'authenticated-dashboard.png') });
  });
});
