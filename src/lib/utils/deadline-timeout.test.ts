import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_SET_TIMEOUT_MS, scheduleDeadlineTimeout } from './deadline-timeout';

describe('scheduleDeadlineTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not fire immediately for delays above the 32-bit setTimeout ceiling', () => {
    const onTick = vi.fn();
    const deadlineSec = Math.floor(Date.now() / 1000) + 60 * 24 * 3600;
    const stop = scheduleDeadlineTimeout(deadlineSec, onTick);
    vi.advanceTimersByTime(1_000);
    expect(onTick).not.toHaveBeenCalled();
    stop();
  });

  it('re-arms until the deadline then ticks once more', () => {
    const onTick = vi.fn();
    const deadlineSec = Math.floor(Date.now() / 1000) + 60 * 24 * 3600;
    scheduleDeadlineTimeout(deadlineSec, onTick);
    vi.advanceTimersByTime(MAX_SET_TIMEOUT_MS);
    expect(onTick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(MAX_SET_TIMEOUT_MS);
    expect(onTick).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(MAX_SET_TIMEOUT_MS);
    expect(onTick.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('clears the pending timer on cleanup', () => {
    const onTick = vi.fn();
    const deadlineSec = Math.floor(Date.now() / 1000) + 3600;
    const stop = scheduleDeadlineTimeout(deadlineSec, onTick);
    stop();
    vi.advanceTimersByTime(3_600_000);
    expect(onTick).not.toHaveBeenCalled();
  });
});
