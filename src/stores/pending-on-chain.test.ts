import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  ON_CHAIN_JOB_SETTLE_MS,
  beginOnChainJob,
  clearOnChainJobs,
  completeOnChainJob,
  failOnChainJob,
  hasPendingJob,
  pendingOnChainJobs,
} from './pending-on-chain';

describe('pending-on-chain', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearOnChainJobs();
  });

  afterEach(() => {
    clearOnChainJobs();
    vi.useRealTimers();
  });

  it('starts empty', () => {
    expect(get(pendingOnChainJobs)).toEqual([]);
  });

  it('begins a pending job', () => {
    const id = beginOnChainJob({ label: 'Request add', parentId: 'p1', actionKey: 'add' });
    expect(get(pendingOnChainJobs)).toEqual([
      expect.objectContaining({
        id,
        label: 'Request add',
        parentId: 'p1',
        actionKey: 'add',
        status: 'pending',
      }),
    ]);
    expect(hasPendingJob('p1', 'add')).toBe(true);
  });

  it('completes a job then auto-removes', () => {
    const id = beginOnChainJob({ label: 'Vote', parentId: 'p1', actionKey: 'vote' });
    completeOnChainJob(id, '0xabc');
    expect(get(pendingOnChainJobs)[0]).toMatchObject({
      status: 'confirmed',
      txHash: '0xabc',
    });
    expect(hasPendingJob('p1', 'vote')).toBe(false);
    vi.advanceTimersByTime(ON_CHAIN_JOB_SETTLE_MS - 1);
    expect(get(pendingOnChainJobs)).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(get(pendingOnChainJobs)).toEqual([]);
  });

  it('fails a job then auto-removes', () => {
    const id = beginOnChainJob({ label: 'Execute' });
    failOnChainJob(id);
    expect(get(pendingOnChainJobs)[0]?.status).toBe('failed');
    vi.advanceTimersByTime(ON_CHAIN_JOB_SETTLE_MS);
    expect(get(pendingOnChainJobs)).toEqual([]);
  });

  it('tracks multiple jobs independently', () => {
    const a = beginOnChainJob({ label: 'A', parentId: 'p1', actionKey: 'a' });
    beginOnChainJob({ label: 'B', parentId: 'p1', actionKey: 'b' });
    expect(get(pendingOnChainJobs)).toHaveLength(2);
    completeOnChainJob(a);
    expect(hasPendingJob('p1', 'a')).toBe(false);
    expect(hasPendingJob('p1', 'b')).toBe(true);
  });

  it('hasPendingJob ignores blank keys and settled jobs', () => {
    expect(hasPendingJob('', 'x')).toBe(false);
    expect(hasPendingJob('p1', '')).toBe(false);
    const id = beginOnChainJob({ label: 'X', parentId: 'p1', actionKey: 'x' });
    completeOnChainJob(id);
    expect(hasPendingJob('p1', 'x')).toBe(false);
  });
});
