import { describe, it, expect } from 'vitest';
import { computeBroadcastPresentation } from './broadcast-presentation';
import type { CommonsBroadcastDto } from './types';
import type { NostrProfile } from '../api/nostr';
import type { Squad } from '../../stores/squads';

/** Identity translator - tests assert on the key, which is enough to prove branch selection. */
const tFn = (key: string) => key;

const NOW = Math.floor(Date.now() / 1000);

function makeDto(overrides: Partial<CommonsBroadcastDto> = {}): CommonsBroadcastDto {
  return {
    eventId: 'evt1',
    authorNpub: 'npub1author0000000000000000000000000000000000000',
    subject: 'user',
    subjectId: 'npub1author0000000000000000000000000000000000000',
    message: 'Hello Commons',
    durationHours: 24,
    expiresAt: NOW + 3600,
    tags: [],
    createdAt: 1,
    ...overrides,
  };
}

function makeProfile(overrides: Partial<NostrProfile> = {}): NostrProfile {
  return {
    id: 'npub1author0000000000000000000000000000000000000',
    name: '',
    display_name: '',
    nickname: '',
    avatar: '',
    banner: '',
    avatar_cached: '',
    banner_cached: '',
    last_read: '',
    status: { title: '', purpose: '', url: '' },
    last_updated: 0,
    typing_until: 0,
    mine: false,
    lud06: '',
    lud16: '',
    about: '',
    website: '',
    nip05: '',
    bot: false,
    ...overrides,
  };
}

function makeSquad(overrides: Partial<Squad> = {}): Squad {
  return {
    id: 'squad1',
    name: 'Neo Builders',
    channels: [],
    kind: 'squad',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('computeBroadcastPresentation', () => {
  it('resolves a squad broadcast title, cover seed, and null cover image', () => {
    const dto = makeDto({
      subject: 'squad',
      subjectId: 'squad1',
      squadId: 'squad1',
      squadName: 'Neo Builders',
      squadKind: 'squad',
    });
    const result = computeBroadcastPresentation(dto, {}, [], undefined, tFn);

    expect(result.isSquad).toBe(true);
    expect(result.title).toBe('Neo Builders');
    expect(result.coverImage).toBeNull();
    expect(result.coverSeed).toBe('squad1');
  });

  it('resolves a user broadcast title and cover image from the profile record', () => {
    const npub = 'npub1author0000000000000000000000000000000000000';
    const dto = makeDto({ subject: 'user', authorNpub: npub, subjectId: npub });
    const profile = makeProfile({ id: npub, display_name: 'Alice', avatar: 'https://example.com/alice.png' });
    const result = computeBroadcastPresentation(dto, { [npub]: profile }, [], undefined, tFn);

    expect(result.isUser).toBe(true);
    expect(result.title).toBe('Alice');
    expect(result.coverImage).toBe('https://example.com/alice.png');
  });

  it('falls back to a truncated npub label without a cached profile, and does not throw', () => {
    const npub = 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
    const dto = makeDto({ subject: 'user', authorNpub: npub, subjectId: npub });

    expect(() => computeBroadcastPresentation(dto, {}, [], undefined, tFn)).not.toThrow();
    const result = computeBroadcastPresentation(dto, {}, [], undefined, tFn);

    expect(result.title).toBe(npub.slice(0, 16) + '…');
    expect(result.coverImage).toBeNull();
  });

  it('blocks joining a squad the user already belongs to', () => {
    const dto = makeDto({ subject: 'squad', subjectId: 'squad1', squadId: 'squad1', squadName: 'Neo Builders' });
    const result = computeBroadcastPresentation(dto, {}, [makeSquad({ id: 'squad1' })], 'npub1someoneelse', tFn);

    expect(result.joinBlockReason).not.toBeNull();
    expect(result.canJoin).toBe(false);
  });

  it('does not allow messaging yourself', () => {
    const npub = 'npub1self0000000000000000000000000000000000000000';
    const dto = makeDto({ subject: 'user', authorNpub: npub, subjectId: npub });
    const result = computeBroadcastPresentation(dto, {}, [], npub, tFn);

    expect(result.canMessage).toBe(false);
  });

  it('does not allow joining your own squad broadcast', () => {
    const npub = 'npub1self0000000000000000000000000000000000000000';
    const dto = makeDto({
      subject: 'squad',
      subjectId: 'squad1',
      squadId: 'squad1',
      squadName: 'Neo Builders',
      authorNpub: npub,
    });
    const result = computeBroadcastPresentation(dto, {}, [], npub, tFn);

    expect(result.joinBlockReason).not.toBeNull();
    expect(result.canJoin).toBe(false);
  });

  describe('subtitle', () => {
    it('distinguishes new_user vs active_user audiences for user broadcasts', () => {
      const npub = 'npub1author0000000000000000000000000000000000000';
      const newUser = makeDto({ subject: 'user', authorNpub: npub, subjectId: npub, audience: 'new_user' });
      const activeUser = makeDto({ subject: 'user', authorNpub: npub, subjectId: npub, audience: 'active_user' });

      expect(computeBroadcastPresentation(newUser, {}, [], undefined, tFn).subtitle).toBe('commons.card.newUser');
      expect(computeBroadcastPresentation(activeUser, {}, [], undefined, tFn).subtitle).toBe('commons.card.activeUser');
    });

    it('distinguishes squad-pair vs default squad kinds', () => {
      const pair = makeDto({ subject: 'squad', subjectId: 'squad1', squadId: 'squad1', squadKind: 'squad-pair' });
      const solo = makeDto({ subject: 'squad', subjectId: 'squad1', squadId: 'squad1', squadKind: 'squad' });

      expect(computeBroadcastPresentation(pair, {}, [], undefined, tFn).subtitle).toBe('commons.card.partnerSquad');
      expect(computeBroadcastPresentation(solo, {}, [], undefined, tFn).subtitle).toBe('commons.card.squadDefault');
    });
  });
});
