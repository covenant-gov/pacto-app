import type { PlatformFeatures, WhisperModelStatus } from '../api/voice';

/**
 * - `unsupported`: this build has no Whisper; hide every transcription control.
 * - `no-model`: supported, but no model is on disk yet; settings offer a download.
 * - `ready`: a model is on disk; voice messages can be transcribed.
 */
export type TranscriptionAvailability = 'unsupported' | 'no-model' | 'ready';

/** The preferred model when it is downloaded, else the first (smallest) downloaded one. */
export function resolveTranscriptionModel(
  preferred: string | null,
  models: readonly WhisperModelStatus[],
): string | null {
  const downloaded = models.filter((m) => m.downloaded);
  if (preferred && downloaded.some((m) => m.model.name === preferred)) return preferred;
  return downloaded[0]?.model.name ?? null;
}

export function transcriptionAvailability(
  features: Pick<PlatformFeatures, 'transcription'> | null,
  preferredModel: string | null,
  models: readonly WhisperModelStatus[],
): TranscriptionAvailability {
  if (!features?.transcription) return 'unsupported';
  return resolveTranscriptionModel(preferredModel, models) ? 'ready' : 'no-model';
}

/** Auto-transcribe only local clips that have no transcript or attempt yet. */
export function shouldAutoTranscribe(input: {
  availability: TranscriptionAvailability;
  autoTranscribe: boolean;
  onDisk: boolean;
  hasTranscriptEntry: boolean;
}): boolean {
  return (
    input.availability === 'ready' && input.autoTranscribe && input.onDisk && !input.hasTranscriptEntry
  );
}
