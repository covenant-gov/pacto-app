import { writable } from 'svelte/store';
import { persistenceKey, setCurrentNpubForPersistence } from './persistence-context';

export const TYPING_INDICATORS_PREFIX = 'pacto_send_typing_indicators_v1';

/** Whether we notify contacts that we're typing. Default on, matching legacy always-on behavior. */
export const sendTypingIndicatorsEnabled = writable<boolean>(true);

function persistSendTypingIndicatorsEnabled(value: boolean): void {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(TYPING_INDICATORS_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function loadSendTypingIndicatorsPreference(npub: string): void {
  setCurrentNpubForPersistence(npub);
  if (typeof localStorage === 'undefined') {
    sendTypingIndicatorsEnabled.set(true);
    return;
  }
  const key = persistenceKey(TYPING_INDICATORS_PREFIX);
  if (!key) {
    sendTypingIndicatorsEnabled.set(true);
    return;
  }
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      sendTypingIndicatorsEnabled.set(true);
      return;
    }
    const parsed = JSON.parse(raw);
    sendTypingIndicatorsEnabled.set(typeof parsed === 'boolean' ? parsed : true);
  } catch {
    sendTypingIndicatorsEnabled.set(true);
  }
}

sendTypingIndicatorsEnabled.subscribe((value) => {
  persistSendTypingIndicatorsEnabled(value);
});
