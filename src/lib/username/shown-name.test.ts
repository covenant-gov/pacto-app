import { describe, expect, it } from 'vitest';
import type { NostrProfile } from '../api/nostr';
import { chainUsernameFromRecord, shownProfileName } from './shown-name';

function profile(partial: Partial<NostrProfile>): NostrProfile {
  return {
    id: 'npub1abc',
    name: '',
    avatar: '',
    last_read: '',
    status: { title: '', purpose: '', url: '' },
    last_updated: 0,
    typing_until: 0,
    mine: false,
    display_name: '',
    nickname: '',
    lud06: '',
    lud16: '',
    banner: '',
    about: '',
    website: '',
    nip05: '',
    bot: false,
    avatar_cached: '',
    banner_cached: '',
    ...partial,
  };
}

describe('chainUsernameFromRecord', () => {
  it('returns a trimmed name only for a minted token', () => {
    expect(chainUsernameFromRecord('  alice ', '1')).toBe('alice');
    expect(chainUsernameFromRecord('alice', '0')).toBeNull();
    expect(chainUsernameFromRecord('  ', '2')).toBeNull();
  });
});

describe('shownProfileName', () => {
  it('prefers the chain name over a local nickname', () => {
    const shown = shownProfileName(
      profile({ nickname: 'Nick', name: 'kind0', display_name: 'Display' }),
      'alice',
    );
    expect(shown).toEqual({ name: 'alice', verified: true });
  });

  it('falls back to nickname then kind 0 when there is no claim', () => {
    expect(
      shownProfileName(profile({ nickname: 'Nick', name: 'kind0' }), null),
    ).toEqual({ name: 'Nick', verified: false });
    expect(
      shownProfileName(profile({ name: 'kind0', display_name: 'Display' }), ''),
    ).toEqual({ name: 'kind0', verified: false });
  });
});
