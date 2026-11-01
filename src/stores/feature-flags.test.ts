import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { appConfig, DEFAULT_APP_CONFIG } from './app-config';
import {
  FEATURE_FLAG_OVERRIDES_PREFIX,
  featureEnabled,
  featureFlagOverrides,
  featureFlags,
  isFeatureEnabled,
  loadFeatureFlagOverrides,
  resolveFeatureFlag,
  setFeatureFlagEnabled,
} from './feature-flags';
import { setCurrentNpubForPersistence } from './persistence-context';

const NPUB = 'npub1test';
const REGISTRY = [
  { key: 'off_by_default', defaultEnabled: false },
  { key: 'on_by_default', defaultEnabled: true },
];

let storage: Record<string, string>;

function storageKey(npub: string = NPUB): string {
  return `${FEATURE_FLAG_OVERRIDES_PREFIX}_${npub}`;
}

beforeEach(() => {
  storage = {};
  vi.stubGlobal('localStorage', {
    getItem: (key: string): string | null => storage[key] ?? null,
    setItem: (key: string, value: string): void => {
      storage[key] = value;
    },
    removeItem: (key: string): void => {
      delete storage[key];
    },
  });
  setCurrentNpubForPersistence(null);
  featureFlagOverrides.set({});
  appConfig.set({ ...DEFAULT_APP_CONFIG, featureFlags: REGISTRY });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setCurrentNpubForPersistence(null);
  featureFlagOverrides.set({});
  appConfig.set(DEFAULT_APP_CONFIG);
});

describe('resolveFeatureFlag', () => {
  it('uses the registry default when there is no override', () => {
    expect(resolveFeatureFlag('off_by_default', REGISTRY, {})).toBe(false);
    expect(resolveFeatureFlag('on_by_default', REGISTRY, {})).toBe(true);
  });

  it('lets an override win in either direction', () => {
    expect(resolveFeatureFlag('off_by_default', REGISTRY, { off_by_default: true })).toBe(true);
    expect(resolveFeatureFlag('on_by_default', REGISTRY, { on_by_default: false })).toBe(false);
  });

  it('resolves unregistered keys to off, even with a stale override', () => {
    expect(resolveFeatureFlag('retired_flag', REGISTRY, {})).toBe(false);
    expect(resolveFeatureFlag('retired_flag', REGISTRY, { retired_flag: true })).toBe(false);
  });

  it('ignores inherited object properties', () => {
    expect(resolveFeatureFlag('toString', [{ key: 'toString', defaultEnabled: true }], {})).toBe(true);
  });
});

describe('feature flag stores', () => {
  it('lists every registered flag with its effective state', () => {
    featureFlagOverrides.set({ off_by_default: true, retired_flag: true });
    expect(get(featureFlags)).toEqual([
      { key: 'off_by_default', defaultEnabled: false, enabled: true },
      { key: 'on_by_default', defaultEnabled: true, enabled: true },
    ]);
  });

  it('is empty when the backend registry is unavailable', () => {
    appConfig.set(DEFAULT_APP_CONFIG);
    expect(get(featureFlags)).toEqual([]);
    expect(isFeatureEnabled('on_by_default')).toBe(false);
  });

  it('applies a toggle to reactive and point-in-time gates immediately', () => {
    const gate = featureEnabled('off_by_default');
    const seen: boolean[] = [];
    const unsubscribe = gate.subscribe((value) => seen.push(value));

    setFeatureFlagEnabled('off_by_default', true);

    expect(seen).toEqual([false, true]);
    expect(isFeatureEnabled('off_by_default')).toBe(true);
    unsubscribe();
  });
});

describe('feature flag persistence', () => {
  it('persists toggles under the npub-scoped key and restores them on load', () => {
    loadFeatureFlagOverrides(NPUB);
    setFeatureFlagEnabled('off_by_default', true);
    expect(JSON.parse(storage[storageKey()])).toEqual({ off_by_default: true });

    featureFlagOverrides.set({});
    loadFeatureFlagOverrides(NPUB);
    expect(isFeatureEnabled('off_by_default')).toBe(true);
  });

  it('keeps accounts isolated', () => {
    loadFeatureFlagOverrides(NPUB);
    setFeatureFlagEnabled('off_by_default', true);

    loadFeatureFlagOverrides('npub1other');
    expect(get(featureFlagOverrides)).toEqual({});
    expect(isFeatureEnabled('off_by_default')).toBe(false);
  });

  it('does not write anything while no account is active', () => {
    setFeatureFlagEnabled('off_by_default', true);
    expect(storage).toEqual({});
  });

  it('falls back to registry defaults for corrupt storage', () => {
    storage[storageKey()] = 'not-json';
    loadFeatureFlagOverrides(NPUB);
    expect(get(featureFlagOverrides)).toEqual({});
    expect(isFeatureEnabled('on_by_default')).toBe(true);
  });

  it('drops non-boolean values from stored overrides', () => {
    storage[storageKey()] = JSON.stringify({ off_by_default: 'yes', on_by_default: false });
    loadFeatureFlagOverrides(NPUB);
    expect(get(featureFlagOverrides)).toEqual({ on_by_default: false });
  });

  it('ignores a stored value that is not an object', () => {
    storage[storageKey()] = JSON.stringify([true]);
    loadFeatureFlagOverrides(NPUB);
    expect(get(featureFlagOverrides)).toEqual({});
  });
});
