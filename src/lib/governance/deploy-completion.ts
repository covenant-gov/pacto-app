import type { CombinedGovSponsorDeployComplete } from './start-pacto-gov-and-sponsor-deploy';
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';

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
  const tr = get(t);
  if (out.finishSponsorNeeded) {
    return {
      message: out.sponsorError
        ? tr('governance.deployCompletion.sponsorFailedWithError', { values: { error: out.sponsorError } })
        : tr('governance.deployCompletion.sponsorFailed'),
      error: true,
      actionLabel: tr('governance.deployCompletion.finishSponsor'),
      action: 'open-launchpad',
    };
  }
  if (out.bootstrapError) {
    return {
      message: out.gov
        ? tr('governance.deployCompletion.govBootstrapFailed', { values: { error: out.bootstrapError } })
        : tr('governance.deployCompletion.sponsorBootstrapFailed', { values: { error: out.bootstrapError } }),
      error: true,
      actionLabel: tr('governance.deployCompletion.openGovernance'),
      action: 'open-governance',
    };
  }
  if (out.gov) {
    return {
      message: out.bootstrapped
        ? tr('governance.deployCompletion.govBootstrapped')
        : tr('governance.deployCompletion.govBootstrapLater'),
    };
  }
  return {
    message: out.bootstrapped
      ? tr('governance.deployCompletion.sponsorBootstrapped')
      : tr('governance.deployCompletion.sponsorBootstrapLater'),
  };
}
