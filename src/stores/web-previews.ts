import { writable } from 'svelte/store';
import { persistenceKey, setCurrentNpubForPersistence } from './persistence-context';

export const WEB_PREVIEWS_PREFIX = 'pacto_web_previews_enabled_v1';

/** Whether Pacto fetches and displays OpenGraph/link previews for URLs in messages. Default on, matching prior always-on behavior. */
export const webPreviewsEnabled = writable<boolean>(true);

function persistWebPreviewsEnabled(value: boolean): void {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(WEB_PREVIEWS_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function loadWebPreviewsPreference(npub: string): void {
  setCurrentNpubForPersistence(npub);
  if (typeof localStorage === 'undefined') {
    webPreviewsEnabled.set(true);
    return;
  }
  const key = persistenceKey(WEB_PREVIEWS_PREFIX);
  if (!key) {
    webPreviewsEnabled.set(true);
    return;
  }
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      webPreviewsEnabled.set(true);
      return;
    }
    // A stored preference exists but is corrupt/unreadable: fail closed rather than the sibling
    // pattern's fail-open, since re-enabling here means outbound requests to attacker-chosen
    // URLs embedded in incoming messages resume without any signal the preference was lost.
    try {
      const parsed = JSON.parse(raw);
      webPreviewsEnabled.set(typeof parsed === 'boolean' ? parsed : false);
    } catch {
      webPreviewsEnabled.set(false);
    }
  } catch {
    webPreviewsEnabled.set(true);
  }
}

webPreviewsEnabled.subscribe((value) => {
  persistWebPreviewsEnabled(value);
});
