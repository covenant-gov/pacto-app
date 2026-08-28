import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { torRoutingEnabled, loadTorRoutingEnabled, toggleTorRouting, TOR_SETTING_KEY } from './tor';

vi.mock('../lib/api/settings', () => ({
  getSqlSetting: vi.fn(),
}));

vi.mock('../lib/api/tor', () => ({
  setTorRoutingEnabled: vi.fn(),
}));

import { getSqlSetting } from '../lib/api/settings';
import { setTorRoutingEnabled } from '../lib/api/tor';

const mockedGetSqlSetting = vi.mocked(getSqlSetting);
const mockedSetTorRoutingEnabled = vi.mocked(setTorRoutingEnabled);

describe('tor store', () => {
  beforeEach(() => {
    torRoutingEnabled.set(false);
    vi.clearAllMocks();
  });

  it('loadTorRoutingEnabled hydrates the store from the SQL setting', async () => {
    mockedGetSqlSetting.mockResolvedValueOnce('true');
    await loadTorRoutingEnabled();
    expect(mockedGetSqlSetting).toHaveBeenCalledWith(TOR_SETTING_KEY);
    expect(get(torRoutingEnabled)).toBe(true);
  });

  it('loadTorRoutingEnabled sets the store to false for any non-"true" value', async () => {
    mockedGetSqlSetting.mockResolvedValueOnce(null);
    await loadTorRoutingEnabled();
    expect(get(torRoutingEnabled)).toBe(false);
  });

  it('loadTorRoutingEnabled defaults to false when the backend rejects', async () => {
    torRoutingEnabled.set(true);
    mockedGetSqlSetting.mockRejectedValueOnce(new Error('no current account'));
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
});
