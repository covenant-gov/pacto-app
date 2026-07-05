import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { toastMessage, pendingReadyToast, showToast, clearToast, runToastRetryAction } from './toast';

describe('toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearToast();
    pendingReadyToast.set(null);
  });

  it('starts empty', () => {
    expect(get(toastMessage)).toBeNull();
    expect(get(pendingReadyToast)).toBeNull();
  });

  it('shows a toast and auto-clears after the default duration', () => {
    showToast('Hello');
    expect(get(toastMessage)).toEqual({ text: 'Hello' });
    vi.advanceTimersByTime(3999);
    expect(get(toastMessage)).toEqual({ text: 'Hello' });
    vi.advanceTimersByTime(2);
    expect(get(toastMessage)).toBeNull();
  });

  it('extends duration for goTo toasts', () => {
    showToast('Ready', { type: 'squad', name: 'Alpha', id: 's1', channelId: 'c1' });
    vi.advanceTimersByTime(4001);
    expect(get(toastMessage)).not.toBeNull();
    vi.advanceTimersByTime(8000);
    expect(get(toastMessage)).toBeNull();
  });

  it('extends duration for retry toasts', () => {
    const retry = { label: 'Retry', action: vi.fn() };
    showToast('Failed', undefined, retry);
    vi.advanceTimersByTime(4001);
    expect(get(toastMessage)).not.toBeNull();
    vi.advanceTimersByTime(8000);
    expect(get(toastMessage)).toBeNull();
  });

  it('clears toast and cancels the timer', () => {
    showToast('Hello');
    clearToast();
    expect(get(toastMessage)).toBeNull();
    vi.advanceTimersByTime(10000);
    expect(get(toastMessage)).toBeNull();
  });

  it('runs the retry action when requested', () => {
    const retry = { label: 'Retry', action: vi.fn() };
    showToast('Failed', undefined, retry);
    runToastRetryAction();
    expect(retry.action).toHaveBeenCalledTimes(1);
  });

  it('does nothing when running retry without an action', () => {
    showToast('Hello');
    expect(() => runToastRetryAction()).not.toThrow();
  });
});
