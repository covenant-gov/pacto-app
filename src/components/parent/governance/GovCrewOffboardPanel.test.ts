// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import GovCrewOffboardPanel from './GovCrewOffboardPanel.svelte';
import type { QuartermasterStatusDto } from '../../../lib/governance/api';
import type { GovernancePrivilege } from '../../../lib/governance/governance-privilege';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

afterEach(() => cleanup());

const CREW_ADDR = '0x1111111111111111111111111111111111111111';
const OTHER_CREW = '0x2222222222222222222222222222222222222222';

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

function qm(overrides: Partial<QuartermasterStatusDto> = {}): QuartermasterStatusDto {
  return {
    crewChangeDelaySecs: '60',
    mutinyActive: false,
    activeCrewOffboardId: '0',
    crewOffboardExpirySecs: '300',
    crewOffboardQuorumBps: '3000',
    offboard: null,
    ...overrides,
  };
}

function offboardProps(overrides: Record<string, unknown> = {}) {
  return {
    network: 'sepolia',
    parentId: 'parent-1',
    quartermaster: '0xqm',
    privilege: CREW,
    memberEvmOptions: CREW_HAT_OPTIONS,
    ...overrides,
  };
}

describe('GovCrewOffboardPanel target picker', () => {
  it('lists crew-hat wearers except self', () => {
    render(GovCrewOffboardPanel, { props: offboardProps() });
    const target = screen.getByRole('combobox', { name: 'Target member' }) as HTMLSelectElement;
    expect(target.options).toHaveLength(1);
    expect(screen.getByRole('option', { name: /bravo-test/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /charlie-test/ })).toBeNull();
  });

  it('rehydrates target options after offboard clears', async () => {
    const { rerender } = render(GovCrewOffboardPanel, {
      props: offboardProps({
        qmStatus: qm({
          activeCrewOffboardId: '4',
          offboard: {
            offboardId: '4',
            target: OTHER_CREW,
            proposer: CREW_ADDR,
            deadline: 0,
            snapshot: 3,
            yeas: 1,
            nays: 0,
            executed: false,
          },
        }),
      }),
    });
    expect(screen.queryByRole('combobox', { name: 'Target member' })).toBeNull();

    await rerender(offboardProps({ qmStatus: qm({ activeCrewOffboardId: '0', offboard: null }) }));

    const target = screen.getByRole('combobox', { name: 'Target member' }) as HTMLSelectElement;
    expect(target.options).toHaveLength(1);
    expect(screen.getByRole('option', { name: /bravo-test/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /charlie-test/ })).toBeNull();
  });

  it('shows empty copy instead of a paste field when no other crew remain', async () => {
    const { rerender } = render(GovCrewOffboardPanel, { props: offboardProps() });
    expect(screen.getByRole('option', { name: /bravo-test/ })).toBeTruthy();

    await rerender(offboardProps({ memberEvmOptions: [] }));

    expect(screen.queryByRole('combobox', { name: 'Target member' })).toBeNull();
    expect(screen.queryByRole('option', { name: /bravo-test/ })).toBeNull();
    expect(screen.queryByPlaceholderText('0x… (share EVM on Status first)')).toBeNull();
    expect(
      screen.getAllByText('Need a crew-hat wearer with a bound squad EVM.').length,
    ).toBeGreaterThan(0);
  });

  it('shows loading copy while hat maps are in flight', () => {
    render(GovCrewOffboardPanel, {
      props: offboardProps({ memberEvmOptions: [], memberOptionsLoading: true }),
    });
    expect(screen.getByText('Loading members…')).toBeTruthy();
    expect(screen.queryByPlaceholderText('0x… (share EVM on Status first)')).toBeNull();
  });
});
