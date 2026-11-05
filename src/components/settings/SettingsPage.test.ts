// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRawSnippet, tick } from 'svelte';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import SettingsPage from './SettingsPage.svelte';
import { resetUsernameState, usernameState, type UsernameState } from '../../stores/username';

const cachedClaim: NonNullable<UsernameState['cached']> = {
  npub: 'npub1',
  username: 'alice',
  npubHash: '0x' + 'ab'.repeat(32),
  tokenId: '1',
  linkEventId: 'evt1',
  policyVersion: 3,
  network: 'sepolia',
  updatedAtMs: 1,
};

function rect(top: number): DOMRect {
  return {
    top,
    bottom: top,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function pageChildren() {
  return createRawSnippet(() => ({
    render: () =>
      '<div><div id="settings-profile">Profile body</div><div id="settings-evm-dash-gas">Dash body</div></div>',
  }));
}

function renderPage() {
  return render(SettingsPage, {
    props: { onBack: () => {}, children: pageChildren() },
  });
}

beforeEach(() => {
  resetUsernameState();
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

afterEach(() => {
  cleanup();
  resetUsernameState();
});

describe('SettingsPage dash link', () => {
  it('hides the dash link without a cached claim and shows it with one', async () => {
    renderPage();
    expect(screen.queryByRole('link', { name: 'EVM dash · gas' })).toBeNull();

    usernameState.update((state) => ({ ...state, cached: cachedClaim, status: 'ready' }));
    await tick();
    expect(screen.getByRole('link', { name: 'EVM dash · gas' })).toBeTruthy();
  });

  it('moves the current section off the dash link when the cached claim clears', async () => {
    usernameState.update((state) => ({ ...state, cached: cachedClaim, status: 'ready' }));
    renderPage();

    const main = document.querySelector('.settings-main') as HTMLElement;
    Object.defineProperty(main, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(main, 'clientHeight', { configurable: true, value: 400 });
    Object.defineProperty(main, 'scrollTop', { configurable: true, value: 0 });
    main.getBoundingClientRect = () => rect(0);
    document.getElementById('settings-profile')!.getBoundingClientRect = () => rect(500);
    document.getElementById('settings-evm-dash-gas')!.getBoundingClientRect = () => rect(10);

    await fireEvent.scroll(main);
    expect(screen.getByRole('link', { name: 'EVM dash · gas' }).getAttribute('aria-current')).toBe(
      'location',
    );

    usernameState.update((state) => ({ ...state, cached: null }));
    await tick();
    expect(screen.queryByRole('link', { name: 'EVM dash · gas' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Profile' }).getAttribute('aria-current')).toBe(
      'location',
    );
  });
});
