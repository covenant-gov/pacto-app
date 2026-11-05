import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import {
  startupCheckEnabled,
  loadStartupCheckPreference,
  markStartupCheckRun,
  resetStartupCheckSession,
  getHasRunStartupCheckThisSession,
  STARTUP_CHECK_PREFIX,
  STARTUP_CHECK_PREFIX_V1,
} from './startup-check';
import { setCurrentNpubForPersistence } from './persistence-context';
import { clearAccountState } from '../lib/utils/clear-account-state';

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
  startupCheckEnabled.set(true);
  resetStartupCheckSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  setCurrentNpubForPersistence(null);
  startupCheckEnabled.set(true);
  resetStartupCheckSession();
});

const NPUB = 'npub1test';
const OTHER = 'npub1other';

function expectedKey(npub: string = NPUB): string {
  return `${STARTUP_CHECK_PREFIX}_${npub}`;
}

describe('startupCheckEnabled', () => {
  it('defaults to true when no persisted value exists', () => {
    loadStartupCheckPreference(NPUB);
    expect(get(startupCheckEnabled)).toBe(true);
  });

  it('ignores a stale v1 false and still defaults to true', () => {
    localStorage.setItem(`${STARTUP_CHECK_PREFIX_V1}_${NPUB}`, JSON.stringify(false));
    loadStartupCheckPreference(NPUB);
    expect(get(startupCheckEnabled)).toBe(true);
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

  it('treats null, a string, a number, and truncated JSON as true', () => {
    for (const raw of ['null', '"false"', '0', '{']) {
      localStorage.setItem(expectedKey(), raw);
      loadStartupCheckPreference(NPUB);
      expect(get(startupCheckEnabled)).toBe(true);
    }
  });

  it('persists false per npub when the user opts out', async () => {
    loadStartupCheckPreference(NPUB);
    startupCheckEnabled.set(false);
    await Promise.resolve();
    expect(localStorage.getItem(expectedKey())).toBe('false');
    expect(localStorage.getItem(expectedKey(OTHER))).toBeNull();
  });

  it('restores false for that npub and true for an npub with no key', async () => {
    loadStartupCheckPreference(NPUB);
    startupCheckEnabled.set(false);
    await Promise.resolve();

    loadStartupCheckPreference(NPUB);
    expect(get(startupCheckEnabled)).toBe(false);

    loadStartupCheckPreference(OTHER);
    expect(get(startupCheckEnabled)).toBe(true);
  });

  it('scopes storage to the current npub', async () => {
    loadStartupCheckPreference(NPUB);
    startupCheckEnabled.set(false);
    await Promise.resolve();
    loadStartupCheckPreference(OTHER);
    startupCheckEnabled.set(true);
    await Promise.resolve();
    expect(localStorage.getItem(expectedKey(NPUB))).toBe('false');
    expect(localStorage.getItem(expectedKey(OTHER))).toBe('true');
  });

  it('does not write when no persistence context is set', async () => {
    const isolatedStorage: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem(key: string): string | null { return isolatedStorage[key] ?? null; },
      setItem(key: string, value: string): void { isolatedStorage[key] = value; },
      removeItem(key: string): void { delete isolatedStorage[key]; },
    });
    setCurrentNpubForPersistence(null);
    startupCheckEnabled.set(false);
    await Promise.resolve();
    expect(Object.keys(isolatedStorage)).toHaveLength(0);
  });

  it('clears v1 and v2 keys on logout and restores an explicit opt-out on next load', async () => {
    localStorage.setItem(`${STARTUP_CHECK_PREFIX_V1}_${NPUB}`, JSON.stringify(false));
    loadStartupCheckPreference(NPUB);
    startupCheckEnabled.set(false);
    await Promise.resolve();

    clearAccountState(NPUB);

    expect(localStorage.getItem(expectedKey())).toBeNull();
    expect(localStorage.getItem(`${STARTUP_CHECK_PREFIX_V1}_${NPUB}`)).toBeNull();
    expect(get(startupCheckEnabled)).toBe(true);

    localStorage.setItem(expectedKey(), JSON.stringify(false));
    loadStartupCheckPreference(NPUB);
    expect(get(startupCheckEnabled)).toBe(false);
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
