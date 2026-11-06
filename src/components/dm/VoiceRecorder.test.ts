// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import VoiceRecorder from './VoiceRecorder.svelte';
import { startRecording, stopRecording } from '../../lib/api/voice';
import { VOICE_SAMPLE_RATE } from '../../lib/messaging/voice-message';

vi.mock('../../lib/api/voice', () => ({
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
}));

const mockedStart = vi.mocked(startRecording);
const mockedStop = vi.mocked(stopRecording);

/** Mono 16-bit PCM WAV of the given length. */
function wav(seconds: number): Uint8Array {
  const dataBytes = Math.round(seconds * VOICE_SAMPLE_RATE) * 2;
  const view = new DataView(new ArrayBuffer(44 + dataBytes));
  const ascii = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, VOICE_SAMPLE_RATE, true);
  view.setUint32(28, VOICE_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return new Uint8Array(view.buffer);
}

let now = 1_000_000;
const play = vi.fn(() => Promise.resolve());
const revoke = vi.fn();

beforeEach(() => {
  now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  mockedStart.mockReset().mockResolvedValue(undefined);
  mockedStop.mockReset().mockResolvedValue(wav(2));
  play.mockClear();
  revoke.mockClear();
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = revoke;
  HTMLMediaElement.prototype.play = play;
  HTMLMediaElement.prototype.pause = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mic = () => screen.getByLabelText('Record voice message');

async function holdMic() {
  await fireEvent.pointerDown(mic(), { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
  await waitFor(() => expect(mockedStart).toHaveBeenCalled());
  await Promise.resolve();
}

/** Keyboard activation records hands-free, then stops into the preview. */
async function recordIntoPreview() {
  await fireEvent.click(mic(), { detail: 0 });
  await waitFor(() => screen.getByLabelText('Stop and review'));
  now += 2_000;
  await fireEvent.click(screen.getByLabelText('Stop and review'));
  await waitFor(() => screen.getByText('Voice message'));
}

describe('VoiceRecorder', () => {
  it('sends a held clip to the conversation it was recorded in', async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    render(VoiceRecorder, { props: { target: 'chat-a', onSend } });
    await holdMic();
    now += 2_000;
    await fireEvent.pointerUp(mic(), { pointerId: 1 });
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][1]).toBe('chat-a');
  });

  it('discards a held recording when the conversation changes mid-hold', async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    const { rerender } = render(VoiceRecorder, { props: { target: 'chat-a', onSend } });
    await holdMic();
    await waitFor(() => screen.getByText('Slide to cancel', { exact: false }));

    await rerender({ target: 'chat-b', onSend });
    await waitFor(() => expect(mockedStop).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('group')).toBeNull());

    now += 2_000;
    await fireEvent.pointerUp(mic(), { pointerId: 1 });
    await Promise.resolve();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('discards a preview when the conversation changes', async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    const { rerender } = render(VoiceRecorder, { props: { target: 'chat-a', onSend } });
    await recordIntoPreview();

    await rerender({ target: 'chat-b', onSend });
    await waitFor(() => expect(screen.queryByLabelText('Send voice message')).toBeNull());
    expect(revoke).toHaveBeenCalledWith('blob:preview');
    expect(onSend).not.toHaveBeenCalled();
    expect(mic()).toBeTruthy();
  });

  it('keeps a playable preview after a failed hold-and-release send, then retries', async () => {
    const onSend = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(VoiceRecorder, { props: { target: 'chat-a', onSend } });
    await holdMic();
    now += 2_000;
    await fireEvent.pointerUp(mic(), { pointerId: 1 });
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));

    const playBtn = await waitFor(() => {
      const btn = screen.getByLabelText('Play recording') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
      return btn;
    });
    expect(screen.getByText('0:02')).toBeTruthy();
    await fireEvent.click(playBtn);
    expect(play).toHaveBeenCalled();

    await fireEvent.click(screen.getByLabelText('Send voice message'));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
    expect(onSend.mock.calls[1]).toEqual([onSend.mock.calls[0][0], 'chat-a']);
    await waitFor(() => expect(screen.queryByLabelText('Send voice message')).toBeNull());
  });
});
