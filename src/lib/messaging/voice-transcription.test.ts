import { describe, it, expect } from 'vitest';
import type { WhisperModelStatus } from '../api/voice';
import {
  resolveTranscriptionModel,
  shouldAutoTranscribe,
  transcriptionAvailability,
} from './voice-transcription';

function model(name: string, downloaded: boolean): WhisperModelStatus {
  return { model: { name, display_name: name, size: 1 }, downloaded };
}

const NONE = [model('tiny', false), model('base', false), model('small', false)];
const BASE_AND_SMALL = [model('tiny', false), model('base', true), model('small', true)];

describe('transcriptionAvailability', () => {
  it('is unsupported when the build has no Whisper', () => {
    expect(transcriptionAvailability({ transcription: false }, null, BASE_AND_SMALL)).toBe('unsupported');
  });

  it('is unsupported until platform features load', () => {
    expect(transcriptionAvailability(null, null, BASE_AND_SMALL)).toBe('unsupported');
  });

  it('needs a model when none is downloaded', () => {
    expect(transcriptionAvailability({ transcription: true }, null, NONE)).toBe('no-model');
    expect(transcriptionAvailability({ transcription: true }, 'tiny', [])).toBe('no-model');
  });

  it('is ready once any model is downloaded', () => {
    expect(transcriptionAvailability({ transcription: true }, null, BASE_AND_SMALL)).toBe('ready');
    expect(transcriptionAvailability({ transcription: true }, 'tiny', BASE_AND_SMALL)).toBe('ready');
  });
});

describe('resolveTranscriptionModel', () => {
  it('uses the preferred model when downloaded', () => {
    expect(resolveTranscriptionModel('small', BASE_AND_SMALL)).toBe('small');
  });

  it('falls back to the first downloaded model', () => {
    expect(resolveTranscriptionModel(null, BASE_AND_SMALL)).toBe('base');
    expect(resolveTranscriptionModel('tiny', BASE_AND_SMALL)).toBe('base');
  });

  it('returns null when nothing is downloaded', () => {
    expect(resolveTranscriptionModel('tiny', NONE)).toBeNull();
  });
});

describe('shouldAutoTranscribe', () => {
  const base = { availability: 'ready' as const, autoTranscribe: true, onDisk: true, hasTranscriptEntry: false };

  it('runs for a local clip with auto-transcribe on and no prior attempt', () => {
    expect(shouldAutoTranscribe(base)).toBe(true);
  });

  it.each([
    ['setting off', { autoTranscribe: false }],
    ['clip not downloaded', { onDisk: false }],
    ['already transcribed or attempted', { hasTranscriptEntry: true }],
    ['no model', { availability: 'no-model' as const }],
    ['unsupported build', { availability: 'unsupported' as const }],
  ])('skips when %s', (_label, patch) => {
    expect(shouldAutoTranscribe({ ...base, ...patch })).toBe(false);
  });
});
