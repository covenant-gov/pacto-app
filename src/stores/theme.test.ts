import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { theme, setTheme, getStoredTheme, THEME_OPTIONS, DEFAULT_THEME } from './theme';

describe('theme', () => {
  let storage: Map<string, string>;
  let documentAttribute: string | null;

  beforeEach(() => {
    storage = new Map();
    documentAttribute = null;
    theme.set(DEFAULT_THEME);

    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
      key: (i: number) => [...storage.keys()][i] ?? null,
      get length() {
        return storage.size;
      },
    } as Storage);

    vi.stubGlobal('document', {
      documentElement: {
        setAttribute: (_name: string, value: string) => {
          documentAttribute = value;
        },
        getAttribute: (_name: string) => documentAttribute,
      },
    });
  });

  afterEach(() => {
    theme.set(DEFAULT_THEME);
    vi.unstubAllGlobals();
  });

  it('starts at the default theme', () => {
    expect(get(theme)).toBe(DEFAULT_THEME);
    expect(THEME_OPTIONS.length).toBeGreaterThan(0);
  });

  it('stores and applies a valid theme', () => {
    setTheme('union');
    expect(get(theme)).toBe('union');
    expect(storage.get('pacto_theme')).toBe('union');
    expect(documentAttribute).toBe('union');
  });

  it('ignores invalid theme values', () => {
    setTheme('not-a-theme' as unknown as typeof DEFAULT_THEME);
    expect(get(theme)).toBe(DEFAULT_THEME);
    expect(storage.get('pacto_theme')).toBeUndefined();
    expect(documentAttribute).toBeNull();
  });

  it('reads a stored valid theme', () => {
    expect(getStoredTheme()).toBeNull();
    storage.set('pacto_theme', 'midnight');
    expect(getStoredTheme()).toBe('midnight');
  });

  it('returns null for missing or invalid stored themes', () => {
    storage.set('pacto_theme', 'invalid');
    expect(getStoredTheme()).toBeNull();
  });
});
