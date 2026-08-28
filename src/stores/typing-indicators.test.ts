import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import {
  sendTypingIndicatorsEnabled,
  loadSendTypingIndicatorsPreference,
  TYPING_INDICATORS_PREFIX,
} from './typing-indicators';
import { setCurrentNpubForPersistence } from './persistence-context';

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
  sendTypingIndicatorsEnabled.set(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setCurrentNpubForPersistence(null);
  sendTypingIndicatorsEnabled.set(true);
});

const NPUB = 'npub1test';

function expectedKey(npub: string = NPUB): string {
  return `${TYPING_INDICATORS_PREFIX}_${npub}`;
}

describe('sendTypingIndicatorsEnabled', () => {
  it('defaults to true when no persisted value exists', () => {
    loadSendTypingIndicatorsPreference(NPUB);
    expect(get(sendTypingIndicatorsEnabled)).toBe(true);
  });

  it('reads false from localStorage when previously disabled', () => {
    localStorage.setItem(expectedKey(), JSON.stringify(false));
    loadSendTypingIndicatorsPreference(NPUB);
    expect(get(sendTypingIndicatorsEnabled)).toBe(false);
  });

  it('reads true from localStorage when previously enabled', () => {
    localStorage.setItem(expectedKey(), JSON.stringify(true));
    loadSendTypingIndicatorsPreference(NPUB);
    expect(get(sendTypingIndicatorsEnabled)).toBe(true);
  });

  it('treats corrupt values as true', () => {
    localStorage.setItem(expectedKey(), 'not-json');
    loadSendTypingIndicatorsPreference(NPUB);
    expect(get(sendTypingIndicatorsEnabled)).toBe(true);
  });

  it('persists false per npub', async () => {
    loadSendTypingIndicatorsPreference(NPUB);
    sendTypingIndicatorsEnabled.set(false);
    await Promise.resolve();
    expect(localStorage.getItem(expectedKey())).toBe('false');
  });

  it('persists true per npub when toggled on from false', async () => {
    localStorage.setItem(expectedKey(), JSON.stringify(false));
    loadSendTypingIndicatorsPreference(NPUB);
    expect(get(sendTypingIndicatorsEnabled)).toBe(false);
    sendTypingIndicatorsEnabled.set(true);
    await Promise.resolve();
    expect(localStorage.getItem(expectedKey())).toBe('true');
  });

  it('scopes storage to the current npub', async () => {
    loadSendTypingIndicatorsPreference('npub1first');
    sendTypingIndicatorsEnabled.set(false);
    await Promise.resolve();

    loadSendTypingIndicatorsPreference('npub1second');
    sendTypingIndicatorsEnabled.set(true);
    await Promise.resolve();

    expect(localStorage.getItem(expectedKey('npub1first'))).toBe('false');
    expect(localStorage.getItem(expectedKey('npub1second'))).toBe('true');
  });

  it('does not write when no persistence context is set', async () => {
    setCurrentNpubForPersistence(null);
    sendTypingIndicatorsEnabled.set(false);
    await Promise.resolve();
    expect(localStorage.getItem(expectedKey())).toBeNull();
  });
});
