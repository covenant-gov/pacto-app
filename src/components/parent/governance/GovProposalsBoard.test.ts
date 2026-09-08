// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import GovProposalsBoard from './GovProposalsBoard.svelte';
import type { GovernancePrivilege } from '../../../lib/governance/governance-privilege';
import type { TreasuryProposalDto } from '../../../lib/governance/api';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

afterEach(() => cleanup());

const CAPTAIN = '0xcaptain0000000000000000000000000000001';

const captainOnly: GovernancePrivilege = {
  myAddress: CAPTAIN,
  wearsCaptain: true,
  wearsCrew: false,
  captainIsSafe: false,
  roleLabel: 'Captain',
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

describe('GovProposalsBoard gate banners', () => {
  it('shows one crew-hat alert instead of per-card vote copy', () => {
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

    expect(screen.getByRole('alert').textContent).toBe('Crew hat required');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryAllByText('Crew hat required')).toHaveLength(1);
    expect(document.querySelectorAll('.gov-cta-reason')).toHaveLength(0);

    const voteYea = screen.getByRole('button', { name: 'Vote yea' }) as HTMLButtonElement;
    const voteNay = screen.getByRole('button', { name: 'Vote nay' }) as HTMLButtonElement;
    expect(voteYea.disabled).toBe(true);
    expect(voteNay.disabled).toBe(true);
  });
});
