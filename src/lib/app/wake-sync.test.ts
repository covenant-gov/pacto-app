import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installWakeSyncHandlers, requestCatchUp } from './wake-sync';
import { fetchMessages } from '../api/nostr';
import { dmSyncStatus } from '../../stores/dm';

vi.mock('../api/nostr', () => ({
  fetchMessages: vi.fn(),
}));

describe('wake-sync', () => {
  let focusHandler: (() => void) | null = null;
  let visibilityHandler: (() => void) | null = null;
  let resumeHandler: (() => void) | null = null;
  const windowAddEventListener = vi.fn((event: string, handler: () => void) => {
    if (event === 'focus') focusHandler = handler;
  });
  const windowRemoveEventListener = vi.fn();
  const documentAddEventListener = vi.fn((event: string, handler: () => void) => {
    if (event === 'visibilitychange') visibilityHandler = handler;
    if (event === 'resume') resumeHandler = handler;
  });
  const documentRemoveEventListener = vi.fn();
  let cleanup: (() => void) | undefined;
  let docStub: {
    visibilityState: string;
    addEventListener: typeof documentAddEventListener;
    removeEventListener: typeof documentRemoveEventListener;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(fetchMessages).mockReset();
    vi.mocked(fetchMessages).mockResolvedValue(undefined);
    dmSyncStatus.set('idle');
    vi.stubGlobal('window', {
      addEventListener: windowAddEventListener,
      removeEventListener: windowRemoveEventListener,
    } as unknown as Window);
    docStub = {
      visibilityState: 'hidden',
      addEventListener: documentAddEventListener,
      removeEventListener: documentRemoveEventListener,
    };
    vi.stubGlobal('document', docStub as unknown as Document);
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    focusHandler = null;
    visibilityHandler = null;
    resumeHandler = null;
    dmSyncStatus.set('idle');
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('requestCatchUp', () => {
    it('calls fetchMessages(false)', () => {
      requestCatchUp();
      expect(fetchMessages).toHaveBeenCalledWith(false);
    });

    it('does not throw when fetchMessages rejects', async () => {
      vi.mocked(fetchMessages).mockRejectedValue(new Error('ipc failed'));
      expect(() => requestCatchUp()).not.toThrow();
      await vi.waitFor(() => expect(fetchMessages).toHaveBeenCalledTimes(1));
    });
  });

  describe('installWakeSyncHandlers', () => {
    it('registers focus, visibilitychange, and resume listeners', () => {
      cleanup = installWakeSyncHandlers();
      expect(windowAddEventListener).toHaveBeenCalledWith('focus', expect.any(Function));
      expect(documentAddEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
      expect(documentAddEventListener).toHaveBeenCalledWith('resume', expect.any(Function));
    });

    it('coalesces three rapid focus events within 100ms into one fetchMessages(false) invoke', async () => {
      cleanup = installWakeSyncHandlers();
      expect(focusHandler).toBeTruthy();
      focusHandler?.();
      await vi.advanceTimersByTimeAsync(30);
      focusHandler?.();
      await vi.advanceTimersByTimeAsync(30);
      focusHandler?.();
      expect(fetchMessages).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(50);
      expect(fetchMessages).toHaveBeenCalledTimes(1);
      expect(fetchMessages).toHaveBeenCalledWith(false);
    });

    it('ignores a focus event while dmSyncStatus is syncing', async () => {
      cleanup = installWakeSyncHandlers();
      dmSyncStatus.set('syncing');
      expect(focusHandler).toBeTruthy();
      focusHandler?.();
      await vi.advanceTimersByTimeAsync(50);
      expect(fetchMessages).not.toHaveBeenCalled();
    });

    it('invokes catch-up once when document becomes visible', async () => {
      cleanup = installWakeSyncHandlers();
      docStub.visibilityState = 'visible';
      expect(visibilityHandler).toBeTruthy();
      visibilityHandler?.();
      expect(fetchMessages).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(50);
      expect(fetchMessages).toHaveBeenCalledTimes(1);
    });

    it('does not invoke catch-up when document stays hidden', async () => {
      cleanup = installWakeSyncHandlers();
      docStub.visibilityState = 'hidden';
      visibilityHandler?.();
      await vi.advanceTimersByTimeAsync(50);
      expect(fetchMessages).not.toHaveBeenCalled();
    });

    it('invokes catch-up on resume', async () => {
      cleanup = installWakeSyncHandlers();
      expect(resumeHandler).toBeTruthy();
      resumeHandler?.();
      await vi.advanceTimersByTimeAsync(50);
      expect(fetchMessages).toHaveBeenCalledTimes(1);
    });

    it('removes listeners on cleanup (no leaked listeners)', () => {
      cleanup = installWakeSyncHandlers();
      cleanup();
      expect(windowRemoveEventListener).toHaveBeenCalledWith('focus', expect.any(Function));
      expect(documentRemoveEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
      expect(documentRemoveEventListener).toHaveBeenCalledWith('resume', expect.any(Function));
      cleanup = undefined;
    });
  });
});
