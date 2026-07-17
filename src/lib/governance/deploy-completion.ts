import type { CombinedGovSponsorDeployComplete } from './start-pacto-gov-and-sponsor-deploy';

/** Toast after the combined gov+sponsor wizard; `action` maps to a dashboard navigation target. */
export interface DeployCompletionToast {
  message: string;
  error?: boolean;
  actionLabel?: string;
  action?: 'open-launchpad' | 'open-governance';
}

/** Completion toast for the combined wizard: soft-failures first, then gov/sponsor success copy. */
export function govAndSponsorCompletionToast(
  out: CombinedGovSponsorDeployComplete,
): DeployCompletionToast {
  if (out.finishSponsorNeeded) {
    return {
      message: `Pacto Gov deployed, but sponsor failed${out.sponsorError ? `: ${out.sponsorError}` : ''}. Finish sponsor from Deploy Governance.`,
      error: true,
      actionLabel: 'Finish sponsor',
      action: 'open-launchpad',
    };
  }
  if (out.bootstrapError) {
    return {
      message: out.gov
        ? `Pacto Gov + sponsor deployed, but crew bootstrap failed: ${out.bootstrapError}`
        : `Hats sponsor deployed, but crew bootstrap failed: ${out.bootstrapError}`,
      error: true,
      actionLabel: 'Open governance',
      action: 'open-governance',
    };
  }
  if (out.gov) {
    return {
      message: out.bootstrapped
        ? 'Pacto Gov + sponsor deployed; crew hats bootstrapped.'
        : 'Pacto Gov + sponsor deployed. Bootstrap crew hats later from Captain if needed.',
    };
  }
  return {
    message: out.bootstrapped
      ? 'Hats sponsor deployed; crew hats bootstrapped.'
      : 'Hats sponsor deployed. Bootstrap crew hats later from Captain if needed.',
  };
}
