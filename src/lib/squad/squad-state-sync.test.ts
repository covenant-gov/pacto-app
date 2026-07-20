import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  sendDmMessage,
  syncMlsGroupsNow,
  publishSquadMemberEvmShare,
  listSquadInfra,
  currentUser,
} = vi.hoisted(() => {
  const { writable: w } = require('svelte/store') as typeof import('svelte/store');
  return {
    sendDmMessage: vi.fn(),
    syncMlsGroupsNow: vi.fn(),
    publishSquadMemberEvmShare: vi.fn(),
    listSquadInfra: vi.fn(),
    currentUser: w<{ npub: string } | null>({ npub: 'npub1responder' }),
  };
});

vi.mock('../api/nostr', () => ({
  sendDmMessage: (...args: unknown[]) => sendDmMessage(...args),
  syncMlsGroupsNow: (...args: unknown[]) => syncMlsGroupsNow(...args),
}));

vi.mock('./squad-member-evm-share', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./squad-member-evm-share')>();
  return {
    ...actual,
    publishSquadMemberEvmShare: (...args: unknown[]) => publishSquadMemberEvmShare(...args),
  };
});

vi.mock('../governance/api', () => ({
  listSquadInfra: (...args: unknown[]) => listSquadInfra(...args),
  squadInfraLegacyProvider: (t: string) => (t === 'standalone_safe' ? 'gnosis_safe' : t),
}));

vi.mock('../../stores/auth', () => ({
  currentUser,
}));

import {
  formatSquadStateSyncRequest,
  parseSquadStateSyncRequest,
  requestSquadStateSync,
  resetSquadStateSyncRespondStateForTests,
  respondToSquadStateSyncRequest,
  SQUAD_STATE_SYNC_REQUEST_TYPE,
} from './squad-state-sync';

describe('squad-state-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSquadStateSyncRespondStateForTests();
    currentUser.set({ npub: 'npub1responder' });
    syncMlsGroupsNow.mockResolvedValue({ synced: 0, total: 0 });
    sendDmMessage.mockResolvedValue(undefined);
    publishSquadMemberEvmShare.mockResolvedValue(true);
    listSquadInfra.mockResolvedValue([]);
  });

  it('formats and parses a sync request', () => {
    const raw = formatSquadStateSyncRequest({
      parentId: 'ann-gid',
      requestId: 'req-1',
      requesterNpub: 'npub1joiner',
    });
    expect(JSON.parse(raw)).toMatchObject({
      type: SQUAD_STATE_SYNC_REQUEST_TYPE,
      pacto_virtual_bucket: 'announcements',
      payload: {
        parent_id: 'ann-gid',
        request_id: 'req-1',
        requester_npub: 'npub1joiner',
      },
    });
    expect(parseSquadStateSyncRequest(raw)).toEqual({
      parent_id: 'ann-gid',
      request_id: 'req-1',
      requester_npub: 'npub1joiner',
      requested: ['evm', 'infra'],
    });
  });

  it('publishes a request via requestSquadStateSync', async () => {
    await expect(requestSquadStateSync('ann-gid')).resolves.toBe(true);
    expect(syncMlsGroupsNow).toHaveBeenCalledWith('ann-gid');
    expect(sendDmMessage).toHaveBeenCalledWith(
      'ann-gid',
      expect.stringContaining(SQUAD_STATE_SYNC_REQUEST_TYPE),
      '',
      { virtualBucket: 'announcements' },
    );
  });

  it('ignores own sync request when responding', async () => {
    const raw = formatSquadStateSyncRequest({
      parentId: 'ann-gid',
      requestId: 'req-2',
      requesterNpub: 'npub1responder',
    });
    await respondToSquadStateSyncRequest(raw, 'ann-gid');
    expect(publishSquadMemberEvmShare).not.toHaveBeenCalled();
  });

  it('republishes EVM and announcements infra for peer requests', async () => {
    listSquadInfra.mockResolvedValueOnce([
      {
        id: 'gov-1',
        parentId: 'ann-gid',
        infraType: 'pacto_gov',
        chain: 'sepolia',
        canonicalRef: '42',
        providerPayload: '{}',
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      {
        id: 'safe-1',
        parentId: 'ann-gid',
        infraType: 'standalone_safe',
        chain: 'sepolia',
        canonicalRef: '0xabc',
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ]);
    const raw = formatSquadStateSyncRequest({
      parentId: 'ann-gid',
      requestId: 'req-3',
      requesterNpub: 'npub1joiner',
    });
    await respondToSquadStateSyncRequest(raw, 'ann-gid');
    expect(publishSquadMemberEvmShare).toHaveBeenCalledWith('ann-gid');
    const govCalls = sendDmMessage.mock.calls.filter((c) =>
      String(c[1]).includes('governance_updated'),
    );
    expect(govCalls).toHaveLength(1);
    expect(String(govCalls[0][1])).toContain('pacto_gov');
    expect(String(govCalls[0][1])).not.toContain('gnosis_safe');
  });

  it('debounces duplicate respond for the same request_id', async () => {
    const raw = formatSquadStateSyncRequest({
      parentId: 'ann-gid',
      requestId: 'req-4',
      requesterNpub: 'npub1joiner',
    });
    await respondToSquadStateSyncRequest(raw, 'ann-gid');
    await respondToSquadStateSyncRequest(raw, 'ann-gid');
    expect(publishSquadMemberEvmShare).toHaveBeenCalledTimes(1);
  });
});
