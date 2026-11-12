import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { setCurrentNpubForPersistence } from './persistence-context';
import {
  clearMlsHistoryWelcome,
  loadMlsHistoryWelcome,
  markMlsHistoryWelcome,
  mlsHistoryWelcomeAcceptedAt,
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
    markMlsHistoryWelcome('G-OPS', 1_700_000_000_000);
    markMlsHistoryWelcome('g-ops', 1_800_000_000_000);
    markMlsHistoryWelcome('  G-OPS  ');
    expect(get(mlsHistoryWelcomeGroupIds)).toEqual(['g-ops']);
    expect(get(mlsHistoryWelcomeAcceptedAt)['g-ops']).toBe(1_700_000_000_000);
    expect(shouldShowMlsHistoryWelcome('G-OPS')).toBe(true);
    expect(shouldShowMlsHistoryWelcome('other')).toBe(false);
    expect(shouldShowMlsHistoryWelcome('')).toBe(false);
  });

  it('persists accept times and ignores a v1 id list', () => {
    markMlsHistoryWelcome('ann-1', 10);
    markMlsHistoryWelcome('chan-2', 20);
    const key = `${MLS_HISTORY_WELCOME_PREFIX}_npub1test`;
    expect(JSON.parse(localStorage.getItem(key) ?? '{}')).toEqual({ 'ann-1': 10, 'chan-2': 20 });
    localStorage.setItem('mls_history_welcome_v1_npub1test', JSON.stringify(['old-group']));

    setCurrentNpubForPersistence(null);
    clearMlsHistoryWelcome();
    expect(JSON.parse(localStorage.getItem(key) ?? '{}')).toEqual({ 'ann-1': 10, 'chan-2': 20 });
    expect(shouldShowMlsHistoryWelcome('ann-1')).toBe(false);

    setCurrentNpubForPersistence('npub1test');
    loadMlsHistoryWelcome('npub1test');
    expect(get(mlsHistoryWelcomeGroupIds)).toEqual(['ann-1', 'chan-2']);
    expect(shouldShowMlsHistoryWelcome('ANN-1')).toBe(true);

    localStorage.setItem(key, JSON.stringify(['v1-shaped']));
    loadMlsHistoryWelcome('npub1test');
    expect(get(mlsHistoryWelcomeGroupIds)).toEqual([]);
  });
});
