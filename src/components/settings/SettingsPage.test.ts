// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRawSnippet, tick } from 'svelte';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import SettingsPage from './SettingsPage.svelte';

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
      '<div><div id="settings-nostr">Nostr body</div><div id="settings-backup">Backup body</div></div>',
  }));
}

function renderPage() {
  return render(SettingsPage, {
    props: { onBack: () => {}, children: pageChildren() },
  });
}

beforeEach(() => {
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
});

describe('SettingsPage sidebar', () => {
  it('lists infra and backup sections without profile or gas', async () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Nostr' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'EVM' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Backup' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Dangerzone' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Profile' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'EVM — gas' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Sponsored gas' })).toBeNull();
  });

  it('marks Backup as the current section when that block is in view', async () => {
    renderPage();

    const main = document.querySelector('.settings-main') as HTMLElement;
    Object.defineProperty(main, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(main, 'clientHeight', { configurable: true, value: 400 });
    Object.defineProperty(main, 'scrollTop', { configurable: true, value: 0 });
    main.getBoundingClientRect = () => rect(0);
    document.getElementById('settings-nostr')!.getBoundingClientRect = () => rect(500);
    document.getElementById('settings-backup')!.getBoundingClientRect = () => rect(10);

    await fireEvent.scroll(main);
    await tick();
    expect(screen.getByRole('link', { name: 'Backup' }).getAttribute('aria-current')).toBe(
      'location',
    );
  });
});
