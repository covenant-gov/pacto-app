import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const TEST_PIN = '222222';

async function createAccountAndOpenSettings(page: Page) {
  await page.goto('/');
  await page.waitForSelector('.welcome-container');
  await page.click('button:has-text("Create Account")');

  await page.getByRole('heading', { name: 'Create your PIN' }).waitFor();
  for (const digit of TEST_PIN) {
    await page.keyboard.press(digit);
  }
  await page.getByRole('heading', { name: 'Retype your PIN' }).waitFor();
  for (const digit of TEST_PIN) {
    await page.keyboard.press(digit);
  }

  await page.getByRole('button', { name: 'Do this later' }).click({ timeout: 15000 });
  await page.waitForSelector('.navbar', { timeout: 10000 });
  await page.click('button[aria-label="Settings"]');
}

test.describe('experimental features settings', () => {
  test('lists registered flags and toggles one on', async ({ page }) => {
    await createAccountAndOpenSettings(page);

    await page.getByRole('button', { name: 'EVM settings' }).click();
    const importKey = page.getByRole('button', { name: 'Import private key' });
    await expect(page.getByRole('button', { name: 'Add squad account' })).toBeVisible();
    const contractCall = page.getByRole('heading', { name: 'Advanced contract call' });
    await expect(importKey).toHaveCount(0);
    await expect(contractCall).toHaveCount(0);

    await page.getByRole('button', { name: 'Experimental features' }).click();
    const toggle = page.getByRole('switch', { name: 'Advanced EVM accounts' });
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();
    await expect(page.locator('#settings-experimental')).toContainText('may change, break, or be removed');

    const outDir = 'test-results';
    fs.mkdirSync(outDir, { recursive: true });
    const section = page.locator('#settings-experimental');
    await section.screenshot({ path: path.join(outDir, 'experimental-features-off.png') });

    await toggle.check();
    await expect(toggle).toBeChecked();
    await section.screenshot({ path: path.join(outDir, 'experimental-features-on.png') });

    // The gated surfaces appear without a restart.
    await expect(importKey).toBeVisible();
    await expect(contractCall).toBeVisible();
    await page.screenshot({ path: path.join(outDir, 'experimental-features-page.png'), fullPage: true });
  });
});
