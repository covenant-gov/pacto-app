import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import {
  DEFAULT_VOICE_SETTINGS,
  VOICE_SETTINGS_PREFIX,
  loadVoiceSettings,
  parseVoiceSettings,
  resetVoiceSettings,
  updateVoiceSettings,
  voiceSettings,
} from './voice-settings';
import { setCurrentNpubForPersistence } from './persistence-context';

const NPUB = 'npub1voice';
let storage: Record<string, string>;

beforeEach(() => {
  storage = {};
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => {
      storage[key] = value;
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
  });
  setCurrentNpubForPersistence(null);
  resetVoiceSettings();
});

afterEach(() => {
  vi.unstubAllGlobals();
  setCurrentNpubForPersistence(null);
  resetVoiceSettings();
});

describe('parseVoiceSettings', () => {
  it('defaults when nothing is stored or the value is corrupt', () => {
    expect(parseVoiceSettings(null)).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(parseVoiceSettings('not-json')).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(parseVoiceSettings('null')).toEqual(DEFAULT_VOICE_SETTINGS);
  });

  it('keeps valid fields and defaults the rest', () => {
    expect(parseVoiceSettings(JSON.stringify({ model: 'base', autoTranscribe: 'yes', useGpu: false }))).toEqual({
      model: 'base',
      autoTranscribe: false,
      useGpu: false,
    });
    expect(parseVoiceSettings(JSON.stringify({ model: '' }))).toEqual(DEFAULT_VOICE_SETTINGS);
  });
});

describe('voiceSettings persistence', () => {
  it('loads the stored value for the account', () => {
    storage[`${VOICE_SETTINGS_PREFIX}_${NPUB}`] = JSON.stringify({ model: 'small', autoTranscribe: true, useGpu: true });
    loadVoiceSettings(NPUB);
    expect(get(voiceSettings)).toEqual({ model: 'small', autoTranscribe: true, useGpu: true });
  });

  it('persists updates under the npub-scoped key', () => {
    loadVoiceSettings(NPUB);
    updateVoiceSettings({ autoTranscribe: true });
    expect(JSON.parse(storage[`${VOICE_SETTINGS_PREFIX}_${NPUB}`])).toEqual({
      ...DEFAULT_VOICE_SETTINGS,
      autoTranscribe: true,
    });
  });

  it('does not persist without an active account', () => {
    updateVoiceSettings({ useGpu: false });
    expect(Object.keys(storage)).toHaveLength(0);
  });

  it('keeps accounts isolated', () => {
    loadVoiceSettings(NPUB);
    updateVoiceSettings({ model: 'medium' });
    loadVoiceSettings('npub1other');
    expect(get(voiceSettings)).toEqual(DEFAULT_VOICE_SETTINGS);
  });
});
