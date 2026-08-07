import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMlsStoreResetState } = vi.hoisted(() => ({
  getMlsStoreResetState: vi.fn(),
}));
vi.mock('../lib/api/nostr', () => ({ getMlsStoreResetState }));

import {
  applyMlsStoreResetState,
  mlsResetByGroupId,
  refreshMlsStoreResetState,
  resetMlsStoreResetState,
} from './mls-reset';

describe('mls reset state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMlsStoreResetState();
  });

  it('distinguishes multiple admins, one admin, and no recorded admins', () => {
    applyMlsStoreResetState([
      { groupId: 'multi', stateLost: true, adminNpubs: ['a', 'b'], singleAdmin: false },
      { groupId: 'single', stateLost: true, adminNpubs: ['a'], singleAdmin: false },
      { groupId: 'missing', stateLost: true, adminNpubs: [], singleAdmin: false },
    ]);

    const state = get(mlsResetByGroupId);
    expect(state.multi.singleAdmin).toBe(false);
    expect(state.single.singleAdmin).toBe(true);
    expect(state.missing.adminNpubs).toEqual([]);
  });

  it('hydrates from the backend and removes restored groups', async () => {
    getMlsStoreResetState
      .mockResolvedValueOnce([
        { groupId: 'lost', stateLost: true, adminNpubs: ['a', 'b'], singleAdmin: false },
      ])
      .mockResolvedValueOnce([]);

    await refreshMlsStoreResetState();
    expect(get(mlsResetByGroupId)).toHaveProperty('lost');
    await refreshMlsStoreResetState();
    expect(get(mlsResetByGroupId)).toEqual({});
  });

  it('does not restore an old account response after state is cleared', async () => {
    let resolveRequest!: (groups: Array<{
      groupId: string;
      stateLost: boolean;
      adminNpubs: string[];
      singleAdmin: boolean;
    }>) => void;
    getMlsStoreResetState.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );

    const refresh = refreshMlsStoreResetState();
    resetMlsStoreResetState();
    resolveRequest([
      { groupId: 'old-account', stateLost: true, adminNpubs: [], singleAdmin: false },
    ]);
    await refresh;

    expect(get(mlsResetByGroupId)).toEqual({});
  });

  it('keeps a fresher mls_store_reset event over a stale in-flight refresh result', async () => {
    const { promise, resolve: resolveInitialFetch } = Promise.withResolvers<Array<{
      groupId: string;
      stateLost: boolean;
      adminNpubs: string[];
      singleAdmin: boolean;
    }>>();
    getMlsStoreResetState.mockReturnValueOnce(promise);

    // Post-login refresh kicks off but has not resolved yet.
    const refresh = refreshMlsStoreResetState();

    // The mls_store_reset event listener fires directly with fresher state
    // while the refresh fetch is still in flight.
    applyMlsStoreResetState([
      { groupId: 'fresh', stateLost: true, adminNpubs: ['a'], singleAdmin: true },
    ]);

    // The original fetch finally resolves with older/stale data.
    resolveInitialFetch([
      { groupId: 'stale', stateLost: true, adminNpubs: [], singleAdmin: false },
    ]);
    await refresh;

    expect(get(mlsResetByGroupId)).toEqual({
      fresh: { groupId: 'fresh', stateLost: true, adminNpubs: ['a'], singleAdmin: true },
    });
  });

  it('ignores records that are not marked lost', () => {
    applyMlsStoreResetState([
      { groupId: 'restored', stateLost: false, adminNpubs: ['a'], singleAdmin: true },
    ]);
    expect(get(mlsResetByGroupId)).toEqual({});
  });
});
