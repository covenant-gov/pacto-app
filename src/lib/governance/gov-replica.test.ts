import { describe, expect, it } from 'vitest';
import {
  parseGovReplicaSnapshot,
  pickReplicaRow,
  replicaSlicesFromSnapshot,
  replicaStackForDashboard,
  type SquadGovReplicaRow,
} from './gov-replica';

const hats: SquadGovReplicaRow = {
  parentId: 'g1',
  stack: 'pacto_gov',
  round: '',
  kind: 'hats',
  blockNumber: 12,
  txHash: '0x1',
  snapshotJson: '{"memberHatByAddress":{"0xaa":"Captain"}}',
  updatedAtMs: 1,
};

const game: SquadGovReplicaRow = {
  ...hats,
  stack: 'pacto_gov_wargame',
  round: '2',
  snapshotJson: '{"memberHatByAddress":{"0xbb":"Crew"}}',
};

describe('gov replica helpers', () => {
  it('parses snapshot JSON and rejects junk', () => {
    expect(parseGovReplicaSnapshot(hats.snapshotJson)?.memberHatByAddress).toEqual({
      '0xaa': 'Captain',
    });
    expect(parseGovReplicaSnapshot('')).toBeNull();
    expect(parseGovReplicaSnapshot('not-json')).toBeNull();
  });

  it('picks live vs wargame rows without merging', () => {
    expect(replicaStackForDashboard(false)).toBe('pacto_gov');
    expect(replicaStackForDashboard(true)).toBe('pacto_gov_wargame');
    expect(pickReplicaRow([hats, game], { stack: 'pacto_gov', kind: 'hats' })?.snapshotJson).toContain(
      '0xaa',
    );
    expect(
      pickReplicaRow([hats, game], { stack: 'pacto_gov_wargame', kind: 'hats', round: '2' })
        ?.snapshotJson,
    ).toContain('0xbb');
  });

  it('splits a writer snapshot into hats / process kinds', () => {
    const slices = replicaSlicesFromSnapshot({
      memberHatByAddress: { '0xaa': 'Captain' },
      treasuryProposals: [{ proposalId: '1' } as never],
      mutiny: { activeMutinyId: '2' } as never,
    });
    expect(slices.map((s) => s.kind)).toEqual(['hats', 'ta_proposal', 'mutiny']);
  });
});
