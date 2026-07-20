import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../../stores/squad-join-requests', () => ({
  syncJoinRequestsForSquad: vi.fn(),
}));

const respondToSquadStateSyncRequest = vi.fn();
vi.mock('../squad/squad-state-sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../squad/squad-state-sync')>();
  return {
    ...actual,
    respondToSquadStateSyncRequest: (...args: unknown[]) => respondToSquadStateSyncRequest(...args),
  };
});

const currentUser = vi.hoisted(() => {
  function makeStore<T>(initial: T) {
    let value = initial;
    const subs = new Set<(v: T) => void>();
    return {
      subscribe(run: (v: T) => void) {
        subs.add(run);
        run(value);
        return () => {
          subs.delete(run);
        };
      },
      set(next: T) {
        value = next;
        for (const run of subs) run(value);
      },
      update(fn: (v: T) => T) {
        this.set(fn(value));
      },
    };
  }
  return makeStore<{ npub: string } | null>({ npub: 'npub1alice' });
});

vi.mock('../../stores/auth', () => ({
  currentUser,
}));

import { onMlsStructuredMessage } from './mls-structured-refresh';
import {
  squadAllowlistNonceByParentId,
  squadBotMetaNonceBySquadId,
  squadTrackedTokensNonceByParentId,
} from '../../stores/navigation';
import { syncJoinRequestsForSquad } from '../../stores/squad-join-requests';
import { formatSquadStateSyncRequest } from '../squad/squad-state-sync';
import { formatSquadNetworkUpdated } from '../squad/squad-network-share';
import { loadSquadNetworkOverride, SQUAD_NETWORK_PREFIX } from '../squad/squad-network';

describe('onMlsStructuredMessage', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    squadAllowlistNonceByParentId.set({});
    squadTrackedTokensNonceByParentId.set({});
    squadBotMetaNonceBySquadId.set({});
    vi.mocked(syncJoinRequestsForSquad).mockClear();
    respondToSquadStateSyncRequest.mockClear();
    currentUser.set({ npub: 'npub1alice' });
    store.clear();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
  });

  it('refreshes infra and treasury from announce types', () => {
    const handlers = {
      mergeTreasurySafesForParent: vi.fn(),
      mergeSquadInfraForParent: vi.fn(),
      mergeSquadMemberEvmForAnnouncementsGroup: vi.fn(),
    };
    onMlsStructuredMessage(
      JSON.stringify({
        type: 'governance_updated',
        payload: {
          parent_id: 'g1',
          provider: 'pacto_gov',
          canonical_ref: '1',
        },
      }),
      'g1',
      handlers,
    );
    expect(handlers.mergeSquadInfraForParent).toHaveBeenCalledWith('g1');
  });

  it('triggers peer respond on squad_state_sync_request', () => {
    const handlers = {
      mergeTreasurySafesForParent: vi.fn(),
      mergeSquadInfraForParent: vi.fn(),
      mergeSquadMemberEvmForAnnouncementsGroup: vi.fn(),
    };
    const raw = formatSquadStateSyncRequest({
      parentId: 'g1',
      requestId: 'r1',
      requesterNpub: 'npub1joiner',
    });
    onMlsStructuredMessage(raw, 'g1', handlers);
    expect(respondToSquadStateSyncRequest).toHaveBeenCalledWith(raw, 'g1');
  });

  it('applies squad_network_updated into local override', () => {
    const handlers = {
      mergeTreasurySafesForParent: vi.fn(),
      mergeSquadInfraForParent: vi.fn(),
      mergeSquadMemberEvmForAnnouncementsGroup: vi.fn(),
    };
    const raw = formatSquadNetworkUpdated({ parentId: 'g1', chain: 'local' });
    onMlsStructuredMessage(raw, 'g1', handlers);
    expect(loadSquadNetworkOverride('npub1alice', 'g1')).toBe('local');
    expect(localStorage.getItem(`${SQUAD_NETWORK_PREFIX}_npub1alice`)).toBeTruthy();
  });

  it('ignores squad_network_updated when parent_id mismatches groupId', () => {
    const handlers = {
      mergeTreasurySafesForParent: vi.fn(),
      mergeSquadInfraForParent: vi.fn(),
      mergeSquadMemberEvmForAnnouncementsGroup: vi.fn(),
    };
    const raw = formatSquadNetworkUpdated({ parentId: 'other', chain: 'sepolia' });
    onMlsStructuredMessage(raw, 'g1', handlers);
    expect(loadSquadNetworkOverride('npub1alice', 'g1')).toBeNull();
    expect(loadSquadNetworkOverride('npub1alice', 'other')).toBeNull();
  });

  it('bumps allowlist nonce', () => {
    const handlers = {
      mergeTreasurySafesForParent: vi.fn(),
      mergeSquadInfraForParent: vi.fn(),
      mergeSquadMemberEvmForAnnouncementsGroup: vi.fn(),
    };
    onMlsStructuredMessage(
      JSON.stringify({
        type: 'squad_contract_allowlist_updated',
        payload: { parent_id: 'g1', action: 'upsert' },
      }),
      'g1',
      handlers,
    );
    expect(get(squadAllowlistNonceByParentId).g1).toBe(1);
  });

  it('bumps tracked tokens nonce', () => {
    const handlers = {
      mergeTreasurySafesForParent: vi.fn(),
      mergeSquadInfraForParent: vi.fn(),
      mergeSquadMemberEvmForAnnouncementsGroup: vi.fn(),
    };
    onMlsStructuredMessage(
      JSON.stringify({
        type: 'squad_tracked_tokens_updated',
        payload: { parent_id: 'g1', action: 'upsert' },
      }),
      'g1',
      handlers,
    );
    expect(get(squadTrackedTokensNonceByParentId).g1).toBe(1);
  });

  it('syncs join requests for join schema', () => {
    const handlers = {
      mergeTreasurySafesForParent: vi.fn(),
      mergeSquadInfraForParent: vi.fn(),
      mergeSquadMemberEvmForAnnouncementsGroup: vi.fn(),
    };
    onMlsStructuredMessage(
      JSON.stringify({
        schema: 'pacto.squad.join_request.v1',
        squadId: 'g1',
        requestId: 'r1',
      }),
      'g1',
      handlers,
    );
    expect(syncJoinRequestsForSquad).toHaveBeenCalledWith('g1');
  });
});
