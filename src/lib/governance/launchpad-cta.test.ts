import { describe, expect, it } from 'vitest';
import {
  launchpadCtaDisabled,
  launchpadOptionI18nKey,
  launchpadOptionRoute,
  launchpadShortAddress,
  LAUNCHPAD_ADVANCED_OPTION_IDS,
  LAUNCHPAD_RECOMMENDED_OPTION_IDS,
} from './launchpad-cta';

describe('launchpadCtaDisabled', () => {
  it('blocks CTAs without an announcements channel', () => {
    expect(launchpadCtaDisabled({ hasAnnouncementsChannel: false })).toBe(true);
  });

  it('enables CTAs once the announcements channel exists', () => {
    expect(launchpadCtaDisabled({ hasAnnouncementsChannel: true })).toBe(false);
  });
});

describe('launchpadOptionRoute', () => {
  it('routes full governance to the combined wizard', () => {
    expect(launchpadOptionRoute('full-gov')).toBe('gov-and-sponsor');
  });

  it('routes hats and wire sponsor options to hats sponsor deploy', () => {
    expect(launchpadOptionRoute('sponsor-hats')).toBe('hats-sponsor');
    expect(launchpadOptionRoute('sponsor-wire')).toBe('hats-sponsor');
  });

  it('routes ext and admin options separately', () => {
    expect(launchpadOptionRoute('sponsor-ext')).toBe('ext-sponsor');
    expect(launchpadOptionRoute('squad-admin-ext')).toBe('squad-admin');
    expect(launchpadOptionRoute('pacto-gov')).toBe('pacto-gov');
  });
});

describe('launchpad option catalogs', () => {
  it('keeps recommended and advanced ids disjoint', () => {
    for (const id of LAUNCHPAD_RECOMMENDED_OPTION_IDS) {
      expect(LAUNCHPAD_ADVANCED_OPTION_IDS).not.toContain(id);
    }
  });

  it('maps option ids to i18n keys', () => {
    expect(launchpadOptionI18nKey('sponsor-wire')).toBe('governance.launchpad.options.sponsor_wire');
  });
});

describe('launchpadShortAddress', () => {
  it('shortens long addresses', () => {
    expect(launchpadShortAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234…5678');
  });
});
