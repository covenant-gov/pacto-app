import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import {
  startupCheckEnabled,
  loadStartupCheckPreference,
  markStartupCheckRun,
  resetStartupCheckSession,
  getHasRunStartupCheckThisSession,
  STARTUP_CHECK_PREFIX,
} from './startup-check';
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
  startupCheckEnabled.set(false);
  resetStartupCheckSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  setCurrentNpubForPersistence(null);
  startupCheckEnabled.set(false);
  resetStartupCheckSession();
});

const NPUB = 'npub1test';

function expectedKey(npub: string = NPUB): string {
  return `${STARTUP_CHECK_PREFIX}_${npub}`;
}

describe('startupCheckEnabled', () => {
  it('defaults to false when no persisted value exists', () => {
    loadStartupCheckPreference(NPUB);
    expect(get(startupCheckEnabled)).toBe(false);
  });

  it('reads true from localStorage when previously enabled', () => {
    localStorage.setItem(expectedKey(), JSON.stringify(true));
    loadStartupCheckPreference(NPUB);
    expect(get(startupCheckEnabled)).toBe(true);
  });

  it('reads false from localStorage when previously disabled', () => {
    localStorage.setItem(expectedKey(), JSON.stringify(false));
    loadStartupCheckPreference(NPUB);
    expect(get(startupCheckEnabled)).toBe(false);
  });

  it('treats corrupt values as false', () => {
    localStorage.setItem(expectedKey(), 'not-json');
    loadStartupCheckPreference(NPUB);
    expect(get(startupCheckEnabled)).toBe(false);
  });

  it('persists true per npub', async () => {
    loadStartupCheckPreference(NPUB);
    startupCheckEnabled.set(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(localStorage.getItem(expectedKey())).toBe('true');
  });

  it('persists false per npub when toggled off from true', async () => {
    loadStartupCheckPreference(NPUB);
    startupCheckEnabled.set(true);
    await new Promise((r) => setTimeout(r, 10));
    startupCheckEnabled.set(false);
    await new Promise((r) => setTimeout(r, 10));
    expect(localStorage.getItem(expectedKey())).toBe('false');
  });

  it('scopes storage to the current npub', async () => {
    loadStartupCheckPreference(NPUB);
    startupCheckEnabled.set(true);
    await new Promise((r) => setTimeout(r, 10));
    const otherNpub = 'npub1other';
    loadStartupCheckPreference(otherNpub);
    startupCheckEnabled.set(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(localStorage.getItem(expectedKey(NPUB))).toBe('true');
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
    startupCheckEnabled.set(true);
    expect(Object.keys(isolatedStorage)).toHaveLength(0);
  });
});

describe('session guard', () => {
  it('starts false at import time', () => {
    expect(getHasRunStartupCheckThisSession()).toBe(false);
  });

  it('becomes true after markStartupCheckRun', () => {
    markStartupCheckRun();
    expect(getHasRunStartupCheckThisSession()).toBe(true);
  });

  it('resets only via resetStartupCheckSession', () => {
    markStartupCheckRun();
    resetStartupCheckSession();
    expect(getHasRunStartupCheckThisSession()).toBe(false);
  });
});
