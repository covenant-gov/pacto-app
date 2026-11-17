import { describe, expect, it } from 'vitest';
import type { NostrProfile } from '../api/nostr';
import { chainUsernameFromRecord, resolveShownName, shownProfileName } from './shown-name';

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
    expect(
      shownProfileName(profile({ display_name: 'Display' }), null),
    ).toEqual({ name: 'Display', verified: false });
  });
});

describe('resolveShownName', () => {
  const npub = 'npub1abc';
  const record = { name: 'alice', tokenId: '1' };

  it('uses the same minted record for the signed-in account and a peer', () => {
    const self = resolveShownName({
      npub,
      profile: profile({ nickname: 'Nick', name: 'kind0' }),
      chain: { selfNpub: npub, usernameState: { record }, peerClaims: {} },
    });
    const peer = resolveShownName({
      npub,
      profile: profile({ nickname: 'Nick', name: 'kind0' }),
      chain: {
        selfNpub: 'npub1other',
        usernameState: { record: null },
        peerClaims: { [npub]: { name: 'alice' } },
      },
    });
    expect(self).toEqual({ name: 'alice', verified: true });
    expect(peer).toEqual(self);
  });

  it('keeps nickname then kind 0 name then display_name when nothing is minted', () => {
    expect(
      resolveShownName({
        npub,
        profile: profile({ nickname: 'Nick', name: 'kind0', display_name: 'Display' }),
        chain: { selfNpub: 'npub1other', peerClaims: { [npub]: { name: null } } },
      }),
    ).toEqual({ name: 'Nick', verified: false });
    expect(
      resolveShownName({
        npub,
        profile: profile({ name: 'kind0', display_name: 'Display' }),
      }),
    ).toEqual({ name: 'kind0', verified: false });
    expect(
      resolveShownName({
        npub,
        profile: profile({ display_name: 'Display' }),
      }),
    ).toEqual({ name: 'Display', verified: false });
  });
});
