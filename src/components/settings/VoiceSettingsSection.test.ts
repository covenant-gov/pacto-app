// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { get } from 'svelte/store';
import VoiceSettingsSection from './VoiceSettingsSection.svelte';
import { deleteWhisperModel, downloadWhisperModel, getPlatformFeatures, listWhisperModels } from '../../lib/api/voice';
import { resetPlatformFeatures } from '../../stores/platform-features';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import { resetVoiceSettings, updateVoiceSettings, voiceSettings } from '../../stores/voice-settings';
import { resetVoiceTranscription } from '../../stores/voice-transcription';

vi.mock('../../lib/api/voice', () => ({
  getPlatformFeatures: vi.fn(),
  listWhisperModels: vi.fn(),
  downloadWhisperModel: vi.fn(),
  deleteWhisperModel: vi.fn(),
}));

const FEATURES = { transcription: true, notification_sounds: true, os: 'macos', is_mobile: false, debug_mode: false };
const tiny = (downloaded: boolean) => ({ model: { name: 'tiny', display_name: 'Tiny', size: 75 }, downloaded });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetPlatformFeatures();
  resetVoiceTranscription();
  setCurrentNpubForPersistence('npub1alice');
  resetVoiceSettings();
  vi.mocked(getPlatformFeatures).mockResolvedValue(FEATURES);
});

afterEach(() => {
  cleanup();
  setCurrentNpubForPersistence(null);
});

describe('VoiceSettingsSection', () => {
  it('keeps the selection and shows an error when a delete fails', async () => {
    vi.mocked(listWhisperModels).mockResolvedValue([tiny(true)]);
    vi.mocked(deleteWhisperModel).mockResolvedValue(false);
    updateVoiceSettings({ model: 'tiny' });
    render(VoiceSettingsSection);

    await fireEvent.click(await screen.findByText('Delete'));

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', "Couldn't delete the model");
    expect(get(voiceSettings).model).toBe('tiny');
  });

  it('does not select a downloaded model for an account that signed in mid-download', async () => {
    vi.mocked(listWhisperModels).mockResolvedValueOnce([tiny(false)]).mockResolvedValue([tiny(true)]);
    const download = deferred<string>();
    vi.mocked(downloadWhisperModel).mockReturnValue(download.promise);
    render(VoiceSettingsSection);

    await fireEvent.click(await screen.findByText('Download'));
    setCurrentNpubForPersistence('npub1bob');
    resetVoiceSettings();
    download.resolve('/models/ggml-tiny.bin');

    await waitFor(() => expect(listWhisperModels).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Delete')).not.toBeNull());
    expect(get(voiceSettings).model).toBeNull();
  });

  it('selects the first downloaded model for the same account', async () => {
    vi.mocked(listWhisperModels).mockResolvedValueOnce([tiny(false)]).mockResolvedValue([tiny(true)]);
    vi.mocked(downloadWhisperModel).mockResolvedValue('/models/ggml-tiny.bin');
    render(VoiceSettingsSection);

    await fireEvent.click(await screen.findByText('Download'));

    await waitFor(() => expect(get(voiceSettings).model).toBe('tiny'));
  });
});
