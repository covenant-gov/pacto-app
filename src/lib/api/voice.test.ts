import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import {
  deleteWhisperModel,
  downloadWhisperModel,
  sendVoiceMessage,
  startRecording,
  stopRecording,
} from './voice';
import { sendVoiceClip } from '../messaging/voice-send';

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('voice API wrappers', () => {
  it('starts recording with no arguments', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await startRecording();
    expect(mockInvoke).toHaveBeenCalledWith('start_recording');
  });

  it('normalizes recorded bytes to a Uint8Array', async () => {
    mockInvoke.mockResolvedValueOnce([82, 73, 70, 70]);
    const bytes = await stopRecording();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual([82, 73, 70, 70]);
  });

  it('sends clips as a plain byte array with camelCase args', async () => {
    mockInvoke.mockResolvedValueOnce(true);
    await sendVoiceMessage('npub1peer', 'reply-id', new Uint8Array([1, 2, 3]));
    expect(mockInvoke).toHaveBeenCalledWith('voice_message', {
      receiver: 'npub1peer',
      repliedTo: 'reply-id',
      bytes: [1, 2, 3],
    });
  });

  it('passes the model name for downloads and deletes', async () => {
    mockInvoke.mockResolvedValue('/models/ggml-tiny.bin');
    await downloadWhisperModel('tiny');
    expect(mockInvoke).toHaveBeenCalledWith('download_whisper_model', { modelName: 'tiny' });
    mockInvoke.mockResolvedValue(true);
    await deleteWhisperModel('tiny');
    expect(mockInvoke).toHaveBeenCalledWith('delete_whisper_model', { modelName: 'tiny' });
  });
});

describe('sendVoiceClip', () => {
  it('resolves true on success without reporting an error', async () => {
    mockInvoke.mockResolvedValueOnce(true);
    const onError = vi.fn();
    expect(await sendVoiceClip('group-id', new Uint8Array([1]), '', onError)).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports and resolves false instead of throwing', async () => {
    mockInvoke.mockRejectedValueOnce('relay offline');
    const onError = vi.fn();
    expect(await sendVoiceClip('group-id', new Uint8Array([1]), '', onError)).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(typeof onError.mock.calls[0][0]).toBe('string');
  });
});
