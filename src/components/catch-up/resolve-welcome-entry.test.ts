import { describe, it, expect } from 'vitest';
import { resolveWelcomeEntry } from './resolve-welcome-entry';
import type { PendingMlsWelcome } from '../../lib/api/nostr';
import type { WelcomeInviteSource } from '../../lib/invites/find-invite-source';

const UNAVAILABLE = 'This invite is no longer available.';

function pendingWelcome(overrides: Partial<PendingMlsWelcome> = {}): PendingMlsWelcome {
  return {
    id: 'w1',
    wrapper_event_id: 'we1',
    nostr_group_id: 'g1',
    group_name: 'Alpha Squad',
    group_description: null,
    group_image_url: null,
    group_admin_pubkeys: [],
    group_relays: [],
    welcomer: 'npub1welcomer',
    member_count: 3,
    ...overrides,
  };
}

describe('resolveWelcomeEntry', () => {
  it('prefers a found DM invite source, targeting its DM thread', () => {
    const source: WelcomeInviteSource = { npub: 'npub1a', squadName: 'Alpha' };
    const result = resolveWelcomeEntry('g1', source, [pendingWelcome()], UNAVAILABLE);
    expect(result).toEqual({ target: { kind: 'dm', npub: 'npub1a' }, locationLabel: 'Alpha' });
  });

  it('includes the channel name for a channel-in-squad DM invite source', () => {
    const source: WelcomeInviteSource = { npub: 'npub1a', squadName: 'Alpha', channelName: 'general' };
    const result = resolveWelcomeEntry('g1', source, [], UNAVAILABLE);
    expect(result).toEqual({ target: { kind: 'dm', npub: 'npub1a' }, locationLabel: 'Alpha · #general' });
  });

  it('falls back to the pending welcome group name and routes to DM requests when no DM invite is found', () => {
    const result = resolveWelcomeEntry('g1', null, [pendingWelcome({ group_name: 'Alpha Squad' })], UNAVAILABLE);
    expect(result).toEqual({ target: { kind: 'dm-requests' }, locationLabel: 'Alpha Squad' });
  });

  it('matches the pending welcome case-insensitively by group id', () => {
    const result = resolveWelcomeEntry('G1', null, [pendingWelcome({ nostr_group_id: 'g1' })], UNAVAILABLE);
    expect(result.target).toEqual({ kind: 'dm-requests' });
  });

  it('falls back to the group id when the pending welcome has a blank name', () => {
    const result = resolveWelcomeEntry('g1', null, [pendingWelcome({ group_name: '  ' })], UNAVAILABLE);
    expect(result).toEqual({ target: { kind: 'dm-requests' }, locationLabel: 'g1' });
  });

  it('leaves the entry inert with a translated fallback label when neither source resolves', () => {
    const result = resolveWelcomeEntry('unseen-group', null, [pendingWelcome({ nostr_group_id: 'g1' })], UNAVAILABLE);
    expect(result).toEqual({ target: null, locationLabel: UNAVAILABLE });
  });

  it('leaves the entry inert for an empty pending welcome list', () => {
    const result = resolveWelcomeEntry('g1', null, [], UNAVAILABLE);
    expect(result).toEqual({ target: null, locationLabel: UNAVAILABLE });
  });
});
