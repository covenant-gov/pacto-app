import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import {
  stripTrackingMarkersEnabled,
  loadStripTrackingMarkersPreference,
  STRIP_TRACKING_MARKERS_PREFIX,
} from './strip-tracking-markers';
import { setCurrentNpubForPersistence } from './persistence-context';
import { clearAccountState } from '../lib/utils/clear-account-state';

beforeEach(() => {
  const storage: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key in storage ? storage[key] : null),
    setItem: (key: string, value: string) => {
      storage[key] = value;
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
  });
  setCurrentNpubForPersistence(null);
  stripTrackingMarkersEnabled.set(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setCurrentNpubForPersistence(null);
  stripTrackingMarkersEnabled.set(true);
});

const NPUB = 'npub1test';
const OTHER = 'npub1other';

function expectedKey(npub: string = NPUB): string {
  return `${STRIP_TRACKING_MARKERS_PREFIX}_${npub}`;
}

describe('stripTrackingMarkersEnabled', () => {
  it('defaults to true when no stored value exists', () => {
    loadStripTrackingMarkersPreference(NPUB);
    expect(get(stripTrackingMarkersEnabled)).toBe(true);
  });

  it('writes false only under the current npub', async () => {
    loadStripTrackingMarkersPreference(NPUB);
    stripTrackingMarkersEnabled.set(false);
    await Promise.resolve();
    expect(localStorage.getItem(expectedKey())).toBe('false');
    expect(localStorage.getItem(expectedKey(OTHER))).toBeNull();
  });

  it('restores false for that npub and true for an npub with no key', async () => {
    loadStripTrackingMarkersPreference(NPUB);
    stripTrackingMarkersEnabled.set(false);
    await Promise.resolve();

    loadStripTrackingMarkersPreference(NPUB);
    expect(get(stripTrackingMarkersEnabled)).toBe(false);

    loadStripTrackingMarkersPreference(OTHER);
    expect(get(stripTrackingMarkersEnabled)).toBe(true);
  });

  it('treats null, a string, a number, and truncated JSON as true', () => {
    for (const raw of ['null', '"false"', '0', '{']) {
      localStorage.setItem(expectedKey(), raw);
      loadStripTrackingMarkersPreference(NPUB);
      expect(get(stripTrackingMarkersEnabled)).toBe(true);
    }
  });

  it('does not write when no persistence context is set', async () => {
    setCurrentNpubForPersistence(null);
    stripTrackingMarkersEnabled.set(false);
    await Promise.resolve();
    expect(localStorage.getItem(expectedKey())).toBeNull();
  });

  it('keeps the stored value across logout and restores it on the next load', async () => {
    loadStripTrackingMarkersPreference(NPUB);
    stripTrackingMarkersEnabled.set(false);
    await Promise.resolve();

    clearAccountState(NPUB);

    expect(localStorage.getItem(expectedKey())).toBe('false');
    expect(get(stripTrackingMarkersEnabled)).toBe(true);

    loadStripTrackingMarkersPreference(NPUB);
    expect(get(stripTrackingMarkersEnabled)).toBe(false);
  });
});
