import { derived, get, writable } from 'svelte/store';
import { listWhisperModels, transcribeAudio, type WhisperModelStatus } from '../lib/api/voice';
import { joinTranscriptSections } from '../lib/messaging/voice-message';
import {
  resolveTranscriptionModel,
  transcriptionAvailability,
} from '../lib/messaging/voice-transcription';
import { platformFeatures } from './platform-features';
import { voiceSettings } from './voice-settings';

/** Whisper models and whether each is on disk; empty until first refresh. */
export const whisperModels = writable<WhisperModelStatus[]>([]);

/** Download percentage by model id while a download is in flight. */
export const whisperDownloadProgress = writable<Record<string, number>>({});

export const transcriptionState = derived(
  [platformFeatures, voiceSettings, whisperModels],
  ([$features, $settings, $models]) => ({
    availability: transcriptionAvailability($features, $settings.model, $models),
    model: resolveTranscriptionModel($settings.model, $models),
  }),
);

export type VoiceTranscript =
  | { status: 'pending' }
  | { status: 'done'; text: string; lang: string }
  | { status: 'error' };

/**
 * Transcripts by attachment id. In memory only: transcripts are message
 * content, and localStorage is not encrypted.
 */
export const voiceTranscripts = writable<Record<string, VoiceTranscript>>({});

let modelsRefresh: Promise<void> | null = null;

/** Re-reads model download state. Concurrent callers share one request. */
export function refreshWhisperModels(): Promise<void> {
  if (!get(platformFeatures)?.transcription) return Promise.resolve();
  if (!modelsRefresh) {
    modelsRefresh = listWhisperModels()
      .then((models) => whisperModels.set(models))
      .catch(() => {})
      .finally(() => {
        modelsRefresh = null;
      });
  }
  return modelsRefresh;
}

let modelsLoaded = false;

/** First read of model state for this session; later reads go through `refreshWhisperModels`. */
export function ensureWhisperModelsLoaded(): Promise<void> {
  if (modelsLoaded || !get(platformFeatures)?.transcription) return Promise.resolve();
  modelsLoaded = true;
  return refreshWhisperModels();
}

export function setWhisperDownloadProgress(model: string, progress: number): void {
  whisperDownloadProgress.update((cur) => ({ ...cur, [model]: Math.max(0, Math.min(100, progress)) }));
}

export function clearWhisperDownloadProgress(model: string): void {
  whisperDownloadProgress.update((cur) => {
    const next = { ...cur };
    delete next[model];
    return next;
  });
}

function setTranscript(attachmentId: string, value: VoiceTranscript): void {
  voiceTranscripts.update((cur) => ({ ...cur, [attachmentId]: value }));
}

// Whisper loads the whole model per run; one at a time keeps memory bounded.
let queue: Promise<void> = Promise.resolve();
// Bumped on account reset so in-flight results never land in the next session.
let generation = 0;

/**
 * Queues a transcription of a local audio file. No-ops while one is pending
 * for the same attachment or when no model is ready.
 */
export function requestTranscription(attachmentId: string, filePath: string): void {
  const existing = get(voiceTranscripts)[attachmentId];
  if (existing?.status === 'pending') return;
  const { availability, model } = get(transcriptionState);
  if (availability !== 'ready' || !model) return;
  const { useGpu } = get(voiceSettings);

  const queuedIn = generation;
  setTranscript(attachmentId, { status: 'pending' });
  queue = queue.then(async () => {
    if (queuedIn !== generation) return;
    let value: VoiceTranscript;
    try {
      const result = await transcribeAudio(filePath, model, useGpu);
      value = { status: 'done', text: joinTranscriptSections(result.sections), lang: result.lang };
    } catch {
      value = { status: 'error' };
    }
    if (queuedIn === generation) setTranscript(attachmentId, value);
  });
}

export function resetVoiceTranscription(): void {
  generation++;
  modelsLoaded = false;
  voiceTranscripts.set({});
  whisperModels.set([]);
  whisperDownloadProgress.set({});
}
