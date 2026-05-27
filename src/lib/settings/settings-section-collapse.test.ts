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

  it('defaults sections to collapsed', () => {
    expect(isSettingsSectionCollapsed('settings-profile')).toBe(true);
    expect(isSettingsSectionCollapsed('settings-evm', get(settingsSectionCollapsed))).toBe(true);
  });

  it('persists expanded state globally', () => {
    setSettingsSectionCollapsed('settings-nostr', false);
    expect(get(settingsSectionCollapsed)['settings-nostr']).toBe(false);
    expect(isSettingsSectionCollapsed('settings-nostr', get(settingsSectionCollapsed))).toBe(false);

    const raw = store.get('pacto_settings_section_collapsed_v1');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { v: number; sections: Record<string, boolean> };
    expect(parsed.v).toBe(1);
    expect(parsed.sections['settings-nostr']).toBe(false);
  });

  it('persists collapsed state after expand', () => {
    setSettingsSectionCollapsed('settings-app', false);
    setSettingsSectionCollapsed('settings-app', true);
    expect(isSettingsSectionCollapsed('settings-app', get(settingsSectionCollapsed))).toBe(true);
  });
});
