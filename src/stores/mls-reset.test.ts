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
      { group_id: 'multi', state_lost: true, admin_npubs: ['a', 'b'], single_admin: false },
      { group_id: 'single', state_lost: true, admin_npubs: ['a'], single_admin: false },
      { group_id: 'missing', state_lost: true, admin_npubs: [], single_admin: false },
    ]);

    const state = get(mlsResetByGroupId);
    expect(state.multi.single_admin).toBe(false);
    expect(state.single.single_admin).toBe(true);
    expect(state.missing.admin_npubs).toEqual([]);
  });

  it('hydrates from the backend and removes restored groups', async () => {
    getMlsStoreResetState
      .mockResolvedValueOnce([
        { group_id: 'lost', state_lost: true, admin_npubs: ['a', 'b'], single_admin: false },
      ])
      .mockResolvedValueOnce([]);

    await refreshMlsStoreResetState();
    expect(get(mlsResetByGroupId)).toHaveProperty('lost');
    await refreshMlsStoreResetState();
    expect(get(mlsResetByGroupId)).toEqual({});
  });

  it('does not restore an old account response after state is cleared', async () => {
    let resolveRequest!: (groups: Array<{
      group_id: string;
      state_lost: boolean;
      admin_npubs: string[];
      single_admin: boolean;
    }>) => void;
    getMlsStoreResetState.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );

    const refresh = refreshMlsStoreResetState();
    resetMlsStoreResetState();
    resolveRequest([
      { group_id: 'old-account', state_lost: true, admin_npubs: [], single_admin: false },
    ]);
    await refresh;

    expect(get(mlsResetByGroupId)).toEqual({});
  });

  it('ignores records that are not marked lost', () => {
    applyMlsStoreResetState([
      { group_id: 'restored', state_lost: false, admin_npubs: ['a'], single_admin: true },
    ]);
    expect(get(mlsResetByGroupId)).toEqual({});
  });
});
