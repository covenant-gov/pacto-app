// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import GovCrewActions from './GovCrewActions.svelte';
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

function renderCrewMutiny() {
  return render(GovCrewActions, {
    props: {
      network: 'sepolia',
      parentId: 'parent-1',
      treasuryAuthority: '',
      mutinyModule: '0xmutiny',
      privilege: CREW,
      memberEvmOptions: CREW_HAT_OPTIONS,
      squadMemberOptions: SQUAD_OPTIONS,
    },
  });
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
});
