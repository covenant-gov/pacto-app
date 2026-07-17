import { describe, expect, it } from 'vitest';
import { launchpadCtaDisabled, launchpadPrimaryCardState } from './launchpad-cta';

describe('launchpadPrimaryCardState', () => {
  it('shows deployed status when gov and sponsor both exist', () => {
    expect(launchpadPrimaryCardState({ hasPactoGov: true, hasSponsor: true })).toBe('deployed');
  });

  it('offers finish-sponsor when gov exists without a sponsor', () => {
    expect(launchpadPrimaryCardState({ hasPactoGov: true, hasSponsor: false })).toBe(
      'finish-sponsor',
    );
  });

  it('offers gov-only deploy when a sponsor exists without gov', () => {
    expect(launchpadPrimaryCardState({ hasPactoGov: false, hasSponsor: true })).toBe('deploy-gov');
  });

  it('offers the combined wizard when neither exists', () => {
    expect(launchpadPrimaryCardState({ hasPactoGov: false, hasSponsor: false })).toBe(
      'deploy-combined',
    );
  });
});

describe('launchpadCtaDisabled', () => {
  it('blocks CTAs without an announcements channel', () => {
    expect(launchpadCtaDisabled({ hasAnnouncementsChannel: false })).toBe(true);
  });

  it('enables CTAs once the announcements channel exists', () => {
    expect(launchpadCtaDisabled({ hasAnnouncementsChannel: true })).toBe(false);
  });
});
