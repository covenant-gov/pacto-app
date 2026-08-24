import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../../stores/squad-join-requests', () => ({
  syncJoinRequestsForSquad: vi.fn(),
}));

vi.mock('../parent/pending-admit', () => ({
  drainPendingAdmitQueue: vi.fn(),
}));

const respondToSquadStateSyncRequest = vi.fn();
vi.mock('../squad/squad-state-sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../squad/squad-state-sync')>();
  return {
    ...actual,
    respondToSquadStateSyncRequest: (...args: unknown[]) => respondToSquadStateSyncRequest(...args),
  };
});

const applySquadIdentityUpdated = vi.hoisted(() => vi.fn());
vi.mock('../squad/squad-identity-announce', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../squad/squad-identity-announce')>();
  return {
    ...actual,
    applySquadIdentityUpdated: (...args: unknown[]) => applySquadIdentityUpdated(...args),
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
  governanceProcessNonceByParentId,
  squadAllowlistNonceByParentId,
  squadBotMetaNonceBySquadId,
  squadTrackedTokensNonceByParentId,
} from '../../stores/navigation';
import { syncJoinRequestsForSquad } from '../../stores/squad-join-requests';
import { formatSquadStateSyncRequest } from '../squad/squad-state-sync';
import { formatSquadNetworkUpdated } from '../squad/squad-network-share';
import {
  loadSquadNetworkPair,
  resolvePracticeSquadNetwork,
  SQUAD_NETWORK_PREFIX,
} from '../squad/squad-network';
import { squadInfraByParentId } from '../../stores/squads';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import {
  mutinyProcessTxByParentId,
  mutinyTxHashForCard,
  resetMutinyProcessTxStore,
} from '../governance/mutiny-process-tx';

describe('onMlsStructuredMessage', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    squadAllowlistNonceByParentId.set({});
    squadTrackedTokensNonceByParentId.set({});
    squadBotMetaNonceBySquadId.set({});
    governanceProcessNonceByParentId.set({});
    vi.mocked(syncJoinRequestsForSquad).mockClear();
    respondToSquadStateSyncRequest.mockClear();
    applySquadIdentityUpdated.mockClear();
    currentUser.set({ npub: 'npub1alice' });
    setCurrentNpubForPersistence('npub1alice');
    resetMutinyProcessTxStore();
    squadInfraByParentId.set({});
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

  it('refreshes infra from war_game_updated', () => {
    const handlers = {
      mergeTreasurySafesForParent: vi.fn(),
      mergeSquadInfraForParent: vi.fn(),
      mergeSquadMemberEvmForAnnouncementsGroup: vi.fn(),
    };
    onMlsStructuredMessage(
      JSON.stringify({
        type: 'war_game_updated',
        payload: {
          parent_id: 'g1',
          action: 'deploy',
          canonical_ref: '1',
          chain: 'sepolia',
          entry_id: 'pacto-gov-wargame-g1',
          round: '1',
          game_squad_id: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          sponsor: '0x5555555555555555555555555555555555555555',
          provider_payload: '{"status":"active"}',
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
    const raw = formatSquadNetworkUpdated({
      parentId: 'g1',
      pair: { primary: 'sepolia', practice: 'sepolia' },
    });
    onMlsStructuredMessage(raw, 'g1', handlers);
    expect(loadSquadNetworkPair('npub1alice', 'g1')).toEqual({ primary: 'sepolia', practice: 'sepolia' });
    expect(localStorage.getItem(`${SQUAD_NETWORK_PREFIX}_npub1alice`)).toBeTruthy();
  });

  it('does not apply untrusted practice=local from squad_network_updated', () => {
    const handlers = {
      mergeTreasurySafesForParent: vi.fn(),
      mergeSquadInfraForParent: vi.fn(),
      mergeSquadMemberEvmForAnnouncementsGroup: vi.fn(),
    };
    const raw = formatSquadNetworkUpdated({
      parentId: 'g1',
      pair: { primary: 'sepolia', practice: 'local' },
    });
    onMlsStructuredMessage(raw, 'g1', handlers);
    const stored = loadSquadNetworkPair('npub1alice', 'g1');
    expect(stored).toEqual({ primary: 'sepolia', practice: 'sepolia' });
    expect(resolvePracticeSquadNetwork({ override: stored?.practice, infraChain: null })).toBe(
      'sepolia',
    );
  });

  it('does not apply untrusted primary=local from squad_network_updated', () => {
    const handlers = {
      mergeTreasurySafesForParent: vi.fn(),
      mergeSquadInfraForParent: vi.fn(),
      mergeSquadMemberEvmForAnnouncementsGroup: vi.fn(),
    };
    const raw = formatSquadNetworkUpdated({
      parentId: 'g1',
      pair: { primary: 'local', practice: 'sepolia' },
    });
    onMlsStructuredMessage(raw, 'g1', handlers);
    expect(loadSquadNetworkPair('npub1alice', 'g1')).toEqual({
      primary: 'sepolia',
      practice: 'sepolia',
    });
  });

  it('applies practice=local from squad_network_updated when wargame infra is local', () => {
    squadInfraByParentId.set({
      g1: [
        {
          id: 'wg-1',
          parentId: 'g1',
          infraType: 'pacto_gov_wargame',
          chain: 'local',
          canonicalRef: '1',
          createdAtMs: 0,
          updatedAtMs: 0,
        },
      ],
    });
    const handlers = {
      mergeTreasurySafesForParent: vi.fn(),
      mergeSquadInfraForParent: vi.fn(),
      mergeSquadMemberEvmForAnnouncementsGroup: vi.fn(),
    };
    const raw = formatSquadNetworkUpdated({
      parentId: 'g1',
      pair: { primary: 'sepolia', practice: 'local' },
    });
    onMlsStructuredMessage(raw, 'g1', handlers);
    expect(loadSquadNetworkPair('npub1alice', 'g1')).toEqual({ primary: 'sepolia', practice: 'local' });
  });

  it('ignores squad_network_updated when parent_id mismatches groupId', () => {
    const handlers = {
      mergeTreasurySafesForParent: vi.fn(),
      mergeSquadInfraForParent: vi.fn(),
      mergeSquadMemberEvmForAnnouncementsGroup: vi.fn(),
    };
    const raw = formatSquadNetworkUpdated({
      parentId: 'other',
      pair: { primary: 'sepolia', practice: 'sepolia' },
    });
    onMlsStructuredMessage(raw, 'g1', handlers);
    expect(loadSquadNetworkPair('npub1alice', 'g1')).toBeNull();
    expect(loadSquadNetworkPair('npub1alice', 'other')).toBeNull();
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

  it('bumps governance process nonce', () => {
    const handlers = {
      mergeTreasurySafesForParent: vi.fn(),
      mergeSquadInfraForParent: vi.fn(),
      mergeSquadMemberEvmForAnnouncementsGroup: vi.fn(),
    };
    onMlsStructuredMessage(
      JSON.stringify({
        type: 'governance_process_updated',
        payload: { parent_id: 'g1', kind: 'qm_pending' },
      }),
      'g1',
      handlers,
    );
    expect(get(governanceProcessNonceByParentId).g1).toBe(1);
    expect(handlers.mergeSquadInfraForParent).not.toHaveBeenCalled();
  });

  it('bumps governance process nonce for hats kind', () => {
    const handlers = {
      mergeTreasurySafesForParent: vi.fn(),
      mergeSquadInfraForParent: vi.fn(),
      mergeSquadMemberEvmForAnnouncementsGroup: vi.fn(),
    };
    onMlsStructuredMessage(
      JSON.stringify({
        type: 'governance_process_updated',
        payload: { parent_id: 'g1', kind: 'hats' },
      }),
      'g1',
      handlers,
    );
    expect(get(governanceProcessNonceByParentId).g1).toBe(1);
  });

  it('records mutiny tx hash from governance_process_updated without overwriting start', () => {
    const handlers = {
      mergeTreasurySafesForParent: vi.fn(),
      mergeSquadInfraForParent: vi.fn(),
      mergeSquadMemberEvmForAnnouncementsGroup: vi.fn(),
    };
    const start = `0x${'aa'.repeat(32)}`;
    const vote = `0x${'bb'.repeat(32)}`;
    onMlsStructuredMessage(
      JSON.stringify({
        type: 'governance_process_updated',
        payload: { parent_id: 'g1', kind: 'mutiny', tx_hash: start },
      }),
      'g1',
      handlers,
    );
    onMlsStructuredMessage(
      JSON.stringify({
        type: 'governance_process_updated',
        payload: { parent_id: 'g1', kind: 'mutiny', tx_hash: vote },
      }),
      'g1',
      handlers,
    );
    expect(mutinyTxHashForCard(get(mutinyProcessTxByParentId), 'g1')).toBe(start);
    expect(get(mutinyProcessTxByParentId).g1.lastTxHash).toBe(vote);
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

  it('handles safe/evm announces, outbound invite types, and nonce fallbacks', () => {
    const handlers = {
      mergeTreasurySafesForParent: vi.fn(),
      mergeSquadInfraForParent: vi.fn(),
      mergeSquadMemberEvmForAnnouncementsGroup: vi.fn(),
    };

    onMlsStructuredMessage(null, 'g1', handlers);
    onMlsStructuredMessage('{', 'g1', handlers);

    onMlsStructuredMessage(
      JSON.stringify({
        type: 'squad_safe_updated',
        payload: { squad_id: 'safe-parent', safe_address: '0x1' },
      }),
      'g1',
      handlers,
    );
    expect(handlers.mergeTreasurySafesForParent).toHaveBeenCalledWith('safe-parent');

    onMlsStructuredMessage(
      JSON.stringify({
        type: 'squad_member_evm_share',
        payload: {
          parent_id: 'evm-parent',
          member_npub: 'npub1alice',
          evm_address: '0xabc',
          issued_at: 1710000000,
          signature: `0x${'ab'.repeat(65)}`,
        },
      }),
      'g1',
      handlers,
    );
    expect(handlers.mergeSquadMemberEvmForAnnouncementsGroup).toHaveBeenCalledWith('evm-parent');

    onMlsStructuredMessage(
      JSON.stringify({
        type: 'squad_evm_roster_snapshot',
        payload: {
          parent_id: 'g1',
          members: [
            {
              member_npub: 'npub1alice',
              evm_address: '0xabc',
              issued_at: 1710000000,
              signature: `0x${'ab'.repeat(65)}`,
            },
          ],
        },
      }),
      'g1',
      handlers,
    );
    expect(handlers.mergeSquadMemberEvmForAnnouncementsGroup).toHaveBeenCalledWith('g1');

    onMlsStructuredMessage(
      JSON.stringify({
        type: 'squad_outbound_invite',
        payload: {
          parent_id: 'g1',
          invite_id: 'i1',
          invitee_npub: 'npub1bob',
          squad_name: 'Alpha',
        },
        pacto_virtual_bucket: 'announcements',
      }),
      'g1',
      handlers,
    );
    onMlsStructuredMessage(
      JSON.stringify({
        type: 'squad_admit_needed',
        payload: { parent_id: 'g1', invite_id: 'i1', invitee_npub: 'npub1bob' },
        pacto_virtual_bucket: 'announcements',
      }),
      'g1',
      handlers,
    );
    onMlsStructuredMessage(
      JSON.stringify({
        type: 'squad_channels_catalog',
        payload: { parent_id: 'g1', channels: [] },
        pacto_virtual_bucket: 'announcements',
      }),
      'g1',
      handlers,
    );
    const identityRaw = JSON.stringify({
      type: 'squad_identity_updated',
      payload: { parent_id: 'g1', icon_url: 'https://cdn.example/a.jpg' },
      pacto_virtual_bucket: 'announcements',
    });
    onMlsStructuredMessage(identityRaw, 'g1', handlers);
    expect(applySquadIdentityUpdated).toHaveBeenCalledWith(identityRaw, 'g1');

    onMlsStructuredMessage(
      JSON.stringify({
        type: 'squad_contract_allowlist_updated',
        payload: { action: 'upsert' },
      }),
      'g1',
      handlers,
    );
    expect(get(squadAllowlistNonceByParentId).g1).toBe(1);

    onMlsStructuredMessage(
      JSON.stringify({
        type: 'squad_tracked_tokens_updated',
        payload: { action: 'upsert' },
      }),
      '  ',
      handlers,
    );

    onMlsStructuredMessage(
      JSON.stringify({
        schema: 'pacto.squad_bot.meta.v1',
        squad_id: 'bot-squad',
      }),
      'g1',
      handlers,
    );
    expect(get(squadBotMetaNonceBySquadId)['bot-squad']).toBe(1);

    onMlsStructuredMessage(
      JSON.stringify({
        schema: 'pacto.squad.join_request_response.v1',
        squad_id: 'join-squad',
      }),
      'g1',
      handlers,
    );
    expect(syncJoinRequestsForSquad).toHaveBeenCalledWith('join-squad');
  });
});
