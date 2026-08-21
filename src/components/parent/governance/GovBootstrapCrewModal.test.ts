// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import GovBootstrapCrewModal from './GovBootstrapCrewModal.svelte';
import type { GovernancePrivilege } from '../../../lib/governance/governance-privilege';

vi.mock('../../../lib/governance/api', () => ({
  quartermasterBootstrapCrew: vi.fn(),
}));

afterEach(() => cleanup());

const CAPTAIN: GovernancePrivilege = {
  myAddress: '0xcaptain000000000000000000000000000001',
  wearsCaptain: true,
  wearsCrew: false,
  captainIsSafe: false,
  roleLabel: 'Captain',
};

const MEMBERS = [
  { address: '0xaaaa000000000000000000000000000000aaa1', label: 'Alice' },
  { address: '0xbbbb000000000000000000000000000000bbb2', label: 'Bob' },
];

function props(open: boolean) {
  return {
    open,
    onClose: vi.fn(),
    network: 'sepolia',
    parentId: 'parent-1',
    quartermaster: '0xquartermaster',
    privilege: CAPTAIN,
    memberOptions: MEMBERS,
    captainAddresses: [CAPTAIN.myAddress],
  };
}

describe('GovBootstrapCrewModal', () => {
  it('defaults to every eligible crew member selected on open', () => {
    render(GovBootstrapCrewModal, { props: props(true) });
    const alice = screen.getByRole('checkbox', { name: /Alice/ }) as HTMLInputElement;
    const bob = screen.getByRole('checkbox', { name: /Bob/ }) as HTMLInputElement;
    expect(alice.checked).toBe(true);
    expect(bob.checked).toBe(true);
  });

  it('discards a stale deselection when the modal is closed and reopened, instead of resubmitting it', async () => {
    const { rerender } = render(GovBootstrapCrewModal, { props: props(true) });
    const bobCheckbox = () => screen.getByRole('checkbox', { name: /Bob/ }) as HTMLInputElement;

    await fireEvent.click(bobCheckbox());
    expect(bobCheckbox().checked).toBe(false);

    await rerender(props(false));
    await rerender(props(true));

    expect(bobCheckbox().checked).toBe(true);
  });
});
