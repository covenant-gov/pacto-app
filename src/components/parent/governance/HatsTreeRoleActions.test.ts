// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import HatsTreeRoleActions from './HatsTreeRoleActions.svelte';
import type { HatsTreeCommandContext } from '../../../lib/governance/hats-tree-role-actions';
import type { GovernancePrivilege } from '../../../lib/governance/governance-privilege';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

afterEach(() => cleanup());

const ADDR = '0x1111111111111111111111111111111111111111';

function privilege(overrides: Partial<GovernancePrivilege> = {}): GovernancePrivilege {
  return {
    myAddress: ADDR,
    wearsCaptain: false,
    wearsCrew: false,
    captainIsSafe: false,
    roleLabel: 'governance.roleLabel.noOnChainHat',
    ...overrides,
  };
}

function command(overrides: Partial<HatsTreeCommandContext> = {}): HatsTreeCommandContext {
  return {
    privilege: privilege(),
    capabilitiesPending: false,
    mutinyStatus: null,
    qmStatus: null,
    treasuryAuthority: '0xta',
    mutinyModule: '0xmutiny',
    quartermaster: '0xqm',
    network: 'sepolia',
    parentId: 'parent-1',
    memberEvmOptions: [],
    crewMemberOptions: [],
    memberOptionsLoading: false,
    captainWearers: [],
    crewWearers: [],
    warGameStack: false,
    refreshProposals: () => {},
    refreshMutiny: () => {},
    refreshQm: () => {},
    ...overrides,
  };
}

function buttonNamed(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

describe('HatsTreeRoleActions', () => {
  it('enables crew quartermaster offboard and disables captain add/remove', () => {
    render(HatsTreeRoleActions, {
      props: {
        kind: 'quartermaster',
        command: command({
          privilege: privilege({ wearsCrew: true, roleLabel: 'governance.roleLabel.crew' }),
        }),
      },
    });
    expect(buttonNamed('Add crew').disabled).toBe(true);
    expect(buttonNamed('Remove crew').disabled).toBe(true);
    expect(buttonNamed('Propose offboard').disabled).toBe(false);
  });

  it('enables mutiny start for crew and keeps resign disabled', () => {
    render(HatsTreeRoleActions, {
      props: {
        kind: 'mutiny',
        command: command({
          privilege: privilege({ wearsCrew: true, roleLabel: 'governance.roleLabel.crew' }),
        }),
      },
    });
    expect(buttonNamed('Start mutiny').disabled).toBe(false);
    expect(buttonNamed('Resign captain').disabled).toBe(true);
  });

  it('enables treasury actions for either hat', () => {
    render(HatsTreeRoleActions, {
      props: {
        kind: 'treasury',
        command: command({
          privilege: privilege({ wearsCaptain: true, roleLabel: 'governance.roleLabel.captain' }),
        }),
      },
    });
    expect(buttonNamed('Submit proposal').disabled).toBe(false);
    expect(buttonNamed('Vote mode').disabled).toBe(false);
  });

  it('disables every tree CTA when the viewer wears no hat', () => {
    const ctx = command();
    const { rerender } = render(HatsTreeRoleActions, {
      props: { kind: 'treasury', command: ctx },
    });
    expect(buttonNamed('Submit proposal').disabled).toBe(true);
    expect(buttonNamed('Vote mode').disabled).toBe(true);

    rerender({ kind: 'mutiny', command: ctx });
    expect(buttonNamed('Start mutiny').disabled).toBe(true);
    expect(buttonNamed('Resign captain').disabled).toBe(true);

    rerender({ kind: 'quartermaster', command: ctx });
    expect(buttonNamed('Add crew').disabled).toBe(true);
    expect(buttonNamed('Remove crew').disabled).toBe(true);
    expect(buttonNamed('Propose offboard').disabled).toBe(true);
  });
});
