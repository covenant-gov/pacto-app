import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockStartTyping = vi.fn();

vi.mock('../api/nostr', () => ({
  startTyping: (...args: unknown[]) => mockStartTyping(...args),
}));

import { notifyTyping, resetTypingNotifierForTests } from './typing-notifier';
import { sendTypingIndicatorsEnabled } from '../../stores/typing-indicators';

beforeEach(() => {
  vi.useFakeTimers();
  mockStartTyping.mockReset();
  mockStartTyping.mockResolvedValue(true);
  sendTypingIndicatorsEnabled.set(true);
  resetTypingNotifierForTests();
});

afterEach(() => {
  resetTypingNotifierForTests();
  sendTypingIndicatorsEnabled.set(true);
  vi.useRealTimers();
});

describe('notifyTyping', () => {
  it('invokes startTyping after the debounce window when enabled', () => {
    notifyTyping('npub1receiver');
    expect(mockStartTyping).not.toHaveBeenCalled();

    vi.advanceTimersByTime(400);

    expect(mockStartTyping).toHaveBeenCalledWith('npub1receiver');
  });

  it('does not invoke startTyping when the preference is disabled', () => {
    sendTypingIndicatorsEnabled.set(false);

    notifyTyping('npub1receiver');
    vi.advanceTimersByTime(400);

    expect(mockStartTyping).not.toHaveBeenCalled();
  });

  it('does not invoke startTyping when there is no active chat', () => {
    notifyTyping(null);
    vi.advanceTimersByTime(400);

    expect(mockStartTyping).not.toHaveBeenCalled();
  });

  it('debounces rapid keystrokes into a single call', () => {
    notifyTyping('npub1receiver');
    vi.advanceTimersByTime(200);
    notifyTyping('npub1receiver');
    vi.advanceTimersByTime(200);
    notifyTyping('npub1receiver');
    vi.advanceTimersByTime(400);

    expect(mockStartTyping).toHaveBeenCalledTimes(1);
  });

  it('re-checks the preference at debounce-fire time, not call time', () => {
    notifyTyping('npub1receiver');
    sendTypingIndicatorsEnabled.set(false);
    vi.advanceTimersByTime(400);

    expect(mockStartTyping).not.toHaveBeenCalled();
  });
});
