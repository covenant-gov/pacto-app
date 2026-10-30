import { derived, get, writable, type Readable } from 'svelte/store';
import { appConfig, type FeatureFlagDescriptor } from './app-config';
import { persistenceKey, setCurrentNpubForPersistence } from './persistence-context';

export const FEATURE_FLAG_OVERRIDES_PREFIX = 'pacto_feature_flag_overrides_v1';

/** User choices keyed by flag key. Flags without an entry use their registry default. */
export type FeatureFlagOverrides = Record<string, boolean>;

export interface ResolvedFeatureFlag extends FeatureFlagDescriptor {
  enabled: boolean;
}

export const featureFlagOverrides = writable<FeatureFlagOverrides>({});

/**
 * The single resolution rule for experimental features: a stored override wins, otherwise the
 * registry default. Keys missing from the registry resolve to off, and overrides for them are ignored.
 */
export function resolveFeatureFlag(
  key: string,
  registry: readonly FeatureFlagDescriptor[],
  overrides: FeatureFlagOverrides,
): boolean {
  const descriptor = registry.find((flag) => flag.key === key);
  if (!descriptor) return false;
  const override = Object.hasOwn(overrides, key) ? overrides[key] : undefined;
  return typeof override === 'boolean' ? override : descriptor.defaultEnabled;
}

/** Every registered flag with its effective state, in registry order. */
export const featureFlags: Readable<ResolvedFeatureFlag[]> = derived(
  [appConfig, featureFlagOverrides],
  ([$appConfig, $overrides]) =>
    $appConfig.featureFlags.map((flag) => ({
      ...flag,
      enabled: resolveFeatureFlag(flag.key, $appConfig.featureFlags, $overrides),
    })),
);

/** Reactive gate for experimental UI; updates as soon as the user toggles the flag. */
export function featureEnabled(key: string): Readable<boolean> {
  return derived([appConfig, featureFlagOverrides], ([$appConfig, $overrides]) =>
    resolveFeatureFlag(key, $appConfig.featureFlags, $overrides),
  );
}

/** Point-in-time gate for non-reactive code paths. */
export function isFeatureEnabled(key: string): boolean {
  return resolveFeatureFlag(key, get(appConfig).featureFlags, get(featureFlagOverrides));
}

/** Record the user's choice for `key` and persist it for the current account. */
export function setFeatureFlagEnabled(key: string, enabled: boolean): void {
  const next = { ...get(featureFlagOverrides), [key]: enabled };
  featureFlagOverrides.set(next);
  persistOverrides(next);
}

function persistOverrides(value: FeatureFlagOverrides): void {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(FEATURE_FLAG_OVERRIDES_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function parseOverrides(raw: string): FeatureFlagOverrides {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const out: FeatureFlagOverrides = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'boolean') out[key] = value;
  }
  return out;
}

/** Load this account's overrides. Unreadable storage falls back to registry defaults. */
export function loadFeatureFlagOverrides(npub: string): void {
  setCurrentNpubForPersistence(npub);
  const key = persistenceKey(FEATURE_FLAG_OVERRIDES_PREFIX);
  if (typeof localStorage === 'undefined' || !key) {
    featureFlagOverrides.set({});
    return;
  }
  try {
    const raw = localStorage.getItem(key);
    featureFlagOverrides.set(raw === null ? {} : parseOverrides(raw));
  } catch {
    featureFlagOverrides.set({});
  }
}
