// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import GovCrewActions from './GovCrewActions.svelte';
import type { MutinyStatusDto } from '../../../lib/governance/api';
import type { GovernancePrivilege } from '../../../lib/governance/governance-privilege';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

afterEach(() => cleanup());

const CREW_ADDR = '0x1111111111111111111111111111111111111111';
const OTHER_CREW = '0x2222222222222222222222222222222222222222';
const NON_CREW = '0x3333333333333333333333333333333333333333';

const CREW: GovernancePrivilege = {
  myAddress: CREW_ADDR,
  wearsCaptain: false,
  wearsCrew: true,
  captainIsSafe: false,
  roleLabel: 'Crew',
};

const CREW_HAT_OPTIONS = [
  { address: CREW_ADDR, label: 'charlie-test' },
  { address: OTHER_CREW, label: 'bravo-test' },
];

const SQUAD_OPTIONS = [
  ...CREW_HAT_OPTIONS,
  { address: NON_CREW, label: 'delta-test' },
];

function mutiny(overrides: Partial<MutinyStatusDto> = {}): MutinyStatusDto {
  return {
    activeMutinyId: '9',
    proposedNewCaptain: OTHER_CREW,
    startedAt: 1,
    deadline: 0,
    snapshot: 3,
    yeas: 1,
    executed: false,
    captain: CREW_ADDR,
    ...overrides,
  };
}

function mutinyProps(overrides: Record<string, unknown> = {}) {
  return {
    network: 'sepolia',
    parentId: 'parent-1',
    treasuryAuthority: '',
    mutinyModule: '0xmutiny',
    privilege: CREW,
    memberEvmOptions: CREW_HAT_OPTIONS,
    squadMemberOptions: SQUAD_OPTIONS,
    ...overrides,
  };
}

function renderCrewMutiny(overrides: Record<string, unknown> = {}) {
  return render(GovCrewActions, { props: mutinyProps(overrides) });
}

describe('GovCrewActions mutiny start pickers', () => {
  it('lists crew-hat wearers for To crew member', () => {
    renderCrewMutiny();
    const kind = screen.getByRole('combobox', { name: 'Start mutiny' }) as HTMLSelectElement;
    expect(kind.value).toBe('crew');
    expect(screen.getByRole('option', { name: 'To Squad member' })).toBeTruthy();

    const proposed = screen.getByRole('combobox', { name: 'Proposed address' }) as HTMLSelectElement;
    expect(proposed.options).toHaveLength(2);
    expect(screen.getByRole('option', { name: /charlie-test/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /bravo-test/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /delta-test/ })).toBeNull();
  });

  it('lists MLS announcements members including non-crew for To Squad member', async () => {
    renderCrewMutiny();
    const kind = screen.getByRole('combobox', { name: 'Start mutiny' });
    await fireEvent.change(kind, { target: { value: 'eoa' } });

    const proposed = screen.getByRole('combobox', { name: 'Proposed address' }) as HTMLSelectElement;
    expect(proposed.options).toHaveLength(3);
    expect(screen.getByRole('option', { name: /charlie-test/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /bravo-test/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /delta-test/ })).toBeTruthy();
  });

  it('rehydrates crew options after mutiny clears without changing start kind', async () => {
    const { rerender } = renderCrewMutiny({ mutinyStatus: mutiny() });
    expect(screen.queryByRole('combobox', { name: 'Proposed address' })).toBeNull();

    await rerender(mutinyProps({ mutinyStatus: mutiny({ activeMutinyId: '0' }) }));

    const kind = screen.getByRole('combobox', { name: 'Start mutiny' }) as HTMLSelectElement;
    expect(kind.value).toBe('crew');
    const proposed = screen.getByRole('combobox', { name: 'Proposed address' }) as HTMLSelectElement;
    expect(proposed.options).toHaveLength(2);
    expect(screen.getByRole('option', { name: /charlie-test/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /bravo-test/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /delta-test/ })).toBeNull();
  });

  it('lists MLS members after expire then kind switch', async () => {
    const { rerender } = renderCrewMutiny({ mutinyStatus: mutiny() });
    await rerender(mutinyProps({ mutinyStatus: mutiny({ activeMutinyId: '0' }) }));

    const kind = screen.getByRole('combobox', { name: 'Start mutiny' });
    await fireEvent.change(kind, { target: { value: 'eoa' } });

    const proposed = screen.getByRole('combobox', { name: 'Proposed address' }) as HTMLSelectElement;
    expect(proposed.options).toHaveLength(3);
    expect(screen.getByRole('option', { name: /delta-test/ })).toBeTruthy();
  });

  it('clears leftover proposed when crew options are empty', async () => {
    const { rerender } = renderCrewMutiny();
    expect(screen.getByRole('option', { name: /bravo-test/ })).toBeTruthy();

    await rerender(mutinyProps({ memberEvmOptions: [] }));

    expect(screen.queryByRole('combobox', { name: 'Proposed address' })).toBeNull();
    expect(screen.queryByRole('option', { name: /bravo-test/ })).toBeNull();
    expect(
      screen.getAllByText('Need a crew-hat wearer with a bound squad EVM.').length,
    ).toBeGreaterThan(0);
  });
});
