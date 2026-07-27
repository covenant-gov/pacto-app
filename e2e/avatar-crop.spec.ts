import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const TEST_PIN = '111111';

/** Create an account, unlock, and land on the (collapsed) Profile settings section. */
async function createAccountAndOpenProfileSettings(page: Page) {
  await page.goto('/');

  await page.waitForSelector('.welcome-container');
  await page.click('button:has-text("Create Account")');

  await page.waitForSelector('.pin-title:has-text("Create your PIN")');
  for (const digit of TEST_PIN) {
    await page.keyboard.press(digit);
  }
  await page.waitForSelector('.pin-title:has-text("Confirm your PIN")');
  for (const digit of TEST_PIN) {
    await page.keyboard.press(digit);
  }

  await page.waitForSelector('.navbar', { timeout: 10000 });
  await page.click('button[aria-label="Settings"]');
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
}

/** Expand the edit form and open the avatar crop modal via "Change avatar". */
async function openAvatarCropModal(page: Page) {
  await page.getByRole('button', { name: 'Edit profile' }).click();
  await page.getByRole('button', { name: 'Change avatar' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test.describe('avatar crop flow', () => {
  test('opens crop modal with undersized warning, confirms, and saves the profile', async ({ page }) => {
    await createAccountAndOpenProfileSettings(page);
    await openAvatarCropModal(page);

    // Mock preview fixture is a 1x1 JPEG, well under the 512x512 recommendation (R2/AE2).
    await expect(page.locator('.crop-warning[role="status"]')).toBeVisible();
    await expect(page.locator('.crop-warning')).toContainText('smaller than the recommended');

    // Manual zoom/pan controls (traditional form elements, not just gesture-only) must be
    // visible and keyboard/click operable -- discoverability was the whole point of adding them.
    const zoomSlider = page.getByRole('slider', { name: 'Zoom' });
    await expect(zoomSlider).toBeVisible();
    const zoomOutBtn = page.getByRole('button', { name: 'Zoom out' });
    const zoomInBtn = page.getByRole('button', { name: 'Zoom in' });
    await expect(zoomOutBtn).toBeVisible();
    await expect(zoomInBtn).toBeVisible();
    for (const label of ['Move photo up', 'Move photo down', 'Move photo left', 'Move photo right']) {
      await expect(page.getByRole('button', { name: label })).toBeVisible();
    }

    const outDir = 'test-results';
    fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, 'avatar-crop-manual-controls.png') });

    // The mock preview is a 1x1 JPEG, so its zoom range is a single point by design (R12: max
    // zoom is clamped so the crop region never shrinks below 512 source px, which collapses to
    // exactly cover-fit for anything under 512x512 -- there's nowhere further to zoom into a
    // single pixel). Assert that correctly: min === max, and clicking still doesn't error.
    const sliderMin = await zoomSlider.getAttribute('min');
    const sliderMax = await zoomSlider.getAttribute('max');
    expect(Number(sliderMin)).toBeCloseTo(Number(sliderMax), 5);

    const zoomBefore = await zoomSlider.inputValue();
    await zoomInBtn.click();
    await zoomOutBtn.click();
    const zoomAfterButtons = await zoomSlider.inputValue();
    expect(Number(zoomAfterButtons)).toBeCloseTo(Number(zoomBefore), 5);

    // Zero slack on a 1x1 image in both axes at cover-fit zoom (identical to the zoom range
    // collapsing above) -- all four pan buttons must be disabled, not silently inert on click.
    for (const label of ['Move photo up', 'Move photo down', 'Move photo left', 'Move photo right']) {
      await expect(page.getByRole('button', { name: label })).toBeDisabled();
    }

    await page.getByRole('button', { name: 'Confirm' }).click();

    // Confirm crops, uploads, and closes the modal (R5/AE1); no error surfaced.
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });
    await expect(page.locator('.crop-alert[role="alert"]')).toHaveCount(0);

    // Saving the profile with the newly-set editAvatarUrl completes the F1 loop end to end.
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.toast-text')).toHaveText('Profile published to the network.', {
      timeout: 10000,
    });
  });

  test('cancel via Escape leaves the edit form untouched and reopenable', async ({ page }) => {
    await createAccountAndOpenProfileSettings(page);
    await openAvatarCropModal(page);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    // The edit form itself is unaffected by cancel (AE3): still editable, no stray error state.
    await expect(page.getByRole('button', { name: 'Change avatar' })).toBeVisible();
    await expect(page.locator('.edit-error[role="alert"]')).toHaveCount(0);

    // Modal state resets cleanly: reopening loads a fresh preview instead of a stale/stuck view.
    await page.getByRole('button', { name: 'Change avatar' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('.crop-warning[role="status"]')).toBeVisible();
  });

  test('crop viewport stays inside the dialog at the app\'s minimum supported window width', async ({
    page,
  }) => {
    // src-tauri/tauri.conf.json sets minWidth: 400 -- the real app can never be resized below
    // this, so this is the actual narrowest window a user can reach (not an arbitrary guess).
    await page.setViewportSize({ width: 400, height: 640 });
    await createAccountAndOpenProfileSettings(page);
    await openAvatarCropModal(page);
    // Let the clientWidth binding settle after layout.
    await page.waitForTimeout(200);

    const viewportBox = await page.locator('.crop-viewport').boundingBox();
    const dialogBox = await page.getByRole('dialog').boundingBox();
    expect(viewportBox).not.toBeNull();
    expect(dialogBox).not.toBeNull();
    if (!viewportBox || !dialogBox) return;

    // The circle must stay fully inside the dialog's bounds at the real minimum window width --
    // not clipped or bleeding past the modal edges. (At 400px the fixed 280px circle already
    // fits without needing to shrink; the responsive width:min(280px,100%) mechanism only
    // engages below what Tauri's own minWidth allows, so it's defensive rather than reachable --
    // see the CSS comment on .crop-viewport in AvatarCropModal.svelte.)
    expect(viewportBox.x).toBeGreaterThanOrEqual(dialogBox.x - 1);
    expect(viewportBox.x + viewportBox.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + 1);
    expect(viewportBox.y).toBeGreaterThanOrEqual(dialogBox.y - 1);
    expect(viewportBox.y + viewportBox.height).toBeLessThanOrEqual(dialogBox.y + dialogBox.height + 1);

    const outDir = 'test-results';
    fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, 'avatar-crop-min-window-width.png') });
  });
});
