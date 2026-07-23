import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const TEST_PIN = '123456';

test.describe('login screen', () => {
  test('loads the welcome screen and saves a screenshot', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('.welcome-container');
    await expect(page.locator('h1.app-title')).toHaveText('Pacto');

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
    await page.waitForSelector('.pin-title:has-text("Create your PIN")');
    for (const digit of TEST_PIN) {
      await page.keyboard.press(digit);
    }

    // Confirm PIN
    await page.waitForSelector('.pin-title:has-text("Confirm your PIN")');
    for (const digit of TEST_PIN) {
      await page.keyboard.press(digit);
    }

    // Authenticated layout should render
    await page.waitForSelector('.navbar', { timeout: 10000 });
    await expect(page.locator('.navbar')).toBeVisible();

    const outDir = 'test-results';
    fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, 'authenticated-dashboard.png') });
  });
});
