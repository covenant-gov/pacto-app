import { writable } from 'svelte/store';
import { getPlatformFeatures, type PlatformFeatures } from '../lib/api/voice';

/** Backend capability flags; `null` until loaded or when the backend is unreachable. */
export const platformFeatures = writable<PlatformFeatures | null>(null);

let inflight: Promise<PlatformFeatures | null> | null = null;

/** Loads the flags once per app session. Never rejects; failures leave the store `null`. */
export function ensurePlatformFeatures(): Promise<PlatformFeatures | null> {
  if (!inflight) {
    inflight = getPlatformFeatures()
      .then((features) => {
        platformFeatures.set(features);
        return features;
      })
      .catch(() => {
        inflight = null;
        return null;
      });
  }
  return inflight;
}

/** Test hook: forget the cached load. */
export function resetPlatformFeatures(): void {
  inflight = null;
  platformFeatures.set(null);
}
