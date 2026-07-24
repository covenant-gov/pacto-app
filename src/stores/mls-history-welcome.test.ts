import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { setCurrentNpubForPersistence } from './persistence-context';
import {
  loadMlsHistoryWelcome,
  markMlsHistoryWelcome,
  mlsHistoryWelcomeGroupIds,
  resetMlsHistoryWelcomeForTests,
  shouldShowMlsHistoryWelcome,
  MLS_HISTORY_WELCOME_PREFIX,
} from './mls-history-welcome';

describe('mls-history-welcome', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
      removeItem: (k: string) => {
        storage.delete(k);
      },
      clear: () => storage.clear(),
      key: (i: number) => [...storage.keys()][i] ?? null,
      get length() {
        return storage.size;
      },
    } as Storage);
    setCurrentNpubForPersistence('npub1test');
    resetMlsHistoryWelcomeForTests();
  });

  afterEach(() => {
    resetMlsHistoryWelcomeForTests();
    setCurrentNpubForPersistence(null);
    vi.unstubAllGlobals();
  });

  it('mark is idempotent and case-normalizes', () => {
    markMlsHistoryWelcome('G-OPS');
    markMlsHistoryWelcome('g-ops');
    markMlsHistoryWelcome('  G-OPS  ');
    expect(get(mlsHistoryWelcomeGroupIds)).toEqual(['g-ops']);
    expect(shouldShowMlsHistoryWelcome('G-OPS')).toBe(true);
    expect(shouldShowMlsHistoryWelcome('other')).toBe(false);
    expect(shouldShowMlsHistoryWelcome('')).toBe(false);
  });

  it('persists and reloads for npub', () => {
    markMlsHistoryWelcome('ann-1');
    markMlsHistoryWelcome('chan-2');
    const key = `${MLS_HISTORY_WELCOME_PREFIX}_npub1test`;
    expect(JSON.parse(localStorage.getItem(key) ?? '[]')).toEqual(['ann-1', 'chan-2']);

    // Clear in-memory only (no npub → subscribe must not wipe localStorage).
    setCurrentNpubForPersistence(null);
    mlsHistoryWelcomeGroupIds.set([]);
    expect(shouldShowMlsHistoryWelcome('ann-1')).toBe(false);

    setCurrentNpubForPersistence('npub1test');
    loadMlsHistoryWelcome('npub1test');
    expect(get(mlsHistoryWelcomeGroupIds)).toEqual(['ann-1', 'chan-2']);
    expect(shouldShowMlsHistoryWelcome('ANN-1')).toBe(true);
  });
});
