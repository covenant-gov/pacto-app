import { afterEach, describe, expect, it } from 'vitest';
import { keccak256 } from 'viem';
import type { TreasuryProposalDto } from './api';
import {
  hasTreasuryProposalCalldata,
  overlayTreasuryProposalCalldata,
  rememberTreasuryProposeCalldata,
  resetPendingTreasuryProposeCalldata,
  treasuryProposalsFromReplicaRows,
} from './treasury-proposal-calldata';

afterEach(() => {
  resetPendingTreasuryProposeCalldata();
});

function proposal(overrides: Partial<TreasuryProposalDto> = {}): TreasuryProposalDto {
  return {
    proposalId: '1',
    proposer: '0x1',
    to: '0x2',
    valueWei: '0',
    operation: 'call',
    dataHex: '',
    deadline: 1,
    snapshot: 1,
    yeas: 1,
    nays: 0,
    captainApproved: false,
    captainDefeated: false,
    executed: false,
    status: 'active',
    ...overrides,
  };
}

describe('hasTreasuryProposalCalldata', () => {
  it('treats empty as missing and 0x as present', () => {
    expect(hasTreasuryProposalCalldata('')).toBe(false);
    expect(hasTreasuryProposalCalldata('  ')).toBe(false);
    expect(hasTreasuryProposalCalldata(undefined)).toBe(false);
    expect(hasTreasuryProposalCalldata('0x')).toBe(true);
    expect(hasTreasuryProposalCalldata('0xabcd')).toBe(true);
  });
});

describe('overlayTreasuryProposalCalldata', () => {
  it('keeps chain dataHex when already present', () => {
    const chain = [proposal({ dataHex: '0x11' })];
    const out = overlayTreasuryProposalCalldata({
      chain,
      prior: [proposal({ dataHex: '0x22' })],
    });
    expect(out[0].dataHex).toBe('0x11');
  });

  it('copies prior calldata when the dataHash matches', () => {
    const dataHex = '0xdeadbeef';
    const chain = [proposal({ dataHex: '', dataHash: keccak256(dataHex) })];
    const out = overlayTreasuryProposalCalldata({
      chain,
      prior: [proposal({ dataHex })],
    });
    expect(out[0].dataHex).toBe(dataHex);
  });

  it('skips prior calldata when the dataHash does not match', () => {
    const chain = [proposal({ dataHex: '', dataHash: keccak256('0xaaaa') })];
    const out = overlayTreasuryProposalCalldata({
      chain,
      prior: [proposal({ dataHex: '0xbbbb' })],
    });
    expect(out[0].dataHex).toBe('');
  });

  it('applies extra calldata when the hash matches', () => {
    const extra = '0xabcd';
    const chain = [proposal({ proposalId: '3', dataHex: '', dataHash: keccak256(extra) })];
    const out = overlayTreasuryProposalCalldata({ chain, extraCalldata: extra });
    expect(out[0].dataHex).toBe(extra);
  });

  it('applies leftover extra to the newest row when chain has no dataHash', () => {
    const chain = [
      proposal({ proposalId: '2', dataHex: '' }),
      proposal({ proposalId: '9', dataHex: '' }),
    ];
    const out = overlayTreasuryProposalCalldata({
      chain,
      extraCalldata: '0xee',
    });
    expect(out.find((p) => p.proposalId === '9')?.dataHex).toBe('0xee');
    expect(out.find((p) => p.proposalId === '2')?.dataHex).toBe('');
  });

  it('overlays empty execute bytes from the propose stash', () => {
    rememberTreasuryProposeCalldata('g1', '0x');
    const chain = [proposal({ dataHex: '', dataHash: keccak256('0x') })];
    const out = overlayTreasuryProposalCalldata({ chain, parentId: 'g1' });
    expect(out[0].dataHex).toBe('0x');
  });
});

describe('treasuryProposalsFromReplicaRows', () => {
  it('prefers the newest replica row per proposalId', () => {
    const rows = [
      {
        parentId: 'g1',
        stack: 'pacto_gov',
        round: '',
        kind: 'ta_proposal',
        blockNumber: 1,
        txHash: '',
        snapshotJson: JSON.stringify({
          treasuryProposals: [proposal({ proposalId: '1', dataHex: '0x11' })],
        }),
        updatedAtMs: 1,
      },
      {
        parentId: 'g1',
        stack: 'pacto_gov',
        round: '',
        kind: 'ta_proposal',
        blockNumber: 2,
        txHash: '',
        snapshotJson: JSON.stringify({
          treasuryProposals: [proposal({ proposalId: '1', dataHex: '0x22' })],
        }),
        updatedAtMs: 9,
      },
    ];
    const prior = treasuryProposalsFromReplicaRows(rows);
    expect(prior).toHaveLength(1);
    expect(prior[0].dataHex).toBe('0x22');
  });
});
