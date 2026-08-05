import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { AddressInfo } from 'node:net';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';

let sourceServer: ViteDevServer;
let sourceOrigin = '';

test.beforeAll(async () => {
  sourceServer = await createServer({
    root: process.cwd(),
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
  });
  await sourceServer.listen();
  const address = sourceServer.httpServer?.address() as AddressInfo;
  sourceOrigin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await sourceServer?.close();
});

type StorageScenario =
  | { kind: 'recognized' }
  | { kind: 'unrecognized'; count: number }
  | { kind: 'pending' };

/**
 * Mounts the real `UpdateGate.svelte` directly against a controlled
 * `get_storage_compatibility` response, using Svelte 5's public
 * `createRawSnippet` to build the required `children` prop without a
 * compiled wrapper component (SvelteKit's SPA fallback intercepts
 * dynamic-import requests for arbitrary paths outside its route/module
 * graph, so a separate fixture `.svelte` file cannot be served here). No
 * Tauri runtime is present, so `invoke()` falls through to the app's
 * existing browser mock registry exactly as it does in a plain browser
 * preview.
 *
 * The remote minimum-version trigger is not exercised here: `isDevBuild()`
 * short-circuits the updater plugin's `check()` in every Vite dev-server
 * context (including this one), so that half of the gate is only
 * verifiable against a real release build - see the plan's two-version
 * compatibility smoke, which this suite does not attempt to replace.
 */
async function mountGate(page: Page, scenario: StorageScenario): Promise<void> {
  await page.goto(sourceOrigin);
  await page.setContent('<main id="fixture"></main>');
  await page.evaluate(async ({ scenario }) => {
    const [{ initI18n }, { mount, createRawSnippet }, gateModule, mockRegistryModule] = await Promise.all([
      import('/src/lib/i18n/index.ts'),
      import('/@id/svelte'),
      import('/src/components/updater/UpdateGate.svelte'),
      import('/src/lib/api/mock-registry.ts'),
    ]);
    await initI18n('en');

    mockRegistryModule.mockCommandRegistry.get_storage_compatibility = () => {
      if (scenario.kind === 'unrecognized') {
        return {
          allRecognized: false,
          unrecognizedCount: scenario.count,
          highestOffendingVersion: 31,
          supportedSchemaVersion: 30,
        };
      }
      if (scenario.kind === 'pending') {
        // Deliberately never resolved, to hold the gate in 'resolving'.
        return Promise.withResolvers().promise;
      }
      return { allRecognized: true, unrecognizedCount: 0, highestOffendingVersion: null, supportedSchemaVersion: 30 };
    };

    const childrenSnippet = createRawSnippet(() => ({
      render: () => '<div data-testid="gate-children">Authenticated content</div>',
    }));

    mount(gateModule.default, {
      target: document.querySelector('#fixture')!,
      props: { children: childrenSnippet },
    });
  }, { scenario });
}

test.describe('update gate - resolving', () => {
  test('shows the checking spinner and no children while the storage probe is pending', async ({ page }) => {
    await mountGate(page, { kind: 'pending' });

    await expect(page.locator('.checking-screen[role="status"]')).toBeVisible();
    await expect(page.locator('[data-testid="gate-children"]')).not.toBeAttached();
    await expect(page.getByRole('alertdialog')).not.toBeAttached();
  });
});

test.describe('update gate - clear', () => {
  test('renders children and no block screen when every profile is recognized', async ({ page }) => {
    await mountGate(page, { kind: 'recognized' });

    await expect(page.locator('[data-testid="gate-children"]')).toBeVisible();
    await expect(page.getByRole('alertdialog')).not.toBeAttached();
    await expect(page.locator('.checking-screen')).not.toBeAttached();
  });
});

test.describe('update gate - blocked (storage-format)', () => {
  test('replaces children with a non-dismissible block screen naming the affected profile count', async ({
    page,
  }) => {
    await mountGate(page, { kind: 'unrecognized', count: 2 });

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(page.locator('[data-testid="gate-children"]')).not.toBeAttached();

    await expect(page.locator('#update-gate-title')).toHaveText('This build cannot open your data');
    await expect(page.locator('#update-gate-description')).toContainText('2 profiles are');
    await expect(page.locator('.gate-block-nontransient')).toContainText('not a temporary problem');
  });

  test('exposes no dismiss control and stays open on Escape', async ({ page }) => {
    await mountGate(page, { kind: 'unrecognized', count: 1 });

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();

    await expect(page.getByRole('button', { name: /close|dismiss/i })).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
  });

  test('moves focus into the panel on mount', async ({ page }) => {
    await mountGate(page, { kind: 'unrecognized', count: 1 });

    const panel = page.getByRole('alertdialog');
    await expect(panel).toBeVisible();
    await expect(panel).toBeFocused();
  });
});
