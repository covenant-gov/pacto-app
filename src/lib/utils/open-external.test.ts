import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { openExternalUrl } from './open-external';

let openUrlSpy: Mock<(href: string) => Promise<void>>;

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn((href: string) => openUrlSpy(href)),
}));

describe('openExternalUrl', () => {
  let windowOpenSpy: Mock<typeof window.open>;

  beforeEach(() => {
    openUrlSpy = vi.fn().mockResolvedValue(undefined);
    windowOpenSpy = vi.fn().mockReturnValue(null);
    vi.stubGlobal('window', {
      __TAURI__: undefined,
      open: windowOpenSpy,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('ignores non-http(s) hrefs even with leading/trailing whitespace', async () => {
    await openExternalUrl('  ftp://example.com  ');
    expect(openUrlSpy).not.toHaveBeenCalled();
    expect(windowOpenSpy).not.toHaveBeenCalled();
  });

  it('opens https URL in new browser tab when not in Tauri', async () => {
    await openExternalUrl('https://example.com');
    expect(windowOpenSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
    expect(openUrlSpy).not.toHaveBeenCalled();
  });

  it('uses Tauri opener when inside Tauri', async () => {
    vi.stubGlobal('window', { __TAURI__: {}, open: windowOpenSpy });
    await openExternalUrl('https://example.com');
    expect(openUrlSpy).toHaveBeenCalledWith('https://example.com');
    expect(windowOpenSpy).not.toHaveBeenCalled();
  });

  it('falls back to window.open on Tauri opener failure', async () => {
    openUrlSpy = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('window', { __TAURI__: {}, open: windowOpenSpy });
    await openExternalUrl('https://example.com');
    expect(windowOpenSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
  });

  it('trims input for scheme validation but opens the original href', async () => {
    await openExternalUrl('  https://example.com  ');
    expect(windowOpenSpy).toHaveBeenCalledWith('  https://example.com  ', '_blank', 'noopener,noreferrer');
  });
});
