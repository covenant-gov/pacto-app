import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('svelte-i18n', () => ({
  t: {
    subscribe: (fn: (v: (k: string) => string) => void) => {
      fn((k) => k);
      return () => {};
    },
  },
}));

vi.mock('../evm/on-chain-background', () => ({
  runOnChainInBackground: vi.fn(),
}));

vi.mock('./gov-write-errors', () => ({
  showGovWriteErrorToast: vi.fn(),
}));

vi.mock('../../stores/toast', () => ({
  showToast: vi.fn(),
}));

import { runOnChainInBackground } from '../evm/on-chain-background';
import { showGovWriteErrorToast } from './gov-write-errors';
import { showToast } from '../../stores/toast';
import { beginOnChainJob, clearOnChainJobs } from '../../stores/pending-on-chain';
import { runGovWriteInBackground } from './gov-write-background';

describe('runGovWriteInBackground', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearOnChainJobs();
  });

  it('queues a labeled job and toasts submitted then confirmed', async () => {
    const onSettled = vi.fn();
    const job = vi.fn().mockResolvedValue({ txHash: '0x1', fundedBy: 'sponsored' });
    vi.mocked(runOnChainInBackground).mockImplementation((opts) => {
      void opts.job().then((result) => opts.onSuccess?.(result));
    });

    expect(
      runGovWriteInBackground({
        label: 'Request add',
        parentId: 'p1',
        actionKey: 'add',
        job,
        onSettled,
      }),
    ).toBe(true);

    expect(runOnChainInBackground).toHaveBeenCalledWith(
      expect.objectContaining({
        jobLabel: 'Request add',
        parentId: 'p1',
        actionKey: 'add',
        startedToast: 'governance.toast.squadTransactionSubmitted',
        errorToast: false,
      }),
    );
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalled());
    expect(showToast).toHaveBeenCalled();
  });

  it('skips a duplicate in-flight action key', () => {
    beginOnChainJob({ label: 'Request add', parentId: 'p1', actionKey: 'add' });
    const started = runGovWriteInBackground({
      label: 'Request add',
      parentId: 'p1',
      actionKey: 'add',
      job: async () => ({}),
    });
    expect(started).toBe(false);
    expect(runOnChainInBackground).not.toHaveBeenCalled();
  });

  it('routes failures through gov write toasts', async () => {
    const err = new Error('boom');
    vi.mocked(runOnChainInBackground).mockImplementation((opts) => {
      const handled = opts.onError?.('boom', err);
      expect(handled).toBe(true);
    });
    runGovWriteInBackground({
      label: 'Execute',
      parentId: 'p1',
      job: async () => {
        throw err;
      },
    });
    expect(showGovWriteErrorToast).toHaveBeenCalledWith(err, 'Execute');
  });
});
