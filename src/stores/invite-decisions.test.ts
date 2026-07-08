import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  INVITE_DECISION_SCOPED_PREFIXES,
  initInviteDecisionPersistence,
  getInviteDecisionLoadEntries,
  acceptedSquadInviteIds,
  declinedSquadInviteIds,
  acceptedChannelInviteMessageIds,
  declinedChannelInviteMessageIds,
  declinedWalletTxRequestMessageIds,
  acceptedWalletPeerInfoRequestMessageIds,
  declinedWalletPeerInfoRequestMessageIds,
} from './invite-decisions';

function makeGetKey(prefix: string): string | null {
  return `test_${prefix}`;
}

describe('invite-decisions', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
      key: (i: number) => [...storage.keys()][i] ?? null,
      get length() {
        return storage.size;
      },
    } as Storage);
    initInviteDecisionPersistence(makeGetKey);
  });

  afterEach(() => {
    acceptedSquadInviteIds.set([]);
    declinedSquadInviteIds.set([]);
    acceptedChannelInviteMessageIds.set([]);
    declinedChannelInviteMessageIds.set([]);
    declinedWalletTxRequestMessageIds.set([]);
    acceptedWalletPeerInfoRequestMessageIds.set([]);
    declinedWalletPeerInfoRequestMessageIds.set([]);
    vi.unstubAllGlobals();
  });

  it('does not persist removed squad invite EVM share prefixes', () => {
    const prefixes = INVITE_DECISION_SCOPED_PREFIXES as readonly string[];
    expect(prefixes).not.toContain('pacto_squad_invite_evm_shared');
    expect(prefixes).not.toContain('pacto_squad_invite_evm_skipped');
  });

  it('writes each invite decision list to localStorage when changed', () => {
    acceptedSquadInviteIds.set(['s1', 's2']);
    declinedSquadInviteIds.set(['s3']);
    acceptedChannelInviteMessageIds.set(['m1']);
    declinedChannelInviteMessageIds.set(['m2']);
    declinedWalletTxRequestMessageIds.set(['m3']);
    acceptedWalletPeerInfoRequestMessageIds.set(['m4']);
    declinedWalletPeerInfoRequestMessageIds.set(['m5']);

    expect(JSON.parse(storage.get('test_pacto_invite_accepted_squad') ?? '[]')).toEqual(['s1', 's2']);
    expect(JSON.parse(storage.get('test_pacto_invite_declined_squad') ?? '[]')).toEqual(['s3']);
    expect(JSON.parse(storage.get('test_pacto_invite_accepted_channel') ?? '[]')).toEqual(['m1']);
    expect(JSON.parse(storage.get('test_pacto_invite_declined_channel') ?? '[]')).toEqual(['m2']);
    expect(JSON.parse(storage.get('test_pacto_wallet_tx_request_declined') ?? '[]')).toEqual(['m3']);
    expect(JSON.parse(storage.get('test_pacto_wallet_peer_info_request_accepted') ?? '[]')).toEqual(['m4']);
    expect(JSON.parse(storage.get('test_pacto_wallet_peer_info_request_declined') ?? '[]')).toEqual(['m5']);
  });

  it('returns load entries that hydrate stores from localStorage keys', () => {
    const npub = 'npub1abc';
    const entries = getInviteDecisionLoadEntries(npub);
    expect(entries).toHaveLength(INVITE_DECISION_SCOPED_PREFIXES.length);

    const expectedPrefixes = INVITE_DECISION_SCOPED_PREFIXES.map((p) => `${p}_${npub}`);
    const actualPrefixes = entries.map(([key]) => key);
    expect(actualPrefixes).toEqual(expectedPrefixes);

    // Apply a value through each setter and verify the corresponding store updates.
    entries.forEach(([, setStore], index) => {
      setStore([`id-${index}`]);
    });

    expect(get(acceptedSquadInviteIds)).toEqual(['id-0']);
    expect(get(declinedSquadInviteIds)).toEqual(['id-1']);
    expect(get(acceptedChannelInviteMessageIds)).toEqual(['id-2']);
    expect(get(declinedChannelInviteMessageIds)).toEqual(['id-3']);
    expect(get(declinedWalletTxRequestMessageIds)).toEqual(['id-4']);
    expect(get(acceptedWalletPeerInfoRequestMessageIds)).toEqual(['id-5']);
    expect(get(declinedWalletPeerInfoRequestMessageIds)).toEqual(['id-6']);
  });
});
