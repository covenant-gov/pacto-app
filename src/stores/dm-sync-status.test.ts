import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  dmSyncStatus,
  lastCatchUpSuccess,
  relayStatusByUrl,
  dmSyncStatusEffective,
  seedRelayHealth,
  applyRelayStatusChange,
  installSyncHealthTicker,
} from './dm';

const FIVE_MIN_MS = 5 * 60 * 1000;

describe('dmSyncStatusEffective', () => {
  let cleanupTicker: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    dmSyncStatus.set('idle');
    lastCatchUpSuccess.set(null);
    relayStatusByUrl.set({});
    cleanupTicker = installSyncHealthTicker();
  });

  afterEach(() => {
    cleanupTicker?.();
    cleanupTicker = undefined;
    vi.useRealTimers();
  });

  it('passes through idle when catch-up is recent and no relay is stale', () => {
    lastCatchUpSuccess.set(Date.now());
    expect(get(dmSyncStatusEffective)).toBe('idle');
  });

  it('always reports syncing while a sync is in progress, regardless of staleness', async () => {
    dmSyncStatus.set('syncing');
    lastCatchUpSuccess.set(null);
    await vi.advanceTimersByTimeAsync(FIVE_MIN_MS + 60_000);
    expect(get(dmSyncStatusEffective)).toBe('syncing');
  });

  it('goes behind when no catch-up has ever succeeded this session', () => {
    lastCatchUpSuccess.set(null);
    expect(get(dmSyncStatusEffective)).toBe('behind');
  });

  it('goes stalled when catch-up is 5+ min stale and an enabled relay has been down 5+ min', async () => {
    lastCatchUpSuccess.set(Date.now());
    applyRelayStatusChange('wss://relay.one', 'connected');
    applyRelayStatusChange('wss://relay.one', 'disconnected');
    await vi.advanceTimersByTimeAsync(FIVE_MIN_MS + 60_000);
    expect(get(dmSyncStatusEffective)).toBe('stalled');
  });

  it('goes behind (not stalled) when catch-up is stale but no relay is down', async () => {
    lastCatchUpSuccess.set(Date.now());
    applyRelayStatusChange('wss://relay.one', 'connected');
    await vi.advanceTimersByTimeAsync(FIVE_MIN_MS + 60_000);
    expect(get(dmSyncStatusEffective)).toBe('behind');
  });

  it('a disabled relay disconnected for a long time never contributes to stalled', async () => {
    seedRelayHealth([{ url: 'wss://relay.disabled', status: 'disconnected', enabled: false }]);
    lastCatchUpSuccess.set(Date.now());
    await vi.advanceTimersByTimeAsync(FIVE_MIN_MS + 60_000);
    expect(get(dmSyncStatusEffective)).toBe('behind');
  });

  it('clears back to finished then idle the moment a catch-up succeeds', async () => {
    lastCatchUpSuccess.set(Date.now());
    applyRelayStatusChange('wss://relay.one', 'connected');
    applyRelayStatusChange('wss://relay.one', 'disconnected');
    await vi.advanceTimersByTimeAsync(FIVE_MIN_MS + 60_000);
    expect(get(dmSyncStatusEffective)).toBe('stalled');

    // Simulate the sync_finished handler: dmSyncStatus -> 'finished', lastCatchUpSuccess resets.
    dmSyncStatus.set('finished');
    lastCatchUpSuccess.set(Date.now());
    expect(get(dmSyncStatusEffective)).toBe('finished');

    // Simulate the existing finished -> idle timeout.
    dmSyncStatus.set('idle');
    expect(get(dmSyncStatusEffective)).toBe('idle');
  });
});
