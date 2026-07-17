import { describe, expect, it } from 'vitest';
import { govAndSponsorCompletionToast } from './deploy-completion';
import type { CombinedGovSponsorDeployComplete } from './start-pacto-gov-and-sponsor-deploy';

const gov: NonNullable<CombinedGovSponsorDeployComplete['gov']> = {
  txHash: '0xgov',
  chain: 'sepolia',
  topHatId: '42',
  safeAddress: '0xsafe',
  providerPayload: '{}',
  infraRowId: 'gov-row',
};

function completion(
  overrides: Partial<CombinedGovSponsorDeployComplete>,
): CombinedGovSponsorDeployComplete {
  return { gov: null, sponsor: null, bootstrapped: false, ...overrides };
}

describe('govAndSponsorCompletionToast', () => {
  it('surfaces finishSponsorNeeded with the sponsor error and a launchpad action', () => {
    expect(
      govAndSponsorCompletionToast(
        completion({ gov, finishSponsorNeeded: true, sponsorError: 'ALREADY_DEPLOYED' }),
      ),
    ).toEqual({
      message:
        'Pacto Gov deployed, but sponsor failed: ALREADY_DEPLOYED. Finish sponsor from Deploy Governance.',
      error: true,
      actionLabel: 'Finish sponsor',
      action: 'open-launchpad',
    });
  });

  it('omits the error suffix when finishSponsorNeeded has no sponsor error', () => {
    const toast = govAndSponsorCompletionToast(completion({ gov, finishSponsorNeeded: true }));
    expect(toast.message).toBe(
      'Pacto Gov deployed, but sponsor failed. Finish sponsor from Deploy Governance.',
    );
    expect(toast.action).toBe('open-launchpad');
  });

  it('prefers finishSponsorNeeded over a bootstrap error', () => {
    const toast = govAndSponsorCompletionToast(
      completion({ gov, finishSponsorNeeded: true, bootstrapError: 'mint failed' }),
    );
    expect(toast.action).toBe('open-launchpad');
  });

  it('reports crew bootstrap failure after a combined deploy', () => {
    expect(
      govAndSponsorCompletionToast(completion({ gov, bootstrapError: 'mint failed' })),
    ).toEqual({
      message: 'Pacto Gov + sponsor deployed, but crew bootstrap failed: mint failed',
      error: true,
      actionLabel: 'Open governance',
      action: 'open-governance',
    });
  });

  it('reports crew bootstrap failure after a sponsor-only deploy', () => {
    const toast = govAndSponsorCompletionToast(completion({ bootstrapError: 'mint failed' }));
    expect(toast.message).toBe('Hats sponsor deployed, but crew bootstrap failed: mint failed');
    expect(toast.error).toBe(true);
    expect(toast.action).toBe('open-governance');
  });

  it('celebrates a combined deploy with bootstrapped crew hats', () => {
    expect(govAndSponsorCompletionToast(completion({ gov, bootstrapped: true }))).toEqual({
      message: 'Pacto Gov + sponsor deployed; crew hats bootstrapped.',
    });
  });

  it('notes pending bootstrap after a combined deploy without crew mint', () => {
    expect(govAndSponsorCompletionToast(completion({ gov }))).toEqual({
      message: 'Pacto Gov + sponsor deployed. Bootstrap crew hats later from Captain if needed.',
    });
  });

  it('celebrates a sponsor-only deploy with bootstrapped crew hats', () => {
    expect(govAndSponsorCompletionToast(completion({ bootstrapped: true }))).toEqual({
      message: 'Hats sponsor deployed; crew hats bootstrapped.',
    });
  });

  it('notes pending bootstrap after a sponsor-only deploy', () => {
    expect(govAndSponsorCompletionToast(completion({}))).toEqual({
      message: 'Hats sponsor deployed. Bootstrap crew hats later from Captain if needed.',
    });
  });
});
