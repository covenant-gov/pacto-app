import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { get } from 'svelte/store';

const windowApi = vi.hoisted(() => ({
  setBackgroundColor: vi.fn(async () => {}),
  setTheme: vi.fn(async () => {}),
  onResized: vi.fn(async () => () => {}),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => windowApi,
}));

import {
  theme,
  setTheme,
  getStoredTheme,
  THEME_OPTIONS,
  DEFAULT_THEME,
  DEFAULT_WINDOW_BG,
  DARK_THEME_IDS,
  isDarkTheme,
  readElevatedBackground,
  syncWindowChrome,
} from './theme';

describe('theme', () => {
  let storage: Map<string, string>;
  let documentAttribute: string | null;
  let elevatedToken: string;

  beforeEach(() => {
    storage = new Map();
    documentAttribute = null;
    elevatedToken = '';
    theme.set(DEFAULT_THEME);
    windowApi.setBackgroundColor.mockClear();
    windowApi.setTheme.mockClear();
    windowApi.onResized.mockClear();

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

    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (name: string) => (name === '--bg-elevated' ? elevatedToken : ''),
    }));
  });

  afterEach(() => {
    theme.set(DEFAULT_THEME);
    vi.unstubAllGlobals();
  });

  it('starts at the default theme', () => {
    expect(get(theme)).toBe(DEFAULT_THEME);
    expect(THEME_OPTIONS.length).toBeGreaterThan(0);
  });

  it('lists the five known theme ids', () => {
    expect(THEME_OPTIONS.map((o) => o.value).sort()).toEqual(
      ['aztec', 'dark-techno', 'midnight', 'techno', 'union'].sort(),
    );
  });

  it('maps paired light/dark skins to settings.theme.* label keys', () => {
    expect(THEME_OPTIONS.find((o) => o.value === 'techno')?.labelKey).toBe('settings.theme.techno');
    expect(THEME_OPTIONS.find((o) => o.value === 'dark-techno')?.labelKey).toBe(
      'settings.theme.darkTechno',
    );
  });

  it('stores and applies a valid theme', () => {
    setTheme('union');
    expect(get(theme)).toBe('union');
    expect(storage.get('pacto_theme')).toBe('union');
    expect(documentAttribute).toBe('union');
  });

  it('marks the expected themes as dark', () => {
    expect([...DARK_THEME_IDS].sort()).toEqual(
      ['aztec', 'dark-techno', 'midnight', 'union'].sort(),
    );
    expect(isDarkTheme('techno')).toBe(false);
    expect(isDarkTheme('dark-techno')).toBe(true);
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

  it('reads --bg-elevated for window chrome, falling back to the default', () => {
    expect(readElevatedBackground()).toBe(DEFAULT_WINDOW_BG);
    elevatedToken = '  #152238  ';
    expect(readElevatedBackground()).toBe('#152238');
  });

  it('skips window chrome sync outside Tauri', async () => {
    await syncWindowChrome('dark-techno');
    expect(windowApi.setBackgroundColor).not.toHaveBeenCalled();
    expect(windowApi.setTheme).not.toHaveBeenCalled();
  });

  it('syncs window background and theme under Tauri', async () => {
    vi.stubGlobal('window', { __TAURI__: {} });
    elevatedToken = '#152238';

    await syncWindowChrome('union');
    expect(windowApi.setBackgroundColor).toHaveBeenCalledWith('#152238');
    expect(windowApi.setTheme).toHaveBeenCalledWith('dark');

    await syncWindowChrome('techno');
    expect(windowApi.setTheme).toHaveBeenCalledWith('light');
  });
});

describe('startup window background', () => {
  const read = (path: string) => readFileSync(path, 'utf8');

  it('matches the default skin --bg-elevated in config, html shell, and theme module', () => {
    const css = read(`src/styles/themes/${DEFAULT_THEME}.css`);
    const token = css.match(/--bg-elevated:\s*(#[0-9a-fA-F]{6})/)?.[1];
    expect(token?.toLowerCase()).toBe(DEFAULT_WINDOW_BG);

    const conf = JSON.parse(read('src-tauri/tauri.conf.json')) as {
      app: { windows: { backgroundColor?: string }[] };
    };
    expect(conf.app.windows[0].backgroundColor?.toLowerCase()).toBe(DEFAULT_WINDOW_BG);

    const html = read('src/app.html');
    expect(html).toContain(`html, body { background-color: ${DEFAULT_WINDOW_BG}; }`);
  });
});
