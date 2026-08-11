import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const {
  sendDmMessage,
  syncMlsGroupsNow,
  publishSquadMemberEvmShare,
  publishSquadNetworkUpdated,
  publishSquadRpcUpdated,
  listSquadInfra,
  currentUser,
  publishSquadChannelsCatalog,
  getMlsGroupMembers,
  inviteMemberToGroup,
} = vi.hoisted(() => {
  /** Minimal writable stand-in so hoisted mocks avoid `require('svelte/store')`. */
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
  return {
    sendDmMessage: vi.fn(),
    syncMlsGroupsNow: vi.fn(),
    publishSquadMemberEvmShare: vi.fn(),
    publishSquadNetworkUpdated: vi.fn(),
    publishSquadRpcUpdated: vi.fn(),
    listSquadInfra: vi.fn(),
    publishSquadChannelsCatalog: vi.fn(),
    getMlsGroupMembers: vi.fn(),
    inviteMemberToGroup: vi.fn(),
    currentUser: makeStore<{ npub: string } | null>({ npub: 'npub1responder' }),
  };
});

vi.mock('../api/nostr', () => ({
  sendDmMessage: (...args: unknown[]) => sendDmMessage(...args),
  syncMlsGroupsNow: (...args: unknown[]) => syncMlsGroupsNow(...args),
  getMlsGroupMembers: (...args: unknown[]) => getMlsGroupMembers(...args),
  inviteMemberToGroup: (...args: unknown[]) => inviteMemberToGroup(...args),
  formatChannelInSquadMessage: () => 'channel-notify',
}));

vi.mock('./squad-channels-catalog', () => ({
  publishSquadChannelsCatalog: (...args: unknown[]) => publishSquadChannelsCatalog(...args),
}));

vi.mock('../parent-navbar', () => ({
  getAnnouncementsChannel: () => ({ name: 'announcements', groupId: 'ann-gid', order: 0 }),
}));

vi.mock('../../stores/squads', () => ({
  squads: {
    subscribe: (run: (v: unknown) => void) => {
      run([
        {
          id: 'ann-gid',
          name: 'Alpha',
          channels: [
            { name: 'announcements', groupId: 'ann-gid', order: 0 },
            { name: 'ops', groupId: 'g-ops', order: 1, access: 'open' },
          ],
          kind: 'squad',
          createdAt: 1,
          updatedAt: 1,
        },
      ]);
      return () => {};
    },
  },
}));
vi.mock('./squad-member-evm-share', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./squad-member-evm-share')>();
  return {
    ...actual,
    publishSquadMemberEvmShare: (...args: unknown[]) => publishSquadMemberEvmShare(...args),
  };
});

vi.mock('./squad-network-share', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./squad-network-share')>();
  return {
    ...actual,
    publishSquadNetworkUpdated: (...args: unknown[]) => publishSquadNetworkUpdated(...args),
  };
});

vi.mock('./squad-rpc-share', () => ({
  publishSquadRpcUpdated: (...args: unknown[]) => publishSquadRpcUpdated(...args),
}));

vi.mock('../governance/api', () => ({
  listSquadInfra: (...args: unknown[]) => listSquadInfra(...args),
  squadInfraLegacyProvider: (t: string) => (t === 'standalone_safe' ? 'gnosis_safe' : t),
}));

vi.mock('../../stores/auth', () => ({
  currentUser,
}));

import {
  formatSquadStateSyncRequest,
  isSquadStateSyncInFlight,
  maybeAutoRequestSquadStateSyncAfterJoin,
  parseSquadStateSyncRequest,
  requestSquadStateSync,
  resetSquadStateSyncRequestInFlight,
  resetSquadStateSyncRespondStateForTests,
  respondToSquadStateSyncRequest,
  SQUAD_STATE_SYNC_REQUEST_TYPE,
} from './squad-state-sync';

describe('squad-state-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSquadStateSyncRespondStateForTests();
    resetSquadStateSyncRequestInFlight();
    currentUser.set({ npub: 'npub1responder' });
    syncMlsGroupsNow.mockResolvedValue({ synced: 0, total: 0 });
    sendDmMessage.mockResolvedValue(undefined);
    publishSquadMemberEvmShare.mockResolvedValue(true);
    publishSquadNetworkUpdated.mockResolvedValue(true);
    publishSquadRpcUpdated.mockResolvedValue(true);
    publishSquadChannelsCatalog.mockResolvedValue(true);
    getMlsGroupMembers.mockResolvedValue({ group_id: 'g', members: [], admins: [] });
    inviteMemberToGroup.mockResolvedValue(undefined);
    listSquadInfra.mockResolvedValue([]);
    const session = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => session.get(k) ?? null,
      setItem: (k: string, v: string) => {
        session.set(k, v);
      },
      removeItem: (k: string) => {
        session.delete(k);
      },
      clear: () => session.clear(),
      key: () => null,
      get length() {
        return session.size;
      },
    } as Storage);
  });

  afterEach(() => {
    resetSquadStateSyncRequestInFlight();
    vi.unstubAllGlobals();
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
      requested: ['evm', 'infra', 'network', 'rpc', 'channels'],
    });
  });

  it('rejects invalid sync request envelopes', () => {
    expect(parseSquadStateSyncRequest(null)).toBeNull();
    expect(parseSquadStateSyncRequest(undefined)).toBeNull();
    expect(parseSquadStateSyncRequest(12 as unknown as string)).toBeNull();
    expect(parseSquadStateSyncRequest('plain')).toBeNull();
    expect(parseSquadStateSyncRequest('{')).toBeNull();
    expect(parseSquadStateSyncRequest('null')).toBeNull();
    expect(parseSquadStateSyncRequest(JSON.stringify({ type: 'other' }))).toBeNull();
    expect(
      parseSquadStateSyncRequest(JSON.stringify({ type: SQUAD_STATE_SYNC_REQUEST_TYPE, payload: null })),
    ).toBeNull();
    expect(
      parseSquadStateSyncRequest(
        JSON.stringify({
          type: SQUAD_STATE_SYNC_REQUEST_TYPE,
          payload: { parent_id: '', request_id: 'r', requester_npub: 'n' },
        }),
      ),
    ).toBeNull();
    expect(
      parseSquadStateSyncRequest(
        JSON.stringify({
          type: SQUAD_STATE_SYNC_REQUEST_TYPE,
          payload: {
            parent_id: 'p',
            request_id: 'r',
            requester_npub: 'n',
            requested: ['evm', 2, 'infra'],
          },
        }),
      ),
    ).toEqual({
      parent_id: 'p',
      request_id: 'r',
      requester_npub: 'n',
      requested: ['evm', 'infra'],
    });
    expect(
      parseSquadStateSyncRequest(
        JSON.stringify({
          type: SQUAD_STATE_SYNC_REQUEST_TYPE,
          payload: { parent_id: 'p', request_id: 'r', requester_npub: 'n' },
        }),
      )?.requested,
    ).toBeUndefined();
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

  it('marks sync request in-flight during publish and no-ops concurrent calls', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    sendDmMessage.mockImplementation(async () => {
      expect(isSquadStateSyncInFlight('ann-gid')).toBe(true);
      await gate;
    });

    const pending = requestSquadStateSync('ann-gid');
    await vi.waitFor(() => expect(isSquadStateSyncInFlight('ann-gid')).toBe(true));
    await expect(requestSquadStateSync('ann-gid')).resolves.toBe(false);
    expect(sendDmMessage).toHaveBeenCalledTimes(1);

    release();
    await expect(pending).resolves.toBe(true);
    expect(isSquadStateSyncInFlight('ann-gid')).toBe(false);
  });

  it('requestSquadStateSync handles empty gid, missing user, and publish failures', async () => {
    await expect(requestSquadStateSync('  ')).resolves.toBe(false);
    currentUser.set(null);
    await expect(requestSquadStateSync('ann-gid')).resolves.toBe(false);
    currentUser.set({ npub: 'npub1responder' });
    syncMlsGroupsNow.mockRejectedValueOnce(new Error('offline'));
    sendDmMessage.mockRejectedValueOnce(new Error('relay down'));
    await expect(requestSquadStateSync('ann-gid')).resolves.toBe(false);
  });

  it('maybeAutoRequestSquadStateSyncAfterJoin runs once per session', async () => {
    await maybeAutoRequestSquadStateSyncAfterJoin('  ');
    expect(sendDmMessage).not.toHaveBeenCalled();
    await maybeAutoRequestSquadStateSyncAfterJoin('ann-gid');
    expect(sendDmMessage).toHaveBeenCalledTimes(1);
    await maybeAutoRequestSquadStateSyncAfterJoin('ann-gid');
    expect(sendDmMessage).toHaveBeenCalledTimes(1);
  });

  it('ignores own sync request when responding', async () => {
    const raw = formatSquadStateSyncRequest({
      parentId: 'ann-gid',
      requestId: 'req-2',
      requesterNpub: 'npub1responder',
    });
    await respondToSquadStateSyncRequest(raw, 'ann-gid');
    expect(publishSquadMemberEvmShare).not.toHaveBeenCalled();
    expect(publishSquadNetworkUpdated).not.toHaveBeenCalled();
  });

  it('republishes EVM, announcements infra, and network for peer requests', async () => {
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
    expect(publishSquadNetworkUpdated).toHaveBeenCalledWith('ann-gid');
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
    expect(publishSquadNetworkUpdated).toHaveBeenCalledTimes(1);
  });

  it('ignores sync requests whose parent_id differs from the MLS groupId', async () => {
    const raw = formatSquadStateSyncRequest({
      parentId: 'other-parent',
      requestId: 'req-5',
      requesterNpub: 'npub1joiner',
    });
    await respondToSquadStateSyncRequest(raw, 'ann-gid');
    expect(publishSquadMemberEvmShare).not.toHaveBeenCalled();
    expect(publishSquadNetworkUpdated).not.toHaveBeenCalled();
    expect(listSquadInfra).not.toHaveBeenCalled();
  });

  it('allows retry when republish fails without recording cooldown', async () => {
    publishSquadMemberEvmShare.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    publishSquadNetworkUpdated.mockResolvedValue(false);
    publishSquadRpcUpdated.mockResolvedValue(false);
    publishSquadChannelsCatalog.mockResolvedValue(false);
    inviteMemberToGroup.mockRejectedValue(new Error('skip'));
    listSquadInfra.mockResolvedValue([]);
    const raw = formatSquadStateSyncRequest({
      parentId: 'ann-gid',
      requestId: 'req-6',
      requesterNpub: 'npub1joiner',
    });
    await respondToSquadStateSyncRequest(raw, 'ann-gid');
    await respondToSquadStateSyncRequest(raw, 'ann-gid');
    expect(publishSquadMemberEvmShare).toHaveBeenCalledTimes(2);
  });

  it('responds to infra-only requests and skips admit when already a member', async () => {
    listSquadInfra.mockResolvedValueOnce([]);
    getMlsGroupMembers.mockResolvedValueOnce({
      group_id: 'g-ops',
      members: ['npub1joiner'],
      admins: [],
    });
    const raw = JSON.stringify({
      type: SQUAD_STATE_SYNC_REQUEST_TYPE,
      payload: {
        parent_id: 'ann-gid',
        request_id: 'req-infra',
        requester_npub: 'npub1joiner',
        requested: ['infra', 'channels'],
      },
    });
    await respondToSquadStateSyncRequest(raw, 'ann-gid');
    expect(publishSquadMemberEvmShare).not.toHaveBeenCalled();
    expect(publishSquadNetworkUpdated).not.toHaveBeenCalled();
    expect(publishSquadChannelsCatalog).toHaveBeenCalled();
    expect(inviteMemberToGroup).not.toHaveBeenCalled();
  });
});
