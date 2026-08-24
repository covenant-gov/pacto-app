// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import GovHatsTreeCommandModals from './GovHatsTreeCommandModals.svelte';
import type { HatsTreeCommandContext } from '../../../lib/governance/hats-tree-role-actions';
import type { GovernancePrivilege } from '../../../lib/governance/governance-privilege';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

afterEach(() => cleanup());

const SELF = '0x1111111111111111111111111111111111111111';
const CREW = '0x2222222222222222222222222222222222222222';
const NON_CREW = '0x3333333333333333333333333333333333333333';

const CREW_PRIVILEGE: GovernancePrivilege = {
  myAddress: SELF,
  wearsCaptain: false,
  wearsCrew: true,
  captainIsSafe: false,
  roleLabel: 'Crew',
};

function command(overrides: Partial<HatsTreeCommandContext> = {}): HatsTreeCommandContext {
  return {
    privilege: CREW_PRIVILEGE,
    capabilitiesPending: false,
    mutinyStatus: null,
    qmStatus: null,
    treasuryAuthority: '0xta',
    mutinyModule: '0xmutiny',
    quartermaster: '0xqm',
    network: 'sepolia',
    parentId: 'parent-1',
    memberEvmOptions: [
      { address: SELF, label: 'charlie-test' },
      { address: CREW, label: 'bravo-test' },
      { address: NON_CREW, label: 'delta-test' },
    ],
    crewMemberOptions: [
      { address: SELF, label: 'charlie-test' },
      { address: CREW, label: 'bravo-test' },
    ],
    memberOptionsLoading: false,
    captainWearers: [],
    crewWearers: [SELF, CREW],
    warGameStack: false,
    refreshProposals: () => {},
    refreshMutiny: () => {},
    refreshQm: () => {},
    ...overrides,
  };
}

describe('GovHatsTreeCommandModals member pickers', () => {
  it('offboard lists crew-hat wearers, not the full roster', () => {
    render(GovHatsTreeCommandModals, {
      props: { command: command(), openAction: 'proposeOffboard' },
    });
    expect(screen.getByRole('option', { name: /bravo-test/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /delta-test/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /charlie-test/ })).toBeNull();
  });

  it('add crew omits existing crew-hat wearers', () => {
    render(GovHatsTreeCommandModals, {
      props: { command: command(), openAction: 'addCrew' },
    });
    expect(screen.getByRole('option', { name: /delta-test/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /bravo-test/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /charlie-test/ })).toBeNull();
  });

  it('remove crew lists crew-hat wearers only', () => {
    render(GovHatsTreeCommandModals, {
      props: { command: command(), openAction: 'removeCrew' },
    });
    expect(screen.getByRole('option', { name: /bravo-test/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /charlie-test/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /delta-test/ })).toBeNull();
  });
});
