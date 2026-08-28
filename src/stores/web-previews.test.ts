import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import {
  webPreviewsEnabled,
  loadWebPreviewsPreference,
  WEB_PREVIEWS_PREFIX,
} from './web-previews';
import { setCurrentNpubForPersistence } from './persistence-context';

beforeEach(() => {
  const storage: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem(key: string): string | null {
      return storage[key] ?? null;
    },
    setItem(key: string, value: string): void {
      storage[key] = value;
    },
    removeItem(key: string): void {
      delete storage[key];
    },
  });
  setCurrentNpubForPersistence(null);
  webPreviewsEnabled.set(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setCurrentNpubForPersistence(null);
  webPreviewsEnabled.set(true);
});

const NPUB = 'npub1test';

function expectedKey(npub: string = NPUB): string {
  return `${WEB_PREVIEWS_PREFIX}_${npub}`;
}

describe('webPreviewsEnabled', () => {
  it('defaults to true when no persisted value exists, matching prior always-on behavior', () => {
    loadWebPreviewsPreference(NPUB);
    expect(get(webPreviewsEnabled)).toBe(true);
  });

  it('reads false from localStorage when previously disabled', () => {
    localStorage.setItem(expectedKey(), JSON.stringify(false));
    loadWebPreviewsPreference(NPUB);
    expect(get(webPreviewsEnabled)).toBe(false);
  });

  it('reads true from localStorage when previously enabled', () => {
    localStorage.setItem(expectedKey(), JSON.stringify(true));
    loadWebPreviewsPreference(NPUB);
    expect(get(webPreviewsEnabled)).toBe(true);
  });

  it('fails closed (false) when a stored preference exists but is corrupt JSON', () => {
    localStorage.setItem(expectedKey(), 'not-json');
    loadWebPreviewsPreference(NPUB);
    expect(get(webPreviewsEnabled)).toBe(false);
  });

  it('fails closed (false) when a stored preference is valid JSON but not a boolean', () => {
    localStorage.setItem(expectedKey(), JSON.stringify('yes'));
    loadWebPreviewsPreference(NPUB);
    expect(get(webPreviewsEnabled)).toBe(false);
  });

  it('defaults to true (not fail-closed) when localStorage access itself throws, distinct from a corrupt stored value', () => {
    vi.stubGlobal('localStorage', {
      getItem(): string {
        throw new Error('blocked');
      },
      setItem(): void {},
      removeItem(): void {},
    });
    loadWebPreviewsPreference(NPUB);
    expect(get(webPreviewsEnabled)).toBe(true);
  });

  it('persists false per npub when toggled off', () => {
    loadWebPreviewsPreference(NPUB);
    webPreviewsEnabled.set(false);
    expect(localStorage.getItem(expectedKey())).toBe('false');
  });

  it('persists true per npub when toggled back on', () => {
    loadWebPreviewsPreference(NPUB);
    webPreviewsEnabled.set(false);
    webPreviewsEnabled.set(true);
    expect(localStorage.getItem(expectedKey())).toBe('true');
  });

  it('scopes storage to the current npub, without leaking one account\'s value into a fresh one', () => {
    loadWebPreviewsPreference(NPUB);
    webPreviewsEnabled.set(false);

    const otherNpub = 'npub1other';
    loadWebPreviewsPreference(otherNpub);
    // A fresh account with no stored preference must reset to the default, not inherit NPUB's false.
    expect(get(webPreviewsEnabled)).toBe(true);
    webPreviewsEnabled.set(true);

    expect(localStorage.getItem(expectedKey(NPUB))).toBe('false');
    expect(localStorage.getItem(expectedKey(otherNpub))).toBe('true');
  });

  it('does not write when no persistence context is set', () => {
    const isolatedStorage: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem(key: string): string | null { return isolatedStorage[key] ?? null; },
      setItem(key: string, value: string): void { isolatedStorage[key] = value; },
      removeItem(key: string): void { delete isolatedStorage[key]; },
    });
    setCurrentNpubForPersistence(null);
    webPreviewsEnabled.set(false);
    expect(Object.keys(isolatedStorage)).toHaveLength(0);
  });
});
