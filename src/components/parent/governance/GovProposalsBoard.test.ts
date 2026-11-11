// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import GovProposalsBoard from './GovProposalsBoard.svelte';
import type { GovernancePrivilege } from '../../../lib/governance/governance-privilege';
import type { MutinyStatusDto, TreasuryProposalDto } from '../../../lib/governance/api';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

afterEach(() => cleanup());

const CAPTAIN = '0xcaptain0000000000000000000000000000001';
const CREW = '0xcrew00000000000000000000000000000000001';

const captainOnly: GovernancePrivilege = {
  myAddress: CAPTAIN,
  wearsCaptain: true,
  wearsCrew: false,
  captainIsSafe: false,
  roleLabel: 'Captain',
};

const crewOnly: GovernancePrivilege = {
  myAddress: CREW,
  wearsCaptain: false,
  wearsCrew: true,
  captainIsSafe: false,
  roleLabel: 'Crew',
};

function treasuryProposal(overrides: Partial<TreasuryProposalDto> = {}): TreasuryProposalDto {
  return {
    proposalId: '1',
    proposer: CAPTAIN,
    to: '0x2222222222222222222222222222222222222222',
    valueWei: '0',
    operation: 'CALL',
    dataHex: '0x',
    deadline: 1_800_000_000,
    snapshot: 3,
    yeas: 0,
    nays: 0,
    status: 'active',
    executed: false,
    captainApproved: false,
    captainDefeated: false,
    ...overrides,
  };
}

function mutinyStatus(overrides: Partial<MutinyStatusDto> = {}): MutinyStatusDto {
  return {
    activeMutinyId: '1',
    proposedNewCaptain: CREW,
    fromCaptain: CAPTAIN,
    startedAt: 1,
    deadline: 1_800_000_000,
    snapshot: 3,
    yeas: 1,
    executed: false,
    captain: CAPTAIN,
    ...overrides,
  };
}

describe('GovProposalsBoard gate banners', () => {
  it('shows a per-card crew-hat note instead of a board alert', () => {
    render(GovProposalsBoard, {
      props: {
        network: 'sepolia',
        parentId: 'parent1',
        treasuryAuthority: '0xta00000000000000000000000000000000001',
        quartermaster: '0xqm00000000000000000000000000000000001',
        privilege: captainOnly,
        proposals: [treasuryProposal()],
      },
    });

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Crew hat required');
    expect(screen.queryAllByText('Crew hat required')).toHaveLength(1);
    expect(document.querySelectorAll('.gov-cta-reason')).toHaveLength(0);

    const voteYea = screen.getByRole('button', { name: 'Vote yea' }) as HTMLButtonElement;
    const voteNay = screen.getByRole('button', { name: 'Vote nay' }) as HTMLButtonElement;
    expect(voteYea.disabled).toBe(true);
    expect(voteNay.disabled).toBe(true);
  });

  it('shows no hat note when there are no open proposals', () => {
    render(GovProposalsBoard, {
      props: {
        network: 'sepolia',
        parentId: 'parent1',
        treasuryAuthority: '0xta00000000000000000000000000000000001',
        privilege: captainOnly,
        proposals: [],
      },
    });

    expect(screen.queryByText('Crew hat required')).toBeNull();
    expect(screen.queryByText('Captain hat required')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('No open proposals.')).toBeTruthy();
  });

  it('does not show captain hat note for a crew wearer on an open mutiny', () => {
    render(GovProposalsBoard, {
      props: {
        network: 'sepolia',
        parentId: 'parent1',
        treasuryAuthority: '0xta00000000000000000000000000000000001',
        privilege: crewOnly,
        proposals: [],
        mutinyStatus: mutinyStatus(),
      },
    });

    expect(screen.queryByText('Captain hat required')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText(/Mutiny #1/)).toBeTruthy();
  });

  it('defaults to open proposals and shows executed ones on that filter', async () => {
    render(GovProposalsBoard, {
      props: {
        network: 'sepolia',
        parentId: 'parent1',
        treasuryAuthority: '0xta00000000000000000000000000000000001',
        privilege: captainOnly,
        proposals: [
          treasuryProposal({ proposalId: '1', status: 'active' }),
          treasuryProposal({ proposalId: '2', status: 'executed', executed: true }),
        ],
      },
    });

    expect(screen.getByText('Proposal #1')).toBeTruthy();
    expect(screen.queryByText('Proposal #2')).toBeNull();

    await fireEvent.click(screen.getByRole('radio', { name: 'Executed' }));

    expect(screen.queryByText('Proposal #1')).toBeNull();
    expect(screen.getByText('Proposal #2')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Execute' })).toBeNull();
  });
});
