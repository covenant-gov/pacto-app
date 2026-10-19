import { writable } from 'svelte/store';
import { persistenceKey, setCurrentNpubForPersistence } from './persistence-context';

export const STRIP_TRACKING_MARKERS_PREFIX = 'pacto_strip_tracking_markers_v1';

/** Strip known tracking parameters from message URLs. Default on. */
export const stripTrackingMarkersEnabled = writable<boolean>(true);

function persistStripTrackingMarkersEnabled(value: boolean): void {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(STRIP_TRACKING_MARKERS_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function loadStripTrackingMarkersPreference(npub: string): void {
  setCurrentNpubForPersistence(npub);
  if (typeof localStorage === 'undefined') {
    stripTrackingMarkersEnabled.set(true);
    return;
  }
  const key = persistenceKey(STRIP_TRACKING_MARKERS_PREFIX);
  if (!key) {
    stripTrackingMarkersEnabled.set(true);
    return;
  }
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      stripTrackingMarkersEnabled.set(true);
      return;
    }
    const parsed = JSON.parse(raw);
    stripTrackingMarkersEnabled.set(typeof parsed === 'boolean' ? parsed : true);
  } catch {
    stripTrackingMarkersEnabled.set(true);
  }
}

stripTrackingMarkersEnabled.subscribe((value) => {
  persistStripTrackingMarkersEnabled(value);
});
