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
  startHatsSponsorOnlyDeploy,
  startPactoGovAndSponsorDeploy,
} from './start-pacto-gov-and-sponsor-deploy';

const rosterA = getAddress('0x51012bcd8494f36b000000000000000000000001');
const rosterB = getAddress('0x897aae53a87e2d69000000000000000000000002');
const members = [{ address: rosterA }, { address: rosterB }];

describe('startPactoGovAndSponsorDeploy validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects missing network via onReject', () => {
    const onReject = vi.fn();
    const ok = startPactoGovAndSponsorDeploy({
      parentId: 'p1',
      squadNetwork: null,
      captain: rosterA,
      initialDepositWei: '1000',
      bootstrapCrew: false,
      memberOptions: members,
      onComplete: vi.fn(),
      onReject,
    });
    expect(ok).toBe(false);
    expect(onReject).toHaveBeenCalled();
    expect(runOnChainInBackground).not.toHaveBeenCalled();
  });

  it('rejects non-roster captain', () => {
    const onReject = vi.fn();
    const ok = startPactoGovAndSponsorDeploy({
      parentId: 'p1',
      squadNetwork: 'sepolia',
      captain: getAddress('0xdbe38ac51289df3714cb3e4a104aeb71920af98a'),
      initialDepositWei: '1000',
      bootstrapCrew: false,
      memberOptions: members,
      onComplete: vi.fn(),
      onReject,
    });
    expect(ok).toBe(false);
    expect(onReject.mock.calls[0][0]).toMatch(/squad-assigned/i);
  });

  it('rejects zero deposit', () => {
    const onReject = vi.fn();
    const ok = startPactoGovAndSponsorDeploy({
      parentId: 'p1',
      squadNetwork: 'sepolia',
      captain: rosterA,
      initialDepositWei: '0',
      bootstrapCrew: false,
      memberOptions: members,
      onComplete: vi.fn(),
      onReject,
    });
    expect(ok).toBe(false);
    expect(onReject.mock.calls[0][0]).toMatch(/deposit/i);
  });
});

describe('startPactoGovAndSponsorDeploy job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runOnChainInBackground.mockImplementation(({ job, onSuccess }) => {
      void (async () => {
        const result = await job();
        await onSuccess?.(result);
      })();
    });
  });

  it('runs gov then sponsor and reports finishSponsorNeeded when sponsor fails', async () => {
    deployNavePirataForParent.mockResolvedValueOnce({
      topHatId: '42',
      txHash: '0xgov',
      chain: 'sepolia',
      providerPayload: '{}',
      infraRowId: 'gov-1',
    });
    deploySquadSponsorHatsForParent.mockRejectedValueOnce(new Error('sponsor down'));
    const onComplete = vi.fn();
    const steps: string[] = [];
    const ok = startPactoGovAndSponsorDeploy({
      parentId: 'p1',
      squadNetwork: 'sepolia',
      captain: rosterA,
      initialDepositWei: '1000',
      bootstrapCrew: false,
      memberOptions: members,
      onProgress: (s) => steps.push(s),
      onComplete,
    });
    expect(ok).toBe(true);
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(steps).toEqual(['gov', 'sponsor']);
    expect(onComplete.mock.calls[0][0].finishSponsorNeeded).toBe(true);
    expect(onComplete.mock.calls[0][0].sponsor).toBeNull();
    expect(onComplete.mock.calls[0][0].gov).toBeTruthy();
  });
});

describe('startHatsSponsorOnlyDeploy validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects missing top hat id', () => {
    const onReject = vi.fn();
    const ok = startHatsSponsorOnlyDeploy({
      parentId: 'p1',
      squadNetwork: 'sepolia',
      topHatId: '  ',
      initialDepositWei: '1000',
      bootstrapCrew: false,
      memberOptions: members,
      onComplete: vi.fn(),
      onReject,
    });
    expect(ok).toBe(false);
    expect(onReject.mock.calls[0][0]).toMatch(/top hat/i);
    expect(runOnChainInBackground).not.toHaveBeenCalled();
  });
});
