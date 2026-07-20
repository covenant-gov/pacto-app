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

import { onMlsStructuredMessage } from './mls-structured-refresh';
import {
  squadAllowlistNonceByParentId,
  squadBotMetaNonceBySquadId,
  squadTrackedTokensNonceByParentId,
} from '../../stores/navigation';
import { syncJoinRequestsForSquad } from '../../stores/squad-join-requests';
import { formatSquadStateSyncRequest } from '../squad/squad-state-sync';

describe('onMlsStructuredMessage', () => {
  beforeEach(() => {
    squadAllowlistNonceByParentId.set({});
    squadTrackedTokensNonceByParentId.set({});
    squadBotMetaNonceBySquadId.set({});
    vi.mocked(syncJoinRequestsForSquad).mockClear();
    respondToSquadStateSyncRequest.mockClear();
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
