/** Which primary-card branch the deploy launchpad shows for the squad's infra state. */
export type LaunchpadPrimaryCardState =
  | 'deployed'
  | 'finish-sponsor'
  | 'deploy-gov'
  | 'deploy-combined';

/** Primary card branch: both deployed, finish hats sponsor, gov only, or the combined wizard. */
export function launchpadPrimaryCardState(input: {
  hasSponsor: boolean;
  hasPactoGov: boolean;
}): LaunchpadPrimaryCardState {
  if (input.hasPactoGov && input.hasSponsor) return 'deployed';
  if (input.hasPactoGov) return 'finish-sponsor';
  if (input.hasSponsor) return 'deploy-gov';
  return 'deploy-combined';
}

/** Every launchpad deploy CTA stays disabled until the squad has an #announcements channel. */
export function launchpadCtaDisabled(input: { hasAnnouncementsChannel: boolean }): boolean {
  return !input.hasAnnouncementsChannel;
}
