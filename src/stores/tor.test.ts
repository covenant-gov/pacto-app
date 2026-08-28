import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { torRoutingEnabled, torAvailable, torStartupError, loadTorRoutingEnabled, toggleTorRouting } from './tor';

vi.mock('../lib/api/tor', () => ({
  getTorStatus: vi.fn(),
  setTorRoutingEnabled: vi.fn(),
}));

import { getTorStatus, setTorRoutingEnabled } from '../lib/api/tor';
import type { TorStatus } from '../lib/api/tor';

const mockedGetTorStatus = vi.mocked(getTorStatus);
const mockedSetTorRoutingEnabled = vi.mocked(setTorRoutingEnabled);

function status(overrides: Partial<TorStatus> = {}): TorStatus {
  return {
    available: true,
    enabled: false,
    bootstrapped: false,
    bootstrap_fraction: 0,
    blocked_reason: null,
    active_connections: 0,
    bytes_up: 0,
    bytes_down: 0,
    avg_connect_latency_ms: null,
    enabled_seconds: null,
    startup_error: null,
    ...overrides,
  };
}

describe('tor store', () => {
  beforeEach(() => {
    torRoutingEnabled.set(false);
    torAvailable.set(true);
    torStartupError.set(null);
    vi.clearAllMocks();
  });

  it('loadTorRoutingEnabled hydrates the store from the live backend status, not the raw persisted setting', async () => {
    mockedGetTorStatus.mockResolvedValueOnce(status({ enabled: true }));
    await loadTorRoutingEnabled();
    expect(mockedGetTorStatus).toHaveBeenCalled();
    expect(get(torRoutingEnabled)).toBe(true);
  });

  it('loadTorRoutingEnabled reads false when the backend reports a failed bootstrap despite the setting being on', async () => {
    mockedGetTorStatus.mockResolvedValueOnce(
      status({ enabled: false, startup_error: 'Failed to bootstrap Tor: timed out' })
    );
    await loadTorRoutingEnabled();
    expect(get(torRoutingEnabled)).toBe(false);
    expect(get(torStartupError)).toBe('Failed to bootstrap Tor: timed out');
  });

  it('loadTorRoutingEnabled reflects availability for builds without the tor feature', async () => {
    mockedGetTorStatus.mockResolvedValueOnce(status({ available: false, enabled: false }));
    await loadTorRoutingEnabled();
    expect(get(torAvailable)).toBe(false);
  });

  it('loadTorRoutingEnabled defaults to false when the backend rejects', async () => {
    torRoutingEnabled.set(true);
    mockedGetTorStatus.mockRejectedValueOnce(new Error('no current account'));
    await loadTorRoutingEnabled();
    expect(get(torRoutingEnabled)).toBe(false);
  });

  it('toggleTorRouting optimistically sets the store and persists on success', async () => {
    torRoutingEnabled.set(false);
    mockedSetTorRoutingEnabled.mockResolvedValueOnce(undefined);
    const err = await toggleTorRouting(true, 'fallback');
    expect(err).toBeNull();
    expect(mockedSetTorRoutingEnabled).toHaveBeenCalledWith(true);
    expect(get(torRoutingEnabled)).toBe(true);
  });

  it('toggleTorRouting reverts the store and returns an error message on failure', async () => {
    torRoutingEnabled.set(true);
    mockedSetTorRoutingEnabled.mockRejectedValueOnce(new Error('bootstrap failed'));
    const err = await toggleTorRouting(false, 'fallback');
    expect(err).toBe('bootstrap failed');
    expect(get(torRoutingEnabled)).toBe(true);
  });

  it('toggleTorRouting falls back to the provided message when the error has no text', async () => {
    torRoutingEnabled.set(true);
    mockedSetTorRoutingEnabled.mockRejectedValueOnce({});
    const err = await toggleTorRouting(false, 'fallback message');
    expect(err).toBe('fallback message');
    expect(get(torRoutingEnabled)).toBe(true);
  });

  it('toggleTorRouting serializes concurrent calls so a second toggle cannot race the first against the backend', async () => {
    torRoutingEnabled.set(false);
    const { promise: firstBackendCall, resolve: resolveFirst } = Promise.withResolvers<void>();
    mockedSetTorRoutingEnabled.mockImplementationOnce(() => firstBackendCall);
    mockedSetTorRoutingEnabled.mockResolvedValueOnce(undefined);

    const first = toggleTorRouting(true, 'fallback');
    const second = toggleTorRouting(false, 'fallback');

    // The second call must not reach the backend until the first settles.
    await Promise.resolve();
    await Promise.resolve();
    expect(mockedSetTorRoutingEnabled).toHaveBeenCalledTimes(1);

    resolveFirst();
    await first;
    await second;

    expect(mockedSetTorRoutingEnabled).toHaveBeenNthCalledWith(1, true);
    expect(mockedSetTorRoutingEnabled).toHaveBeenNthCalledWith(2, false);
    expect(get(torRoutingEnabled)).toBe(false);
  });
});
