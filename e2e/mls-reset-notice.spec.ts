import { expect, test, type Page } from '@playwright/test';
import type { AddressInfo } from 'node:net';
import { createServer, type ViteDevServer } from 'vite';

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

type ResetState = {
  groupId: string;
  stateLost: boolean;
  adminNpubs: string[];
  singleAdmin: boolean;
};

async function mountNotice(
  page: Page,
  state: ResetState,
  currentNpub = 'npub-self',
  squadName?: string
): Promise<void> {
  await page.goto(sourceOrigin);
  await page.setContent('<main id="fixture"></main>');
  await page.evaluate(
    async ({ state, currentNpub, squadName }) => {
      const [{ initI18n }, { mount }, component, auth, profileStores] = await Promise.all([
        import('/src/lib/i18n/index.ts'),
        import('/@id/svelte'),
        import('/src/components/channel/MlsResetNotice.svelte'),
        import('/src/stores/auth.ts'),
        import('/src/stores/profiles.ts'),
      ]);
      await initI18n('en');
      auth.currentUser.set({ npub: currentNpub });
      profileStores.profiles.set({
        'npub-a': { npub: 'npub-a', name: 'Alice Admin' },
        'npub-b': { npub: 'npub-b', name: 'Bob Admin' },
      });
      mount(component.default, {
        target: document.querySelector('#fixture')!,
        props: squadName === undefined ? { state } : { state, squadName },
      });
    },
    { state, currentNpub, squadName }
  );
}

type ChatViewScenario = {
  squadId: string;
  squadName: string;
  affectedGroupId: string;
  affectedChannelName: string;
  safeGroupId: string;
  safeChannelName: string;
  activeGroupId: string;
  currentNpub?: string;
};

/**
 * Mounts the real ChatView.svelte (not the isolated notice) against a squad with one
 * MLS-reset-affected channel and one unaffected channel, driving the actual
 * `activeMlsReset` derivation and the `{#if activeMlsReset}` composer/notice swap.
 * No Tauri runtime is present, so `invoke()` falls through to the app's existing
 * browser mock registry (src/lib/api/mock-invoke.ts) exactly as it does in a
 * plain browser preview.
 */
async function mountChatView(page: Page, scenario: ChatViewScenario): Promise<void> {
  await page.goto(sourceOrigin);
  await page.setContent('<main id="fixture"></main>');
  // `page.evaluate` bodies run inside the browser page, not Node — module specifiers
  // resolve against the Vite dev server's ESM graph, so imports here must stay dynamic.
  await page.evaluate(async ({ scenario }) => {
    const [{ initI18n }, { mount }, component, auth, navigation, squadsStore, mlsReset] =
      await Promise.all([
        import('/src/lib/i18n/index.ts'),
        import('/@id/svelte'),
        import('/src/components/channel/ChatView.svelte'),
        import('/src/stores/auth.ts'),
        import('/src/stores/navigation.ts'),
        import('/src/stores/squads.ts'),
        import('/src/stores/mls-reset.ts'),
      ]);
    await initI18n('en');
    auth.currentUser.set({ npub: scenario.currentNpub ?? 'npub-self' });
    squadsStore.squads.set([
      {
        id: scenario.squadId,
        name: scenario.squadName,
        kind: 'squad',
        channels: [
          { name: scenario.affectedChannelName, groupId: scenario.affectedGroupId, order: 0 },
          { name: scenario.safeChannelName, groupId: scenario.safeGroupId, order: 1 },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);
    mlsReset.applyMlsStoreResetState([
      {
        groupId: scenario.affectedGroupId,
        stateLost: true,
        adminNpubs: ['npub-admin'],
      },
    ]);
    navigation.activeTopNavTab.set('squads');
    navigation.activeSquadId.set(scenario.squadId);
    navigation.activeChannelId.set(scenario.activeGroupId);
    mount(component.default, { target: document.querySelector('#fixture')! });
  }, { scenario });
}

function composerLocator(page: Page) {
  return page.locator('textarea.message-input');
}

function resetNoticeLocator(page: Page) {
  return page.getByTestId('mls-reset-notice');
}

test.describe('ChatView MLS reset composer swap', () => {
  const squadId = 'squad-integration';
  const squadName = 'Integration Squad';
  const affectedGroupId = 'group-affected';
  const affectedChannelName = 'general';
  const safeGroupId = 'group-safe';
  const safeChannelName = 'random';

  test('composer is replaced by the reset notice in an affected channel', async ({ page }) => {
    await mountChatView(page, {
      squadId,
      squadName,
      affectedGroupId,
      affectedChannelName,
      safeGroupId,
      safeChannelName,
      activeGroupId: affectedGroupId,
    });

    await expect(resetNoticeLocator(page)).toBeVisible();
    await expect(composerLocator(page)).toHaveCount(0);
  });

  test('composer renders as normal in an unaffected channel', async ({ page }) => {
    await mountChatView(page, {
      squadId,
      squadName,
      affectedGroupId,
      affectedChannelName,
      safeGroupId,
      safeChannelName,
      activeGroupId: safeGroupId,
    });

    await expect(composerLocator(page)).toBeVisible();
    await expect(resetNoticeLocator(page)).toHaveCount(0);
  });

  test('switching channels swaps composer and notice correctly', async ({ page }) => {
    await mountChatView(page, {
      squadId,
      squadName,
      affectedGroupId,
      affectedChannelName,
      safeGroupId,
      safeChannelName,
      activeGroupId: safeGroupId,
    });
    await expect(composerLocator(page)).toBeVisible();
    await expect(resetNoticeLocator(page)).toHaveCount(0);

    // Dynamic: this callback executes in the browser page, resolving against the
    // Vite dev server, not Node's module graph.
    await page.evaluate(async (groupId) => {
      const navigation = await import('/src/stores/navigation.ts');
      navigation.activeChannelId.set(groupId);
    }, affectedGroupId);
    await expect(resetNoticeLocator(page)).toBeVisible();
    await expect(composerLocator(page)).toHaveCount(0);

    // Dynamic: browser-page callback, see above.
    await page.evaluate(async (groupId) => {
      const navigation = await import('/src/stores/navigation.ts');
      navigation.activeChannelId.set(groupId);
    }, safeGroupId);
    await expect(composerLocator(page)).toBeVisible();
    await expect(resetNoticeLocator(page)).toHaveCount(0);
  });

  test('a live restoration clears the notice and restores the composer without a relaunch', async ({ page }) => {
    await mountChatView(page, {
      squadId,
      squadName,
      affectedGroupId,
      affectedChannelName,
      safeGroupId,
      safeChannelName,
      activeGroupId: affectedGroupId,
    });
    await expect(resetNoticeLocator(page)).toBeVisible();
    await expect(composerLocator(page)).toHaveCount(0);

    // Simulate the state a successful restoration (or a live `mls_store_reset` event
    // reporting stateLost: false) leaves behind: the group drops out of the map.
    // No page reload/relaunch happens here.
    // Dynamic: browser-page callback, see mountChatView above.
    await page.evaluate(async () => {
      const mlsReset = await import('/src/stores/mls-reset.ts');
      mlsReset.applyMlsStoreResetState([]);
    });

    await expect(composerLocator(page)).toBeVisible();
    await expect(resetNoticeLocator(page)).toHaveCount(0);
  });
});

test.describe('MLS reset explanation', () => {
  test('names every last-known admin with the matching npub', async ({ page }) => {
    await mountNotice(page, {
      groupId: 'group-multi',
      stateLost: true,
      adminNpubs: ['npub-a', 'npub-b'],
      singleAdmin: false,
    });

    const notice = page.getByTestId('mls-reset-notice');
    await expect(notice).toContainText('Alice Admin');
    await expect(notice).toContainText('npub-a');
    await expect(notice).toContainText('Bob Admin');
    await expect(notice).toContainText('npub-b');
  });

  test('uses re-create wording for a sole admin and missing-record wording for none', async ({ page }) => {
    await mountNotice(
      page,
      {
        groupId: 'group-single',
        stateLost: true,
        adminNpubs: ['npub-self'],
        singleAdmin: true,
      },
      'npub-self'
    );
    await expect(page.getByTestId('mls-reset-notice')).toContainText('re-create the squad');

    await mountNotice(page, {
      groupId: 'group-missing',
      stateLost: true,
      adminNpubs: [],
      singleAdmin: false,
    });
    await expect(page.getByTestId('mls-reset-notice')).toContainText('no record of an admin');
  });

  test('sole admin sees a recreate button that requests the squad-recreate prefill; other roles do not', async ({
    page,
  }) => {
    await mountNotice(
      page,
      {
        groupId: 'group-single',
        stateLost: true,
        adminNpubs: ['npub-self'],
        singleAdmin: true,
      },
      'npub-self',
      'Old Squad Name'
    );
    const notice = page.getByTestId('mls-reset-notice');
    await expect(notice.getByRole('button', { name: 'Re-create this squad' })).toBeVisible();
    // Click and read the store back in one atomic in-page step: a separate
    // locator.click() races the dev server's HMR-triggered re-render here.
    const prefill = await page.evaluate(async () => {
      const store = await import('/src/stores/squad-recreate.ts');
      const { get } = await import('/@id/svelte/store');
      document.querySelector<HTMLButtonElement>('.recreate-button')!.click();
      return get(store.squadRecreateRequest);
    });
    expect(prefill).toEqual({ name: 'Old Squad Name', memberNpubs: [] });

    await mountNotice(
      page,
      {
        groupId: 'group-single-other',
        stateLost: true,
        adminNpubs: ['npub-a'],
        singleAdmin: true,
      },
      'npub-self'
    );
    await expect(
      page.getByTestId('mls-reset-notice').getByRole('button', { name: 'Re-create this squad' })
    ).toHaveCount(0);

    await mountNotice(page, {
      groupId: 'group-missing',
      stateLost: true,
      adminNpubs: [],
      singleAdmin: false,
    });
    await expect(
      page.getByTestId('mls-reset-notice').getByRole('button', { name: 'Re-create this squad' })
    ).toHaveCount(0);
  });
});
