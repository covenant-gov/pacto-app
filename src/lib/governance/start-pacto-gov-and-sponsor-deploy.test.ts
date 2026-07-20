import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAddress } from 'viem';

const runOnChainInBackground = vi.fn();
const deployNavePirataForParent = vi.fn();
const deploySquadSponsorHatsForParent = vi.fn();
const quartermasterBootstrapCrew = vi.fn();
const resolveSquadRosterEvmAddress = vi.fn();

vi.mock('../evm/on-chain-background', () => ({
  runOnChainInBackground: (...args: unknown[]) => runOnChainInBackground(...args),
}));

vi.mock('./api', () => ({
  deployNavePirataForParent: (...args: unknown[]) => deployNavePirataForParent(...args),
  deploySquadSponsorHatsForParent: (...args: unknown[]) =>
    deploySquadSponsorHatsForParent(...args),
  quartermasterBootstrapCrew: (...args: unknown[]) => quartermasterBootstrapCrew(...args),
}));

vi.mock('../squad/squad-roster-binding', () => ({
  resolveSquadRosterEvmAddress: (...args: unknown[]) => resolveSquadRosterEvmAddress(...args),
}));

vi.mock('../../stores/toast', () => ({
  showToast: vi.fn(),
}));

import {
  bootstrapCrewCandidates,
  canBootstrapCrewDuringDeploy,
  isRosterHatRecipientAddress,
  startHatsSponsorOnlyDeploy,
  startPactoGovAndSponsorDeploy,
} from './start-pacto-gov-and-sponsor-deploy';

const rosterA = getAddress('0x51012bcd8494f36b000000000000000000000001');
const rosterB = getAddress('0x897aae53a87e2d69000000000000000000000002');
const defaultOnly = getAddress('0xdbe38ac51289df3714cb3e4a104aeb71920af98a');

describe('isRosterHatRecipientAddress', () => {
  const opts = [{ address: rosterA }, { address: rosterB }];

  it('accepts squad-assigned roster EVMs', () => {
    expect(isRosterHatRecipientAddress(rosterA, opts)).toBe(true);
    expect(isRosterHatRecipientAddress(rosterB.toLowerCase(), opts)).toBe(true);
  });

  it('rejects Default (or any) address not on the roster map', () => {
    expect(isRosterHatRecipientAddress(defaultOnly, opts)).toBe(false);
  });
});

describe('canBootstrapCrewDuringDeploy', () => {
  it('allows when the captain is the squad roster signer paying from squad', () => {
    expect(
      canBootstrapCrewDuringDeploy({
        captainAddress: rosterA,
        squadRosterAddress: rosterA,
        payFrom: 'squad',
      }),
    ).toBe(true);
  });

  it('matches roster and captain case-insensitively', () => {
    expect(
      canBootstrapCrewDuringDeploy({
        captainAddress: rosterA.toLowerCase(),
        squadRosterAddress: rosterA,
      }),
    ).toBe(true);
  });

  it('disallows when someone else is captain', () => {
    expect(
      canBootstrapCrewDuringDeploy({
        captainAddress: rosterB,
        squadRosterAddress: rosterA,
      }),
    ).toBe(false);
  });

  it('disallows when the roster signer is unknown', () => {
    expect(
      canBootstrapCrewDuringDeploy({
        captainAddress: rosterA,
        squadRosterAddress: null,
      }),
    ).toBe(false);
  });

  it('disallows when Default pays', () => {
    expect(
      canBootstrapCrewDuringDeploy({
        captainAddress: rosterA,
        squadRosterAddress: rosterA,
        payFrom: 'default',
      }),
    ).toBe(false);
  });
});

describe('bootstrapCrewCandidates', () => {
  it('only yields roster options and excludes captain', () => {
    const out = bootstrapCrewCandidates(
      [{ address: rosterA }, { address: rosterB }],
      rosterA,
    );
    expect(out).toEqual([rosterB]);
  });
});

const members = [{ address: rosterA }, { address: rosterB }];
const quartermaster = getAddress('0x00000000000000000000000000000000000000aa');
const sponsorAddress = getAddress('0x00000000000000000000000000000000000000bb');
const safeAddress = getAddress('0x00000000000000000000000000000000000000cc');

type CombinedParams = Parameters<typeof startPactoGovAndSponsorDeploy>[0];
type HatsOnlyParams = Parameters<typeof startHatsSponsorOnlyDeploy>[0];

function combinedParams(overrides: Partial<CombinedParams> = {}): CombinedParams {
  return {
    parentId: 'p1',
    squadNetwork: 'sepolia',
    captain: rosterA,
    initialDepositWei: '1000',
    bootstrapCrew: false,
    memberOptions: members,
    onComplete: vi.fn(),
    ...overrides,
  };
}

function hatsOnlyParams(overrides: Partial<HatsOnlyParams> = {}): HatsOnlyParams {
  return {
    parentId: 'p1',
    squadNetwork: 'sepolia',
    topHatId: '42',
    initialDepositWei: '1000',
    bootstrapCrew: false,
    memberOptions: members,
    onComplete: vi.fn(),
    ...overrides,
  };
}

function govResult() {
  return {
    txHash: '0xgov',
    chain: 'sepolia',
    topHatId: '42',
    safeAddress,
    quartermaster,
    providerPayload: '{}',
    infraRowId: 'pacto-gov-p1',
  };
}

function sponsorResult() {
  return {
    txHash: '0xsponsor',
    chain: 'sepolia',
    chainId: 11155111,
    squadId: 'squad-1',
    sponsorAddress,
    paymasterAddress: getAddress('0x00000000000000000000000000000000000000dd'),
    variant: 'hats',
    providerPayload: '{}',
    infraRowId: 'sponsor-p1',
  };
}

/** Mirror the real runner: job errors route to onError instead of onComplete. */
function mockBackgroundRunsJob() {
  runOnChainInBackground.mockImplementation(({ job, onSuccess, onError }) => {
    void (async () => {
      try {
        const result = await job();
        await onSuccess?.(result);
      } catch (e) {
        onError?.(e instanceof Error ? e.message : String(e));
      }
    })();
  });
}

describe('startPactoGovAndSponsorDeploy job branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBackgroundRunsJob();
    resolveSquadRosterEvmAddress.mockResolvedValue(rosterA);
  });

  it('stops before the sponsor step when the Nave Pirata deploy rejects', async () => {
    deployNavePirataForParent.mockRejectedValueOnce(new Error('gov down'));
    const onComplete = vi.fn();
    const onError = vi.fn();
    expect(startPactoGovAndSponsorDeploy(combinedParams({ onComplete, onError }))).toBe(true);
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0][0]).toMatch(/gov down/);
    expect(deploySquadSponsorHatsForParent).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('bootstraps the crew after gov and sponsor succeed', async () => {
    deployNavePirataForParent.mockResolvedValueOnce(govResult());
    deploySquadSponsorHatsForParent.mockResolvedValueOnce(sponsorResult());
    quartermasterBootstrapCrew.mockResolvedValueOnce({ txHash: '0xboot' });
    const onComplete = vi.fn();
    const steps: string[] = [];
    startPactoGovAndSponsorDeploy(
      combinedParams({
        bootstrapCrew: true,
        signerWallet: 'squad',
        onComplete,
        onProgress: (s) => steps.push(s),
      }),
    );
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(quartermasterBootstrapCrew).toHaveBeenCalledWith({
      network: 'sepolia',
      parentId: 'p1',
      quartermaster,
      candidates: [rosterB],
    });
    const out = onComplete.mock.calls[0][0];
    expect(out.bootstrapped).toBe(true);
    expect(out.bootstrapError).toBeUndefined();
    expect(steps).toEqual(['gov', 'sponsor', 'bootstrap']);
  });

  it('surfaces bootstrapError and still completes when the crew mint fails', async () => {
    deployNavePirataForParent.mockResolvedValueOnce(govResult());
    deploySquadSponsorHatsForParent.mockResolvedValueOnce(sponsorResult());
    quartermasterBootstrapCrew.mockRejectedValueOnce(new Error('mint failed'));
    const onComplete = vi.fn();
    startPactoGovAndSponsorDeploy(
      combinedParams({ bootstrapCrew: true, signerWallet: 'squad', onComplete }),
    );
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalled());
    const out = onComplete.mock.calls[0][0];
    expect(out.bootstrapped).toBe(false);
    expect(out.bootstrapError).toMatch(/mint failed/);
    expect(out.gov).toBeTruthy();
    expect(out.sponsor?.sponsorAddress).toBe(sponsorAddress);
  });

  it('rejects bootstrap when Default pays', () => {
    const onReject = vi.fn();
    expect(
      startPactoGovAndSponsorDeploy(
        combinedParams({
          bootstrapCrew: true,
          signerWallet: 'default',
          onComplete: vi.fn(),
          onReject,
        }),
      ),
    ).toBe(false);
    expect(onReject.mock.calls[0][0]).toMatch(/squad-assigned signer/i);
    expect(runOnChainInBackground).not.toHaveBeenCalled();
  });

  it('threads an explicit default signerWallet through both deploys', async () => {
    deployNavePirataForParent.mockResolvedValueOnce(govResult());
    deploySquadSponsorHatsForParent.mockResolvedValueOnce(sponsorResult());
    const onComplete = vi.fn();
    startPactoGovAndSponsorDeploy(combinedParams({ signerWallet: 'default', onComplete }));
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(deployNavePirataForParent).toHaveBeenCalledWith(
      expect.objectContaining({ signerWallet: 'default' }),
    );
    expect(deploySquadSponsorHatsForParent).toHaveBeenCalledWith(
      expect.objectContaining({ signerWallet: 'default' }),
    );
  });
});

describe('startHatsSponsorOnlyDeploy job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBackgroundRunsJob();
    resolveSquadRosterEvmAddress.mockResolvedValue(rosterA);
  });

  it('deploys the sponsor and completes without bootstrap', async () => {
    deploySquadSponsorHatsForParent.mockResolvedValueOnce(sponsorResult());
    const onComplete = vi.fn();
    const steps: string[] = [];
    expect(
      startHatsSponsorOnlyDeploy(
        hatsOnlyParams({ onComplete, onProgress: (s) => steps.push(s) }),
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalled());
    const out = onComplete.mock.calls[0][0];
    expect(out.gov).toBeNull();
    expect(out.sponsor?.txHash).toBe('0xsponsor');
    expect(out.bootstrapped).toBe(false);
    expect(quartermasterBootstrapCrew).not.toHaveBeenCalled();
    expect(steps).toEqual(['sponsor']);
  });

  it('bootstraps when the quartermaster is known and the captain is the roster signer', async () => {
    deploySquadSponsorHatsForParent.mockResolvedValueOnce(sponsorResult());
    quartermasterBootstrapCrew.mockResolvedValueOnce({ txHash: '0xboot' });
    const onComplete = vi.fn();
    const steps: string[] = [];
    startHatsSponsorOnlyDeploy(
      hatsOnlyParams({
        bootstrapCrew: true,
        quartermaster,
        captainAddress: rosterA,
        signerWallet: 'squad',
        onComplete,
        onProgress: (s) => steps.push(s),
      }),
    );
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(quartermasterBootstrapCrew).toHaveBeenCalledWith({
      network: 'sepolia',
      parentId: 'p1',
      quartermaster,
      candidates: [rosterB],
    });
    const out = onComplete.mock.calls[0][0];
    expect(out.bootstrapped).toBe(true);
    expect(out.bootstrapError).toBeUndefined();
    expect(steps).toEqual(['sponsor', 'bootstrap']);
  });
});
