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
  group_id: string;
  state_lost: boolean;
  admin_npubs: string[];
  single_admin: boolean;
};

async function mountNotice(page: Page, state: ResetState, currentNpub = 'npub-self'): Promise<void> {
  await page.goto(sourceOrigin);
  await page.setContent('<main id="fixture"></main>');
  await page.evaluate(
    async ({ state, currentNpub }) => {
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
        props: { state },
      });
    },
    { state, currentNpub }
  );
}

test.describe('MLS reset explanation', () => {
  test('names every last-known admin with the matching npub', async ({ page }) => {
    await mountNotice(page, {
      group_id: 'group-multi',
      state_lost: true,
      admin_npubs: ['npub-a', 'npub-b'],
      single_admin: false,
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
        group_id: 'group-single',
        state_lost: true,
        admin_npubs: ['npub-self'],
        single_admin: true,
      },
      'npub-self'
    );
    await expect(page.getByTestId('mls-reset-notice')).toContainText('re-create the squad');

    await mountNotice(page, {
      group_id: 'group-missing',
      state_lost: true,
      admin_npubs: [],
      single_admin: false,
    });
    await expect(page.getByTestId('mls-reset-notice')).toContainText('no record of an admin');
  });
});
