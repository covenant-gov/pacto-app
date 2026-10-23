import type { Attachment } from '../../stores/dm';

/** Native recorder output: 22 kHz mono 16-bit PCM WAV (see `src-tauri/src/voice.rs`). */
export const VOICE_SAMPLE_RATE = 22_000;
const VOICE_BYTES_PER_SECOND = VOICE_SAMPLE_RATE * 2;
const WAV_HEADER_BYTES = 44;
/** AES-GCM tag appended to every encrypted attachment blob. */
const ATTACHMENT_CIPHER_OVERHEAD_BYTES = 16;

/**
 * Voice messages are WAV attachments sent without a file name — the shape
 * `voice_message` produces. A user-picked `.wav` file keeps its name and
 * renders as a regular audio attachment.
 */
export function isVoiceMessageAttachment(attachment: Pick<Attachment, 'extension' | 'file_name'>): boolean {
  const hasName = typeof attachment.file_name === 'string' && attachment.file_name.length > 0;
  return attachment.extension.toLowerCase() === 'wav' && !hasName;
}

/** `m:ss` (or `h:mm:ss`) for a duration in seconds; invalid input renders as `0:00`. */
export function formatVoiceDuration(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

/**
 * Duration estimate from the encrypted download size, so an undownloaded
 * voice message can show its length. Exact for clips from the native recorder;
 * the player replaces it with the real duration once the audio loads.
 */
export function estimateVoiceDurationFromSize(encryptedBytes: number): number {
  if (!Number.isFinite(encryptedBytes) || encryptedBytes <= 0) return 0;
  const pcm = encryptedBytes - ATTACHMENT_CIPHER_OVERHEAD_BYTES - WAV_HEADER_BYTES;
  return pcm > 0 ? pcm / VOICE_BYTES_PER_SECOND : 0;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

/** Duration in seconds of a PCM WAV buffer, or `null` when it is not a readable WAV. */
export function wavDurationSeconds(bytes: Uint8Array): number | null {
  if (bytes.byteLength < WAV_HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') return null;

  let byteRate = 0;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ' && body + 12 <= bytes.byteLength) {
      byteRate = view.getUint32(body + 8, true);
    } else if (id === 'data') {
      if (byteRate <= 0) return null;
      const dataBytes = Math.min(size, bytes.byteLength - body);
      return dataBytes / byteRate;
    }
    // Chunks are word-aligned.
    offset = body + size + (size % 2);
  }
  return null;
}

export interface TranscriptionSection {
  text: string;
  /** Offset in ms from the start of the clip. */
  at: number;
}

/** Joins Whisper segments into one readable paragraph. */
export function joinTranscriptSections(sections: readonly TranscriptionSection[]): string {
  return sections
    .map((s) => s.text.trim())
    .filter((s) => s.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
