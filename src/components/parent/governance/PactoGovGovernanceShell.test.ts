// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/svelte';
import PactoGovGovernanceShell from './PactoGovGovernanceShell.svelte';
import { getSquadCapabilities, getMutinyStatus, mutinyHasVoted } from '../../../lib/governance/api';
import { listSquadGovReplica } from '../../../lib/governance/gov-replica';
import { fetchEvmBalance } from '../../../lib/wallet/signer-balance';
import type { SquadCapabilitiesDto } from '../../../lib/governance/api';
import type { PactoGovProviderPayloadV1 } from '../../../lib/governance/pacto-gov-payload';
import { bumpGovernanceProcessNonce, governanceProcessNonceByParentId } from '../../../stores/navigation';
import { ACL_SNAPSHOT_RETRY_MS } from '../../../lib/governance/acl-snapshot-key';

vi.mock('../../../lib/governance/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/governance/api')>();
  return {
    ...actual,
    getSquadCapabilities: vi.fn(),
    getMutinyStatus: vi.fn(),
    mutinyHasVoted: vi.fn(),
  };
});

vi.mock('../../../lib/governance/gov-replica', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/governance/gov-replica')>();
  return {
    ...actual,
    listSquadGovReplica: vi.fn(),
    upsertSquadGovReplica: vi.fn().mockResolvedValue(true),
  };
});

vi.mock('../../../lib/wallet/signer-balance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/wallet/signer-balance')>();
  return { ...actual, fetchEvmBalance: vi.fn() };
});

const mockedGetSquadCapabilities = vi.mocked(getSquadCapabilities);
const mockedGetMutinyStatus = vi.mocked(getMutinyStatus);
const mockedMutinyHasVoted = vi.mocked(mutinyHasVoted);
const mockedListSquadGovReplica = vi.mocked(listSquadGovReplica);
const mockedFetchEvmBalance = vi.mocked(fetchEvmBalance);

const CAPTAIN_ADDRESS = '0xcaptain0000000000000000000000000000001';
const CREW_ADDRESS = '0xcrew00000000000000000000000000000000001';

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
    mockedGetMutinyStatus.mockReset();
    mockedMutinyHasVoted.mockReset();
    mockedListSquadGovReplica.mockReset();
    mockedListSquadGovReplica.mockResolvedValue([]);
    mockedGetMutinyStatus.mockResolvedValue({
      activeMutinyId: '0',
      proposedNewCaptain: '',
      startedAt: 0,
      deadline: 0,
      snapshot: 0,
      yeas: 0,
      executed: false,
      captain: '',
    });
    mockedMutinyHasVoted.mockResolvedValue(false);
    mockedFetchEvmBalance.mockReset();
    mockedFetchEvmBalance.mockResolvedValue({
      balanceRaw: '0',
      balanceDecimal: '0',
      symbol: 'ETH',
      loading: false,
      error: '',
    });
    governanceProcessNonceByParentId.set({});
  });

  afterEach(() => {
    cleanup();
    governanceProcessNonceByParentId.set({});
    vi.useRealTimers();
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
        'Not allowed for your role. Check your hats or bind a squad EVM in #settings → Alerts.',
      ),
    );
    // Went straight from "loading" to "denied" — it was never briefly enabled.
    expect(submitButton.disabled).toBe(true);
  });

  it('shows a disabled propose action with a reason for a member without a captain or crew hat', async () => {
    mockedGetSquadCapabilities.mockResolvedValue(
      capabilitiesSnapshot({
        rosterAddress: '0xmember000000000000000000000000000000009',
        wearsCaptain: false,
        wearsCrew: false,
        roleLabel: 'No on-chain hat',
      }),
    );

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

    const submitButton = (await screen.findByRole('button', {
      name: 'Submit proposal',
    })) as HTMLButtonElement;

    await waitFor(() =>
      expect(submitButton.title).toBe('Crew/Captain hat required'),
    );
    expect(submitButton.disabled).toBe(true);
  });

  it('shows one hat-required alert on All instead of per-button copy', async () => {
    mockedGetSquadCapabilities.mockResolvedValue(
      capabilitiesSnapshot({
        rosterAddress: '0xmember000000000000000000000000000000009',
        wearsCaptain: false,
        wearsCrew: false,
        roleLabel: 'No on-chain hat',
      }),
    );

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

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Crew/Captain hat required'),
    );
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryAllByText('Crew/Captain hat required')).toHaveLength(1);
  });

  it('keeps Submit proposal disabled when ACL fetch rejects for a captain wearer', async () => {
    vi.useFakeTimers();
    mockedGetSquadCapabilities.mockRejectedValue(new Error('network unreachable'));

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

    await vi.advanceTimersByTimeAsync(0);
    const submitButton = screen.getByRole('button', {
      name: 'Submit proposal',
    }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
    expect(submitButton.title).toBe('Loading…');
    expect(mockedGetSquadCapabilities).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(ACL_SNAPSHOT_RETRY_MS);
    expect(mockedGetSquadCapabilities).toHaveBeenCalledTimes(2);
    expect(submitButton.disabled).toBe(true);
    expect(submitButton.title).toBe('Loading…');
  });

  it('reloads capabilities and keeps CTAs pending when the process nonce bumps', async () => {
    const first = Promise.withResolvers<SquadCapabilitiesDto>();
    const second = Promise.withResolvers<SquadCapabilitiesDto>();
    mockedGetSquadCapabilities
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

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

    const submitButton = (await screen.findByRole('button', {
      name: 'Submit proposal',
    })) as HTMLButtonElement;

    first.resolve(capabilitiesSnapshot());
    await waitFor(() => expect(submitButton.disabled).toBe(false));

    bumpGovernanceProcessNonce('parent1');
    await waitFor(() => {
      expect(submitButton.disabled).toBe(true);
      expect(submitButton.title).toBe('Loading…');
    });
    expect(mockedGetSquadCapabilities).toHaveBeenCalledTimes(2);

    second.resolve(
      capabilitiesSnapshot({
        wearsCaptain: false,
        roleLabel: 'No on-chain hat',
        capabilities: {
          proposeTreasury: { allowed: false, reason: 'Access denied' },
        },
      }),
    );
    await waitFor(() =>
      expect(submitButton.title).toBe(
        'Not allowed for your role. Check your hats or bind a squad EVM in #settings → Alerts.',
      ),
    );
    expect(submitButton.disabled).toBe(true);
  });

  it('reloads capabilities when crew wearers start including the current address', async () => {
    const first = Promise.withResolvers<SquadCapabilitiesDto>();
    const second = Promise.withResolvers<SquadCapabilitiesDto>();
    mockedGetSquadCapabilities.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const props = {
      payload: basePayload(),
      network: 'sepolia',
      parentId: 'parent1',
      myAddress: CREW_ADDRESS,
      captainWearers: [CAPTAIN_ADDRESS],
      crewWearers: [] as string[],
    };

    const { rerender } = render(PactoGovGovernanceShell, { props });

    const submitButton = (await screen.findByRole('button', {
      name: 'Submit proposal',
    })) as HTMLButtonElement;

    first.resolve(
      capabilitiesSnapshot({
        rosterAddress: CREW_ADDRESS,
        wearsCaptain: false,
        wearsCrew: false,
        roleLabel: 'No on-chain hat',
      }),
    );
    await waitFor(() =>
      expect(submitButton.title).toBe('Crew/Captain hat required'),
    );
    expect(mockedGetSquadCapabilities).toHaveBeenCalledTimes(1);

    await rerender({ ...props, crewWearers: [CREW_ADDRESS] });
    await waitFor(() => {
      expect(submitButton.disabled).toBe(true);
      expect(submitButton.title).toBe('Loading…');
    });
    expect(mockedGetSquadCapabilities).toHaveBeenCalledTimes(2);

    second.resolve(
      capabilitiesSnapshot({
        rosterAddress: CREW_ADDRESS,
        wearsCaptain: false,
        wearsCrew: true,
        roleLabel: 'Crew',
      }),
    );
    await waitFor(() => expect(submitButton.disabled).toBe(false));
  });

  it('retries capabilities once when wearer lists disagree with the snapshot', async () => {
    vi.useFakeTimers();
    mockedGetSquadCapabilities
      .mockResolvedValueOnce(
        capabilitiesSnapshot({
          rosterAddress: CREW_ADDRESS,
          wearsCaptain: false,
          wearsCrew: false,
          roleLabel: 'No on-chain hat',
        }),
      )
      .mockResolvedValueOnce(
        capabilitiesSnapshot({
          rosterAddress: CREW_ADDRESS,
          wearsCaptain: false,
          wearsCrew: true,
          roleLabel: 'Crew',
        }),
      );

    render(PactoGovGovernanceShell, {
      props: {
        payload: basePayload(),
        network: 'sepolia',
        parentId: 'parent1',
        myAddress: CREW_ADDRESS,
        captainWearers: [CAPTAIN_ADDRESS],
        crewWearers: [CREW_ADDRESS],
      },
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(mockedGetSquadCapabilities).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(ACL_SNAPSHOT_RETRY_MS - 1);
    expect(mockedGetSquadCapabilities).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(mockedGetSquadCapabilities).toHaveBeenCalledTimes(2);
  });

  it('renders All, Crew, and Captain command tabs by default', async () => {
    mockedGetSquadCapabilities.mockResolvedValue(capabilitiesSnapshot());

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

    expect(await screen.findByRole('tab', { name: 'All' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Crew' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Captain' })).toBeTruthy();
    const submit = screen.getByRole('button', { name: 'Submit proposal' });
    const voteMode = screen.getByRole('button', { name: 'Vote mode' });
    expect(submit.classList.contains('primary')).toBe(true);
    expect(voteMode.classList.contains('primary')).toBe(true);
  });

  it('renders the proposals board without All, Crew, or Captain tabs on the proposals surface', async () => {
    mockedGetSquadCapabilities.mockResolvedValue(capabilitiesSnapshot());

    render(PactoGovGovernanceShell, {
      props: {
        payload: basePayload(),
        network: 'sepolia',
        parentId: 'parent1',
        myAddress: CAPTAIN_ADDRESS,
        captainWearers: [CAPTAIN_ADDRESS],
        crewWearers: [],
        surface: 'proposals',
      },
    });

    expect(await screen.findByRole('heading', { name: /Proposals/i })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'All' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Crew' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Captain' })).toBeNull();
  });

  it('still fetches live mutinyHasVoted after replica hydrate and keeps the vote pending', async () => {
    const { promise: votedPromise, resolve: resolveVoted } = Promise.withResolvers<boolean>();
    mockedGetSquadCapabilities.mockResolvedValue(
      capabilitiesSnapshot({
        wearsCaptain: false,
        wearsCrew: true,
        rosterAddress: CREW_ADDRESS,
        roleLabel: 'Crew',
        capabilities: {
          castMutinyVote: { allowed: true, reason: '' },
        },
      }),
    );
    mockedListSquadGovReplica.mockResolvedValue([
      {
        parentId: 'parent1',
        stack: 'pacto_gov',
        round: '',
        kind: 'mutiny',
        blockNumber: 12,
        txHash: '0x1',
        snapshotJson: JSON.stringify({
          mutiny: {
            activeMutinyId: '7',
            proposedNewCaptain: CREW_ADDRESS,
            startedAt: 1,
            deadline: Math.floor(Date.now() / 1000) + 86_400,
            snapshot: 1,
            yeas: 1,
            executed: false,
            captain: CAPTAIN_ADDRESS,
          },
        }),
        updatedAtMs: 1,
      },
    ]);
    mockedGetMutinyStatus.mockResolvedValue({
      activeMutinyId: '7',
      proposedNewCaptain: CREW_ADDRESS,
      startedAt: 1,
      deadline: Math.floor(Date.now() / 1000) + 86_400,
      snapshot: 1,
      yeas: 1,
      executed: false,
      captain: CAPTAIN_ADDRESS,
    });
    mockedMutinyHasVoted.mockReturnValue(votedPromise);

    render(PactoGovGovernanceShell, {
      props: {
        payload: { ...basePayload(), mutinyModule: '0xmutiny00000000000000000000000000000001' },
        network: 'sepolia',
        parentId: 'parent1',
        myAddress: CREW_ADDRESS,
        captainWearers: [CAPTAIN_ADDRESS],
        crewWearers: [CREW_ADDRESS],
        surface: 'proposals',
      },
    });

    const voteBtn = (await screen.findByRole('button', { name: 'Cast mutiny vote' })) as HTMLButtonElement;
    expect(voteBtn.disabled).toBe(true);
    expect(voteBtn.title).toBe('Loading…');
    await waitFor(() => expect(mockedMutinyHasVoted).toHaveBeenCalled());

    resolveVoted(true);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Already voted' })).toBeTruthy());
  });
});
