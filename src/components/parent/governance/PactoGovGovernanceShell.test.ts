// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import PactoGovGovernanceShell from './PactoGovGovernanceShell.svelte';
import { getSquadCapabilities } from '../../../lib/governance/api';
import { fetchEvmBalance } from '../../../lib/wallet/signer-balance';
import type { SquadCapabilitiesDto } from '../../../lib/governance/api';
import type { PactoGovProviderPayloadV1 } from '../../../lib/governance/pacto-gov-payload';

vi.mock('../../../lib/governance/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/governance/api')>();
  return { ...actual, getSquadCapabilities: vi.fn() };
});

vi.mock('../../../lib/wallet/signer-balance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/wallet/signer-balance')>();
  return { ...actual, fetchEvmBalance: vi.fn() };
});

const mockedGetSquadCapabilities = vi.mocked(getSquadCapabilities);
const mockedFetchEvmBalance = vi.mocked(fetchEvmBalance);

const CAPTAIN_ADDRESS = '0xcaptain0000000000000000000000000000001';

function basePayload(): PactoGovProviderPayloadV1 {
  return {
    safe: '0xsafe000000000000000000000000000000000',
    treasuryAuthority: '0xta00000000000000000000000000000000001',
    quartermaster: '',
    mutinyModule: '',
  };
}

function capabilitiesSnapshot(overrides: Partial<SquadCapabilitiesDto> = {}): SquadCapabilitiesDto {
  return {
    parentId: 'parent1',
    rosterAddress: CAPTAIN_ADDRESS,
    wearsCaptain: true,
    wearsCrew: false,
    captainIsSafe: false,
    squadAdminFull: false,
    squadAdminPaused: false,
    roleLabel: 'Captain',
    capabilities: {},
    ...overrides,
  };
}

describe('PactoGovGovernanceShell capability preflight gating', () => {
  beforeEach(() => {
    mockedGetSquadCapabilities.mockReset();
    mockedFetchEvmBalance.mockReset();
    mockedFetchEvmBalance.mockResolvedValue({
      balanceRaw: '0',
      balanceDecimal: '0',
      symbol: 'ETH',
      loading: false,
      error: '',
    });
  });

  it('keeps the propose action unavailable while capabilities are unresolved, then enables it once resolved', async () => {
    const { promise: capabilitiesPromise, resolve: resolveCapabilities } =
      Promise.withResolvers<SquadCapabilitiesDto>();
    mockedGetSquadCapabilities.mockReturnValue(capabilitiesPromise);

    render(PactoGovGovernanceShell, {
      props: {
        payload: basePayload(),
        network: 'sepolia',
        parentId: 'parent1',
        myAddress: CAPTAIN_ADDRESS,
        captainWearers: [CAPTAIN_ADDRESS],
        crewWearers: [],
      },
    });

    await fireEvent.click(await screen.findByRole('tab', { name: 'Captain' }));

    const submitButton = (await screen.findByRole('button', {
      name: 'Submit proposal',
    })) as HTMLButtonElement;

    // The hat check alone would already allow this captain — but the ACL preflight
    // hasn't settled, so the action must render unavailable, not permitted.
    expect(submitButton.disabled).toBe(true);
    expect(submitButton.title).toBe('Loading…');

    resolveCapabilities(capabilitiesSnapshot());

    await waitFor(() => expect(submitButton.disabled).toBe(false));
  });

  it('never flips a captain action from available to revoked when the backend denies it', async () => {
    const { promise: capabilitiesPromise, resolve: resolveCapabilities } =
      Promise.withResolvers<SquadCapabilitiesDto>();
    mockedGetSquadCapabilities.mockReturnValue(capabilitiesPromise);

    render(PactoGovGovernanceShell, {
      props: {
        payload: basePayload(),
        network: 'sepolia',
        parentId: 'parent1',
        myAddress: CAPTAIN_ADDRESS,
        captainWearers: [CAPTAIN_ADDRESS],
        crewWearers: [],
      },
    });

    await fireEvent.click(await screen.findByRole('tab', { name: 'Captain' }));

    const submitButton = (await screen.findByRole('button', {
      name: 'Submit proposal',
    })) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);

    resolveCapabilities(
      capabilitiesSnapshot({
        capabilities: { proposeTreasury: { allowed: false, reason: 'Access denied' } },
      }),
    );

    await waitFor(() =>
      expect(submitButton.title).toBe(
        'Not allowed for your role. Check your hats or bind a squad EVM in My Dashboard → Alerts.',
      ),
    );
    // Went straight from "loading" to "denied" — it was never briefly enabled.
    expect(submitButton.disabled).toBe(true);
  });

  it('shows a disabled propose action with a reason for a member without a captain or crew hat', async () => {
    mockedGetSquadCapabilities.mockRejectedValue(new Error('network unreachable'));

    render(PactoGovGovernanceShell, {
      props: {
        payload: basePayload(),
        network: 'sepolia',
        parentId: 'parent1',
        myAddress: '0xmember000000000000000000000000000000009',
        captainWearers: [CAPTAIN_ADDRESS],
        crewWearers: [],
      },
    });

    await fireEvent.click(await screen.findByRole('tab', { name: 'Crew' }));

    const submitButton = (await screen.findByRole('button', {
      name: 'Submit proposal',
    })) as HTMLButtonElement;

    await waitFor(() =>
      expect(submitButton.title).toBe(
        'You need a Captain or Crew hat. Ask a captain or crew member for a hat.',
      ),
    );
    expect(submitButton.disabled).toBe(true);
  });
});
