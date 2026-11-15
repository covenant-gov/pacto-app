import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  isSettingsSectionCollapsed,
  setSettingsSectionCollapsed,
  settingsSectionCollapsed,
} from './settings-section-collapse';

describe('settings-section-collapse', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
    settingsSectionCollapsed.set({});
  });

  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    vi.restoreAllMocks();
  });

  it('defaults sections to expanded', () => {
    expect(isSettingsSectionCollapsed('settings-nostr')).toBe(false);
    expect(isSettingsSectionCollapsed('settings-backup')).toBe(false);
    expect(isSettingsSectionCollapsed('settings-evm', get(settingsSectionCollapsed))).toBe(false);
  });

  it('persists collapsed state globally', () => {
    setSettingsSectionCollapsed('settings-nostr', true);
    expect(get(settingsSectionCollapsed)['settings-nostr']).toBe(true);
    expect(isSettingsSectionCollapsed('settings-nostr', get(settingsSectionCollapsed))).toBe(true);

    const raw = store.get('pacto_settings_section_collapsed_v1');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { v: number; sections: Record<string, boolean> };
    expect(parsed.v).toBe(1);
    expect(parsed.sections['settings-nostr']).toBe(true);
  });

  it('persists expanded state after collapse', () => {
    setSettingsSectionCollapsed('settings-app', true);
    setSettingsSectionCollapsed('settings-app', false);
    expect(isSettingsSectionCollapsed('settings-app', get(settingsSectionCollapsed))).toBe(false);
  });
});
