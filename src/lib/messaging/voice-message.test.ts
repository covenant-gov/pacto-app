import { describe, it, expect } from 'vitest';
import {
  estimateVoiceDurationFromSize,
  formatVoiceDuration,
  isVoiceMessageAttachment,
  joinTranscriptSections,
  wavDurationSeconds,
  VOICE_SAMPLE_RATE,
} from './voice-message';

function wav(seconds: number, opts: { sampleRate?: number; extraChunk?: boolean } = {}): Uint8Array {
  const sampleRate = opts.sampleRate ?? VOICE_SAMPLE_RATE;
  const dataBytes = Math.round(seconds * sampleRate) * 2;
  const extra = opts.extraChunk ? 8 + 3 + 1 : 0; // odd-sized chunk plus pad byte
  const buf = new ArrayBuffer(44 + extra + dataBytes);
  const view = new DataView(buf);
  const ascii = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + extra + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  let o = 36;
  if (opts.extraChunk) {
    ascii(o, 'LIST');
    view.setUint32(o + 4, 3, true);
    o += 12;
  }
  ascii(o, 'data');
  view.setUint32(o + 4, dataBytes, true);
  return new Uint8Array(buf);
}

describe('formatVoiceDuration', () => {
  it.each([
    [0, '0:00'],
    [0.9, '0:00'],
    [5, '0:05'],
    [59.99, '0:59'],
    [60, '1:00'],
    [125, '2:05'],
    [3600, '1:00:00'],
    [3725, '1:02:05'],
  ])('formats %s seconds as %s', (input, expected) => {
    expect(formatVoiceDuration(input)).toBe(expected);
  });

  it.each([NaN, Infinity, -3])('renders invalid %s as 0:00', (input) => {
    expect(formatVoiceDuration(input)).toBe('0:00');
  });
});

describe('estimateVoiceDurationFromSize', () => {
  it('derives the length of a native recorder clip from its encrypted size', () => {
    const plain = wav(12).byteLength;
    expect(estimateVoiceDurationFromSize(plain + 16)).toBeCloseTo(12, 5);
  });

  it('returns 0 for empty or invalid sizes', () => {
    expect(estimateVoiceDurationFromSize(0)).toBe(0);
    expect(estimateVoiceDurationFromSize(30)).toBe(0);
    expect(estimateVoiceDurationFromSize(NaN)).toBe(0);
  });
});

describe('wavDurationSeconds', () => {
  it('reads the duration from the data chunk', () => {
    expect(wavDurationSeconds(wav(3))).toBeCloseTo(3, 5);
  });

  it('uses the byte rate from the fmt chunk', () => {
    expect(wavDurationSeconds(wav(2, { sampleRate: 48_000 }))).toBeCloseTo(2, 5);
  });

  it('skips unrelated chunks, honoring word alignment', () => {
    expect(wavDurationSeconds(wav(1.5, { extraChunk: true }))).toBeCloseTo(1.5, 5);
  });

  it('works on a view into a larger buffer', () => {
    const clip = wav(1);
    const padded = new Uint8Array(clip.byteLength + 10);
    padded.set(clip, 10);
    expect(wavDurationSeconds(padded.subarray(10))).toBeCloseTo(1, 5);
  });

  it('returns null for non-WAV data', () => {
    expect(wavDurationSeconds(new Uint8Array(10))).toBeNull();
    expect(wavDurationSeconds(new Uint8Array(64))).toBeNull();
  });
});

describe('isVoiceMessageAttachment', () => {
  it('treats unnamed WAV attachments as voice messages', () => {
    expect(isVoiceMessageAttachment({ extension: 'wav', file_name: null })).toBe(true);
    expect(isVoiceMessageAttachment({ extension: 'WAV' })).toBe(true);
    expect(isVoiceMessageAttachment({ extension: 'wav', file_name: '' })).toBe(true);
  });

  it('keeps named or non-WAV audio as regular attachments', () => {
    expect(isVoiceMessageAttachment({ extension: 'wav', file_name: 'interview.wav' })).toBe(false);
    expect(isVoiceMessageAttachment({ extension: 'mp3', file_name: null })).toBe(false);
  });
});

describe('joinTranscriptSections', () => {
  it('joins trimmed segments into one paragraph', () => {
    expect(
      joinTranscriptSections([
        { text: ' Hello', at: 0 },
        { text: '  there,  ', at: 400 },
        { text: '', at: 800 },
        { text: ' friend.', at: 900 },
      ]),
    ).toBe('Hello there, friend.');
  });

  it('returns an empty string when nothing was said', () => {
    expect(joinTranscriptSections([])).toBe('');
    expect(joinTranscriptSections([{ text: '   ', at: 0 }])).toBe('');
  });
});
