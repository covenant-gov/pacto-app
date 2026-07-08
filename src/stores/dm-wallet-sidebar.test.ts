import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  walletSidebarOpen,
  dmWalletSidebarVisible,
  toggleWalletSidebar,
  activeDmId,
  activeDmTab,
  composingNewChat,
} from './dm';
import { activeTopNavTab, activeView } from './navigation';
import { PACTO_APP_DM_THREAD_ID } from '../lib/pacto-app-inbox';

const PEER = 'npub1peer';

beforeEach(() => {
  walletSidebarOpen.set(false);
  activeDmId.set(PEER);
  activeDmTab.set('friends');
  activeTopNavTab.set('dms');
  activeView.set('hub');
  composingNewChat.set(false);
});

describe('dmWalletSidebarVisible', () => {
  it('is false when open flag is false', () => {
    expect(get(dmWalletSidebarVisible)).toBe(false);
  });

  it('is true in friends DM hub view with open flag', () => {
    walletSidebarOpen.set(true);
    expect(get(dmWalletSidebarVisible)).toBe(true);
  });

  it('is false on non-DM top nav even when open flag is true', () => {
    walletSidebarOpen.set(true);
    activeTopNavTab.set('commons');
    expect(get(dmWalletSidebarVisible)).toBe(false);
  });

  it('is false for pacto-app inbox thread', () => {
    walletSidebarOpen.set(true);
    activeDmId.set(PACTO_APP_DM_THREAD_ID);
    activeDmTab.set('pinned');
    expect(get(dmWalletSidebarVisible)).toBe(false);
  });
});

describe('toggleWalletSidebar', () => {
  it('opens the panel from a closed visible state', () => {
    toggleWalletSidebar();
    expect(get(walletSidebarOpen)).toBe(true);
    expect(get(dmWalletSidebarVisible)).toBe(true);
  });

  it('closes the panel when it is visible', () => {
    walletSidebarOpen.set(true);
    toggleWalletSidebar();
    expect(get(walletSidebarOpen)).toBe(false);
    expect(get(dmWalletSidebarVisible)).toBe(false);
  });

  it('closes after returning to DMs with a stale open flag', () => {
    walletSidebarOpen.set(true);
    activeTopNavTab.set('commons');
    expect(get(dmWalletSidebarVisible)).toBe(false);

    activeTopNavTab.set('dms');
    expect(get(dmWalletSidebarVisible)).toBe(true);
    toggleWalletSidebar();
    expect(get(walletSidebarOpen)).toBe(false);
    expect(get(dmWalletSidebarVisible)).toBe(false);
  });
});
