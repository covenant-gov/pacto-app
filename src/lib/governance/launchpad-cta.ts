import type { LaunchpadDeployOptionId } from './api';

/** Every launchpad deploy CTA stays disabled until the squad has an #announcements channel. */
export function launchpadCtaDisabled(input: { hasAnnouncementsChannel: boolean }): boolean {
  return !input.hasAnnouncementsChannel;
}

export const LAUNCHPAD_RECOMMENDED_OPTION_IDS: LaunchpadDeployOptionId[] = ['full-gov'];

export const LAUNCHPAD_ADVANCED_OPTION_IDS: LaunchpadDeployOptionId[] = [
  'pacto-gov',
  'sponsor-ext',
  'sponsor-hats',
  'sponsor-wire',
  'squad-admin-ext',
];

export type LaunchpadRouteAction =
  | 'gov-and-sponsor'
  | 'pacto-gov'
  | 'ext-sponsor'
  | 'hats-sponsor'
  | 'squad-admin';

/** Maps a launchpad option id to the deploy coordinator action. */
export function launchpadOptionRoute(id: LaunchpadDeployOptionId): LaunchpadRouteAction {
  switch (id) {
    case 'full-gov':
      return 'gov-and-sponsor';
    case 'pacto-gov':
      return 'pacto-gov';
    case 'sponsor-ext':
      return 'ext-sponsor';
    case 'sponsor-hats':
    case 'sponsor-wire':
      return 'hats-sponsor';
    case 'squad-admin-ext':
      return 'squad-admin';
    default:
      return 'gov-and-sponsor';
  }
}

/** i18n key suffix under `governance.launchpad.options.*`. */
export function launchpadOptionI18nKey(id: LaunchpadDeployOptionId): string {
  return `governance.launchpad.options.${id.replace(/-/g, '_')}`;
}

/** Short address for infra status rows. */
export function launchpadShortAddress(address: string | null | undefined): string {
  const raw = address?.trim() ?? '';
  if (raw.length < 12) return raw;
  return `${raw.slice(0, 6)}…${raw.slice(-4)}`;
}
