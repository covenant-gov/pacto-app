import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { platformFeatures, resetPlatformFeatures } from './platform-features';
import { resetVoiceSettings, updateVoiceSettings } from './voice-settings';
import {
  ensureWhisperModelsLoaded,
  requestTranscription,
  resetVoiceTranscription,
  transcriptionState,
  voiceTranscripts,
  whisperModels,
} from './voice-transcription';

const mockInvoke = vi.mocked(invoke);
const FEATURES = { transcription: true, notification_sounds: true, os: 'macos', is_mobile: false, debug_mode: false };
const MODELS = [
  { model: { name: 'tiny', display_name: 'Tiny', size: 75 }, downloaded: true },
  { model: { name: 'base', display_name: 'Base', size: 142 }, downloaded: false },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  mockInvoke.mockReset();
  resetPlatformFeatures();
  resetVoiceSettings();
  resetVoiceTranscription();
});

describe('transcriptionState', () => {
  it('stays unsupported and skips the model list on builds without Whisper', async () => {
    platformFeatures.set({ ...FEATURES, transcription: false });
    await ensureWhisperModelsLoaded();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(get(transcriptionState).availability).toBe('unsupported');
  });

  it('becomes ready once a downloaded model is listed', async () => {
    platformFeatures.set(FEATURES);
    mockInvoke.mockResolvedValueOnce(MODELS);
    await ensureWhisperModelsLoaded();
    expect(mockInvoke).toHaveBeenCalledWith('list_models');
    expect(get(transcriptionState)).toEqual({ availability: 'ready', model: 'tiny' });
  });

  it('retries the model list after a failed first read', async () => {
    platformFeatures.set(FEATURES);
    mockInvoke.mockRejectedValueOnce(new Error('busy'));
    await ensureWhisperModelsLoaded();
    expect(get(transcriptionState).availability).toBe('no-model');

    mockInvoke.mockResolvedValueOnce(MODELS);
    await ensureWhisperModelsLoaded();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(get(transcriptionState)).toEqual({ availability: 'ready', model: 'tiny' });

    await ensureWhisperModelsLoaded();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });
});

describe('requestTranscription', () => {
  beforeEach(() => {
    platformFeatures.set(FEATURES);
    whisperModels.set(MODELS);
  });

  it('does nothing when no model is ready', () => {
    whisperModels.set([]);
    requestTranscription('att1', '/tmp/a.wav');
    expect(get(voiceTranscripts)).toEqual({});
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('transcribes with the resolved model and GPU preference', async () => {
    updateVoiceSettings({ useGpu: false });
    mockInvoke.mockResolvedValueOnce({ sections: [{ text: ' Hola', at: 0 }, { text: ' amigo', at: 300 }], lang: 'ES' });
    requestTranscription('att1', '/tmp/a.wav');
    expect(get(voiceTranscripts).att1).toEqual({ status: 'pending' });
    await flush();
    expect(mockInvoke).toHaveBeenCalledWith('transcribe', {
      filePath: '/tmp/a.wav',
      modelName: 'tiny',
      translate: false,
      useGpu: false,
    });
    expect(get(voiceTranscripts).att1).toEqual({ status: 'done', text: 'Hola amigo', lang: 'ES' });
  });

  it('records failures so the UI can offer a retry', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('boom'));
    requestTranscription('att1', '/tmp/a.wav');
    await flush();
    expect(get(voiceTranscripts).att1).toEqual({ status: 'error' });
  });

  it('runs one transcription at a time and dedupes pending requests', async () => {
    const first = deferred<unknown>();
    mockInvoke.mockReturnValueOnce(first.promise as Promise<never>);
    mockInvoke.mockResolvedValueOnce({ sections: [], lang: 'GB' });

    requestTranscription('att1', '/tmp/a.wav');
    requestTranscription('att1', '/tmp/a.wav');
    requestTranscription('att2', '/tmp/b.wav');
    await flush();
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    first.resolve({ sections: [{ text: 'one', at: 0 }], lang: 'GB' });
    await flush();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(get(voiceTranscripts).att2).toEqual({ status: 'done', text: '', lang: 'GB' });
  });

  it('drops results that finish after an account reset', async () => {
    const pending = deferred<unknown>();
    mockInvoke.mockReturnValueOnce(pending.promise as Promise<never>);
    requestTranscription('att1', '/tmp/a.wav');
    await flush();
    resetVoiceTranscription();
    pending.resolve({ sections: [{ text: 'secret', at: 0 }], lang: 'GB' });
    await flush();
    expect(get(voiceTranscripts)).toEqual({});
  });
});
