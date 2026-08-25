import { describe, expect, it, vi } from 'vitest';

const { invoke, sendDmMessage } = vi.hoisted(() => ({
  invoke: vi.fn(),
  sendDmMessage: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

vi.mock('../api/nostr', () => ({
  sendDmMessage: (...args: unknown[]) => sendDmMessage(...args),
}));

import {
  certifiedRosterMembersFromRows,
  formatSquadEvmRosterSnapshot,
  parseSquadEvmRosterSnapshot,
  publishSquadEvmRosterSnapshot,
  SQUAD_EVM_ROSTER_SNAPSHOT_TYPE,
} from './squad-evm-roster-snapshot';

const SIG_A = `0x${'aa'.repeat(65)}`;
const SIG_B = `0x${'bb'.repeat(65)}`;

describe('squad-evm-roster-snapshot', () => {
  it('formats and parses a multi-member snapshot', () => {
    const raw = formatSquadEvmRosterSnapshot({
      parent_id: 'ann-gid',
      members: [
        {
          member_npub: 'npub1alice',
          evm_address: '0x1111111111111111111111111111111111111111',
          issued_at: 10,
          signature: SIG_A,
        },
        {
          member_npub: 'npub1bob',
          evm_address: '0x2222222222222222222222222222222222222222',
          issued_at: 11,
          signature: SIG_B,
        },
      ],
    });
    expect(JSON.parse(raw).type).toBe(SQUAD_EVM_ROSTER_SNAPSHOT_TYPE);
    const parsed = parseSquadEvmRosterSnapshot(raw);
    expect(parsed?.members).toHaveLength(2);
    expect(parsed?.members[0]?.member_npub).toBe('npub1alice');
    expect(parsed?.members[1]?.member_npub).toBe('npub1bob');
  });

  it('drops unsigned local rows from the gossip set', () => {
    const members = certifiedRosterMembersFromRows([
      {
        memberNpub: 'npub1alice',
        evmAddress: '0x1111111111111111111111111111111111111111',
        updatedAtMs: 1,
        issuedAt: 10,
        bindSignature: SIG_A,
      },
      {
        memberNpub: 'npub1legacy',
        evmAddress: '0x3333333333333333333333333333333333333333',
        updatedAtMs: 2,
        issuedAt: 0,
        bindSignature: '',
      },
    ]);
    expect(members).toHaveLength(1);
    expect(members[0]?.member_npub).toBe('npub1alice');
  });

  it('rejects invalid envelopes', () => {
    expect(parseSquadEvmRosterSnapshot(null)).toBeNull();
    expect(parseSquadEvmRosterSnapshot('plain')).toBeNull();
    expect(
      parseSquadEvmRosterSnapshot(JSON.stringify({ type: SQUAD_EVM_ROSTER_SNAPSHOT_TYPE, payload: {} })),
    ).toBeNull();
  });

  it('publishes a snapshot with two certified members', async () => {
    invoke.mockResolvedValueOnce([
      {
        memberNpub: 'npub1alice',
        evmAddress: '0x1111111111111111111111111111111111111111',
        updatedAtMs: 1,
        issuedAt: 10,
        bindSignature: SIG_A,
      },
      {
        memberNpub: 'npub1bob',
        evmAddress: '0x2222222222222222222222222222222222222222',
        updatedAtMs: 2,
        issuedAt: 11,
        bindSignature: SIG_B,
      },
    ]);
    sendDmMessage.mockResolvedValueOnce(undefined);
    await expect(publishSquadEvmRosterSnapshot('ann-gid')).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith('list_squad_member_evm', {
      parentId: 'ann-gid',
      altParentId: null,
    });
    const raw = String(sendDmMessage.mock.calls[0]?.[1]);
    const parsed = parseSquadEvmRosterSnapshot(raw);
    expect(parsed?.members).toHaveLength(2);
    expect(parsed?.members.map((m) => m.member_npub)).toEqual(['npub1alice', 'npub1bob']);
  });
});
