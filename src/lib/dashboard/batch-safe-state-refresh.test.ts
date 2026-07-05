import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TreasurySafeEntry } from '../treasury/treasury-safes';
import { refreshSafeStateForTreasuryEntry } from '../../stores/safe';
import { refreshAllSafeStates } from './batch-safe-state-refresh';

vi.mock('../../stores/safe');

const mockedRefresh = vi.mocked(refreshSafeStateForTreasuryEntry);

beforeEach(() => {
  vi.clearAllMocks();
});

const entries: TreasurySafeEntry[] = [
  {
    id: 'entry-1',
    parentId: 'parent-1',
    safeAddress: '0xAAA',
    chain: 'sepolia',
    label: 'Vault A',
    createdAtMs: 1,
  },
  {
    id: 'entry-2',
    parentId: 'parent-1',
    safeAddress: '0xBBB',
    chain: 'sepolia',
    label: 'Vault B',
    createdAtMs: 2,
  },
];

describe('refreshAllSafeStates', () => {
  it('returns early when entries is empty', async () => {
    await refreshAllSafeStates([]);
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it('calls refreshSafeStateForTreasuryEntry for each entry', async () => {
    await refreshAllSafeStates(entries);

    expect(mockedRefresh).toHaveBeenCalledTimes(2);
    expect(mockedRefresh).toHaveBeenNthCalledWith(1, entries[0], undefined);
    expect(mockedRefresh).toHaveBeenNthCalledWith(2, entries[1], undefined);
  });

  it('forwards options to each refresh call', async () => {
    await refreshAllSafeStates(entries, { force: true });

    expect(mockedRefresh).toHaveBeenCalledTimes(2);
    expect(mockedRefresh).toHaveBeenNthCalledWith(1, entries[0], { force: true });
    expect(mockedRefresh).toHaveBeenNthCalledWith(2, entries[1], { force: true });
  });
});
