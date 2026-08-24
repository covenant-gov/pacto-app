// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import GovCaptainRosterModal from './GovCaptainRosterModal.svelte';
import type { CtaGate } from '../../../lib/governance/governance-privilege';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

afterEach(() => cleanup());

const CREW = '0x1111111111111111111111111111111111111111';
const CANDIDATE = '0x2222222222222222222222222222222222222222';

const OPEN_GATE: CtaGate = { enabled: true, reason: '' };

function rosterProps(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    mode: 'add' as const,
    network: 'sepolia',
    parentId: 'parent-1',
    quartermaster: '0xqm',
    memberEvmOptions: [{ address: CANDIDATE, label: 'delta-test' }],
    emptyKey: 'governance.gate.noSquadMemberToAdd',
    qmGate: OPEN_GATE,
    execGate: OPEN_GATE,
    ...overrides,
  };
}

describe('GovCaptainRosterModal member picker', () => {
  it('lists add-crew candidates and omits existing crew when the parent filtered the list', () => {
    render(GovCaptainRosterModal, {
      props: rosterProps({
        memberEvmOptions: [
          { address: CANDIDATE, label: 'delta-test' },
        ],
      }),
    });
    expect(screen.getByRole('option', { name: /delta-test/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /charlie-test/ })).toBeNull();
  });

  it('lists only crew-hat wearers for remove', () => {
    render(GovCaptainRosterModal, {
      props: rosterProps({
        mode: 'remove',
        emptyKey: 'governance.gate.noCrewHatToRemove',
        memberEvmOptions: [{ address: CREW, label: 'charlie-test' }],
      }),
    });
    expect(screen.getByRole('option', { name: /charlie-test/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /delta-test/ })).toBeNull();
  });

  it('shows empty copy instead of a paste field', () => {
    render(GovCaptainRosterModal, {
      props: rosterProps({ memberEvmOptions: [] }),
    });
    expect(screen.queryByRole('combobox', { name: 'Target member' })).toBeNull();
    expect(screen.queryByPlaceholderText('0x… (share EVM on Status first)')).toBeNull();
    expect(
      screen.getByText('Need a squad member with a bound squad EVM who is not already crew.'),
    ).toBeTruthy();
  });
});
