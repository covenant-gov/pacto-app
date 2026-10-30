import { invoke } from './index';
import type { TranscriptionSection } from '../messaging/voice-message';

/** Backend: `cmds::app::get_platform_features`. */
export interface PlatformFeatures {
  /** Local Whisper transcription is compiled in (desktop builds with the `whisper` feature). */
  transcription: boolean;
  notification_sounds: boolean;
  os: string;
  is_mobile: boolean;
  debug_mode: boolean;
}

export interface WhisperModelInfo {
  /** Backend id, e.g. `tiny`, `large-v3`. */
  name: string;
  display_name: string;
  /** Approximate download size in MB. */
  size: number;
}

export interface WhisperModelStatus {
  model: WhisperModelInfo;
  downloaded: boolean;
}

export interface TranscriptionResult {
  sections: TranscriptionSection[];
  /** ISO country code for the detected language (e.g. `GB`, `ES`). */
  lang: string;
}

export async function getPlatformFeatures(): Promise<PlatformFeatures> {
  return await invoke<PlatformFeatures>('get_platform_features');
}

/** Opens the default microphone. Rejects when no input device is available or access is denied. */
export async function startRecording(): Promise<void> {
  await invoke('start_recording');
}

/** Stops the microphone and returns the clip as WAV bytes. */
export async function stopRecording(): Promise<Uint8Array> {
  const bytes = await invoke<number[] | Uint8Array>('stop_recording');
  return bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
}

/** Sends a recorded clip as a voice message. `receiver` is an npub (DM) or MLS group id (channel). */
export async function sendVoiceMessage(receiver: string, repliedTo: string, bytes: Uint8Array): Promise<boolean> {
  return await invoke<boolean>('voice_message', { receiver, repliedTo, bytes: Array.from(bytes) });
}

/** Transcribes a local audio file with the given Whisper model. */
export async function transcribeAudio(
  filePath: string,
  modelName: string,
  useGpu: boolean,
): Promise<TranscriptionResult> {
  return await invoke<TranscriptionResult>('transcribe', {
    filePath,
    modelName,
    translate: false,
    useGpu,
  });
}

export async function listWhisperModels(): Promise<WhisperModelStatus[]> {
  return await invoke<WhisperModelStatus[]>('list_models');
}

/** Downloads (or returns the cached path of) a Whisper model. Progress arrives as `whisper_download_progress`. */
export async function downloadWhisperModel(modelName: string): Promise<string> {
  return await invoke<string>('download_whisper_model', { modelName });
}

export async function deleteWhisperModel(modelName: string): Promise<boolean> {
  return await invoke<boolean>('delete_whisper_model', { modelName });
}
