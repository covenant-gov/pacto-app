import { describe, it, expect } from 'vitest';
import { findWelcomeInviteSource } from './find-invite-source';
import type { DmMessage } from '../../stores/dm';

const NPUB_A = 'npub1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NPUB_B = 'npub1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function msg(overrides: Partial<DmMessage> = {}): DmMessage {
  return {
    id: 'm1',
    content: 'hello',
    at: 1,
    mine: false,
    ...overrides,
  };
}

const SQUAD_INVITE = JSON.stringify({
  type: 'squad_invite',
  squadName: 'Alpha',
  groupId: 'g1',
  kind: 'squad',
});

const CHANNEL_IN_SQUAD = JSON.stringify({
  type: 'channel_in_squad',
  squadName: 'Alpha',
  announcementsGroupId: 'ag1',
  channelGroupId: 'cg1',
  channelName: 'general',
});

describe('findWelcomeInviteSource', () => {
  it('finds a squad invite by matching group id and returns its DM peer and squad name', () => {
    const messages = { [NPUB_A]: [msg({ id: 'm1', content: SQUAD_INVITE })] };
    expect(findWelcomeInviteSource('g1', messages)).toEqual({ npub: NPUB_A, squadName: 'Alpha' });
  });

  it('finds a channel-in-squad invite by matching channel group id, including the channel name', () => {
    const messages = { [NPUB_A]: [msg({ id: 'm1', content: CHANNEL_IN_SQUAD })] };
    expect(findWelcomeInviteSource('cg1', messages)).toEqual({
      npub: NPUB_A,
      squadName: 'Alpha',
      channelName: 'general',
    });
  });

  it('matches case-insensitively and ignores surrounding whitespace on the group id', () => {
    const messages = { [NPUB_A]: [msg({ id: 'm1', content: SQUAD_INVITE })] };
    expect(findWelcomeInviteSource(' G1 ', messages)).toEqual({ npub: NPUB_A, squadName: 'Alpha' });
  });

  it('searches across every DM peer, not only the first', () => {
    const messages = {
      [NPUB_B]: [msg({ id: 'other', content: 'hi' })],
      [NPUB_A]: [msg({ id: 'm1', content: SQUAD_INVITE })],
    };
    expect(findWelcomeInviteSource('g1', messages)?.npub).toBe(NPUB_A);
  });

  it('returns null when no local DM message names the group', () => {
    const messages = { [NPUB_A]: [msg({ id: 'm1', content: 'plain text' })] };
    expect(findWelcomeInviteSource('unseen-group', messages)).toBeNull();
  });

  it('returns null for an empty message map', () => {
    expect(findWelcomeInviteSource('g1', {})).toBeNull();
  });
});
