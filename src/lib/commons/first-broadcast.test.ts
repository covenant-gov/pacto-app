import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { hasEverBroadcast, markHasEverBroadcast, PACTO_COMMONS_BROADCASTED_PREFIX } from './first-broadcast';

const localStorageStore = new Map<string, string>();

function stubLocalStorage(): void {
  localStorageStore.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => localStorageStore.get(k) ?? null,
    setItem: (k: string, v: string) => {
      localStorageStore.set(k, v);
    },
    removeItem: (k: string) => {
      localStorageStore.delete(k);
    },
    clear: () => {
      localStorageStore.clear();
    },
  });
}

describe('first-broadcast localStorage tracking', () => {
  beforeEach(() => {
    stubLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns false when no marker has been stored', () => {
    expect(hasEverBroadcast('npub1test')).toBe(false);
  });

  it('returns true after markHasEverBroadcast', () => {
    markHasEverBroadcast('npub1test');
    expect(localStorage.getItem(`${PACTO_COMMONS_BROADCASTED_PREFIX}_npub1test`)).toBe('1');
    expect(hasEverBroadcast('npub1test')).toBe(true);
  });

  it('returns false for an empty npub', () => {
    markHasEverBroadcast('npub1test');
    expect(hasEverBroadcast('')).toBe(false);
  });

  it('does not throw when marking an empty npub', () => {
    expect(() => markHasEverBroadcast('')).not.toThrow();
  });

  it('is idempotent', () => {
    markHasEverBroadcast('npub1test');
    markHasEverBroadcast('npub1test');
    expect(hasEverBroadcast('npub1test')).toBe(true);
  });

  it('returns false when localStorage is undefined', () => {
    vi.unstubAllGlobals();
    expect(hasEverBroadcast('npub1test')).toBe(false);
  });

  it('does not throw when localStorage is undefined', () => {
    vi.unstubAllGlobals();
    expect(() => markHasEverBroadcast('npub1test')).not.toThrow();
  });

  it('returns false when localStorage.getItem throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    });
    expect(hasEverBroadcast('npub1test')).toBe(false);
  });

  it('does not throw when localStorage.setItem throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
      clear: () => {},
    });
    expect(() => markHasEverBroadcast('npub1test')).not.toThrow();
  });
});
