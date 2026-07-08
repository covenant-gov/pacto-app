import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { copyTextToClipboard } from './clipboard-copy';

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: vi.fn(),
}));

describe('copyTextToClipboard', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the Tauri plugin when running inside the desktop shell', async () => {
    vi.mocked(writeText).mockResolvedValueOnce(undefined);
    vi.stubGlobal('window', { __TAURI__: {} });
    const result = await copyTextToClipboard('hello');
    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to navigator.clipboard when Tauri is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined);
    vi.stubGlobal('window', { __TAURI__: undefined });
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const result = await copyTextToClipboard('fallback');
    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledWith('fallback');
  });

  it('falls back to navigator.clipboard when the Tauri plugin fails', async () => {
    vi.mocked(writeText).mockRejectedValueOnce(new Error('denied'));
    const navWriteText = vi.fn().mockResolvedValueOnce(undefined);
    vi.stubGlobal('window', { __TAURI__: {} });
    vi.stubGlobal('navigator', { clipboard: { writeText: navWriteText } });
    const result = await copyTextToClipboard('fallback after tauri');
    expect(result).toBe(true);
    expect(navWriteText).toHaveBeenCalledWith('fallback after tauri');
  });

  it('returns false when navigator.clipboard is unavailable', async () => {
    vi.stubGlobal('window', { __TAURI__: undefined });
    vi.stubGlobal('navigator', { clipboard: undefined });
    const result = await copyTextToClipboard('no clipboard');
    expect(result).toBe(false);
  });

  it('returns false when navigator.clipboard.writeText throws', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied'));
    vi.stubGlobal('window', { __TAURI__: undefined });
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const result = await copyTextToClipboard('throws');
    expect(result).toBe(false);
  });
});
