import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writable } from 'svelte/store';

vi.mock('../../stores/auth', () => ({
  currentUser: writable(null),
}));

vi.mock('./backend-wallet', () => ({
  getWalletSummary: vi.fn(),
}));

vi.mock('./watched-tokens', () => ({
  loadWatchedErc20Rows: vi.fn().mockReturnValue([]),
  watchedRowsToWire: vi.fn().mockReturnValue([]),
}));

vi.mock('./wallet-summary-cache', () => ({
  persistWalletSummaryCache: vi.fn(),
}));

vi.mock('./wallet-ui-prefs', () => ({
  loadWalletEnabledChains: vi.fn().mockReturnValue(['sepolia']),
}));

import { currentUser } from '../../stores/auth';
import { getWalletSummary } from './backend-wallet';
import { loadWatchedErc20Rows, watchedRowsToWire } from './watched-tokens';
import { persistWalletSummaryCache } from './wallet-summary-cache';
import { loadWalletEnabledChains } from './wallet-ui-prefs';

describe('scheduleWalletSummaryBackgroundPrefetch', () => {
  let schedule: (npub: string | null | undefined) => void;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(0);
    currentUser.set(null);
    vi.mocked(getWalletSummary).mockReset();
    vi.mocked(loadWatchedErc20Rows).mockReset().mockReturnValue([]);
    vi.mocked(watchedRowsToWire).mockReset().mockReturnValue([]);
    vi.mocked(persistWalletSummaryCache).mockReset();
    vi.mocked(loadWalletEnabledChains).mockReset().mockReturnValue(['sepolia']);
    const mod = await import('./wallet-summary-prefetch');
    schedule = mod.scheduleWalletSummaryBackgroundPrefetch;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing when no npub is provided', async () => {
    schedule(undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(getWalletSummary).not.toHaveBeenCalled();
  });

  it('fetches and persists a summary for a logged-in account', async () => {
    const summary = {
      networks: [],
      totalUsdApprox: 0,
      prices: {} as never,
    };
    vi.mocked(getWalletSummary).mockResolvedValue({ ok: true, summary });
    vi.mocked(loadWatchedErc20Rows).mockReturnValueOnce([{ symbol: 'USDC' } as never]);
    vi.mocked(watchedRowsToWire).mockReturnValueOnce([{ network: 'sepolia', symbol: 'USDC', address: '0xabc', decimals: 6 }]);
    currentUser.set({ npub: 'npub1' } as never);

    schedule('npub1');
    await vi.advanceTimersByTimeAsync(0);

    expect(loadWatchedErc20Rows).toHaveBeenCalledWith('npub1');
    expect(getWalletSummary).toHaveBeenCalledWith(
      [{ network: 'sepolia', symbol: 'USDC', address: '0xabc', decimals: 6 }],
      ['sepolia'],
    );
    expect(persistWalletSummaryCache).toHaveBeenCalledWith(
      'npub1',
      [{ network: 'sepolia', symbol: 'USDC', address: '0xabc', decimals: 6 }],
      summary,
    );
  });

  it('does not persist for the stale account and instead fetches the current account', async () => {
    vi.mocked(getWalletSummary).mockResolvedValue({ ok: true, summary: { networks: [], totalUsdApprox: 0, prices: {} as never } });
    currentUser.set({ npub: 'npub2' } as never);

    schedule('npub1');
    await vi.advanceTimersByTimeAsync(0);

    expect(getWalletSummary).toHaveBeenCalled();
    expect(persistWalletSummaryCache).not.toHaveBeenCalledWith(
      'npub1',
      expect.anything(),
      expect.anything(),
    );
    expect(persistWalletSummaryCache).toHaveBeenCalledWith(
      'npub2',
      expect.anything(),
      expect.anything(),
    );
  });

  it('skips while the same account is already in-flight', async () => {
    vi.mocked(getWalletSummary).mockResolvedValue({ ok: true, summary: { networks: [], totalUsdApprox: 0, prices: {} as never } });

    schedule('npub1');
    schedule('npub1');
    await vi.advanceTimersByTimeAsync(0);

    expect(getWalletSummary).toHaveBeenCalledTimes(1);
  });

  it('skips a different account while another is in-flight', async () => {
    vi.mocked(getWalletSummary).mockResolvedValue({ ok: true, summary: { networks: [], totalUsdApprox: 0, prices: {} as never } });

    schedule('npub1');
    schedule('npub2');
    await vi.advanceTimersByTimeAsync(0);

    expect(getWalletSummary).toHaveBeenCalledTimes(1);
  });

  it('throttles repeat success for the same account', async () => {
    vi.mocked(getWalletSummary).mockResolvedValue({ ok: true, summary: { networks: [], totalUsdApprox: 0, prices: {} as never } });
    currentUser.set({ npub: 'npub1' } as never);

    schedule('npub1');
    await vi.advanceTimersByTimeAsync(0);
    expect(getWalletSummary).toHaveBeenCalledTimes(1);

    schedule('npub1');
    await vi.advanceTimersByTimeAsync(0);
    expect(getWalletSummary).toHaveBeenCalledTimes(1);
  });

  it('runs again after the throttle window has passed', async () => {
    vi.mocked(getWalletSummary).mockResolvedValue({ ok: true, summary: { networks: [], totalUsdApprox: 0, prices: {} as never } });
    currentUser.set({ npub: 'npub1' } as never);

    schedule('npub1');
    await vi.advanceTimersByTimeAsync(0);
    expect(getWalletSummary).toHaveBeenCalledTimes(1);

    vi.setSystemTime(60_000);
    schedule('npub1');
    await vi.advanceTimersByTimeAsync(0);
    expect(getWalletSummary).toHaveBeenCalledTimes(2);
  });

  it('schedules a fetch for the current account when the finished account is stale', async () => {
    vi.mocked(getWalletSummary).mockResolvedValue({ ok: true, summary: { networks: [], totalUsdApprox: 0, prices: {} as never } });
    vi.mocked(loadWatchedErc20Rows).mockReturnValueOnce([]);
    currentUser.set({ npub: 'npub2' } as never);

    schedule('npub1');
    await vi.advanceTimersByTimeAsync(0);

    expect(loadWatchedErc20Rows).toHaveBeenCalledWith('npub2');
  });
});
