import { writable } from 'svelte/store';
import { persistenceKey, setCurrentNpubForPersistence } from './persistence-context';

export const VOICE_SETTINGS_PREFIX = 'pacto_voice_settings_v1';

export interface VoiceSettings {
  /** Preferred Whisper model id; `null` uses the smallest downloaded model. */
  model: string | null;
  /** Transcribe voice messages as soon as they are on disk. */
  autoTranscribe: boolean;
  /** Run Whisper on the GPU; off forces CPU for drivers that crash or misbehave. */
  useGpu: boolean;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  model: null,
  autoTranscribe: false,
  useGpu: true,
};

export const voiceSettings = writable<VoiceSettings>({ ...DEFAULT_VOICE_SETTINGS });

/** Parses a stored value, falling back field-by-field to defaults. */
export function parseVoiceSettings(raw: string | null): VoiceSettings {
  if (raw === null) return { ...DEFAULT_VOICE_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof VoiceSettings, unknown>> | null;
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_VOICE_SETTINGS };
    return {
      model: typeof parsed.model === 'string' && parsed.model.length > 0 ? parsed.model : null,
      autoTranscribe:
        typeof parsed.autoTranscribe === 'boolean' ? parsed.autoTranscribe : DEFAULT_VOICE_SETTINGS.autoTranscribe,
      useGpu: typeof parsed.useGpu === 'boolean' ? parsed.useGpu : DEFAULT_VOICE_SETTINGS.useGpu,
    };
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

export function loadVoiceSettings(npub: string): void {
  setCurrentNpubForPersistence(npub);
  const key = persistenceKey(VOICE_SETTINGS_PREFIX);
  if (typeof localStorage === 'undefined' || !key) {
    voiceSettings.set({ ...DEFAULT_VOICE_SETTINGS });
    return;
  }
  try {
    voiceSettings.set(parseVoiceSettings(localStorage.getItem(key)));
  } catch {
    voiceSettings.set({ ...DEFAULT_VOICE_SETTINGS });
  }
}

export function updateVoiceSettings(patch: Partial<VoiceSettings>): void {
  voiceSettings.update((cur) => ({ ...cur, ...patch }));
}

export function resetVoiceSettings(): void {
  voiceSettings.set({ ...DEFAULT_VOICE_SETTINGS });
}

voiceSettings.subscribe((value) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(VOICE_SETTINGS_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
});
