import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { get, writable } from 'svelte/store';

// accept-invite.ts drags in squad-catalog / outbound-invite / backup-verification /
// dm-debug, none of which recordDeclinedWelcomeGroupId ever calls, but importing the
// module runs their top-level code. Mirror accept-invite.test.ts's mocks so import
// doesn't reach real Tauri invokes.
vi.mock('../squad/squad-catalog', () => ({
  persistSquadPatch: vi.fn(),
  persistSquad: vi.fn(),
}));

vi.mock('../../stores/backup-verification', () => ({
  requireBackupVerified: () => true,
}));

vi.mock('../utils/dm-debug', () => ({
  dmError: vi.fn(),
}));

vi.mock('../squad/squad-state-sync', () => ({
  maybeAutoRequestSquadStateSyncAfterJoin: vi.fn(),
}));

vi.mock('../squad/squad-outbound-invite', () => ({
  publishInviteAcceptedClaims: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../stores/auth', () => ({
  currentUser: writable({ npub: 'npub1invitee' }),
}));

import { offeredWelcomes, recordDeclinedWelcomeGroupId, type OfferedWelcomeInputs } from './pending-welcomes';
import { declinedWelcomeGroupIds } from '../../stores/invite-decisions';
import type { PendingMlsWelcome } from '../api/nostr';

function welcome(overrides: Partial<PendingMlsWelcome> = {}): PendingMlsWelcome {
  return {
    id: 'welcome-1',
    wrapper_event_id: 'ev-1',
    nostr_group_id: 'group-1',
    group_name: 'Alpha',
    group_description: null,
    group_admin_pubkeys: [],
    group_relays: [],
    welcomer: 'npub1inviter',
    member_count: 3,
    ...overrides,
  };
}

function inputs(overrides: Partial<OfferedWelcomeInputs> = {}): OfferedWelcomeInputs {
  return {
    welcomes: [],
    squadIds: [],
    declinedGroupIds: [],
    pendingAdmissionGroupIds: [],
    blockedNpubs: new Set<string>(),
    joiningGroupIds: new Set<string>(),
    ...overrides,
  };
}

describe('offeredWelcomes', () => {
  it('maps every field from a plain pending welcome', () => {
    const w = welcome({
      id: 'welcome-9',
      nostr_group_id: 'group-9',
      group_name: 'Cool Squad',
      group_description: 'A place to hang',
      group_image_url: 'https://img/x.png',
      welcomer: 'npub1abc',
      member_count: 7,
    });
    const result = offeredWelcomes(inputs({ welcomes: [w] }));
    expect(result).toEqual([
      {
        id: 'welcome-9',
        groupId: 'group-9',
        name: 'Cool Squad',
        description: 'A place to hang',
        imageUrl: 'https://img/x.png',
        inviterNpub: 'npub1abc',
        memberCount: 7,
      },
    ]);
  });

  it('falls back name to the group id when group_name is empty or whitespace', () => {
    const w = welcome({ nostr_group_id: 'group-42', group_name: '   ' });
    const result = offeredWelcomes(inputs({ welcomes: [w] }));
    expect(result[0]!.name).toBe('group-42');
  });

  it('normalizes whitespace-only description and image url to null', () => {
    const w = welcome({ group_description: '   ', group_image_url: '  ' });
    const result = offeredWelcomes(inputs({ welcomes: [w] }));
    expect(result[0]!.description).toBeNull();
    expect(result[0]!.imageUrl).toBeNull();
  });

  it('filters out a welcome whose group is already a local squad', () => {
    const w = welcome({ nostr_group_id: 'group-1' });
    const result = offeredWelcomes(inputs({ welcomes: [w], squadIds: ['group-1'] }));
    expect(result).toEqual([]);
  });

  it('filters out a welcome whose group was already declined', () => {
    const w = welcome({ nostr_group_id: 'group-1' });
    const result = offeredWelcomes(inputs({ welcomes: [w], declinedGroupIds: ['group-1'] }));
    expect(result).toEqual([]);
  });

  it('filters out a welcome whose group has a pending consent-first admission', () => {
    const w = welcome({ nostr_group_id: 'group-1' });
    const result = offeredWelcomes(
      inputs({ welcomes: [w], pendingAdmissionGroupIds: ['group-1'] })
    );
    expect(result).toEqual([]);
  });

  it('filters out a welcome whose group has an accept already in flight', () => {
    const w = welcome({ nostr_group_id: 'group-1' });
    const result = offeredWelcomes(
      inputs({ welcomes: [w], joiningGroupIds: new Set(['group-1']) })
    );
    expect(result).toEqual([]);
  });

  it('filters out a welcome from a blocked npub', () => {
    const w = welcome({ welcomer: 'npub1blocked' });
    const result = offeredWelcomes(
      inputs({ welcomes: [w], blockedNpubs: new Set(['npub1blocked']) })
    );
    expect(result).toEqual([]);
  });

  describe('id-filter case and whitespace insensitivity', () => {
    it('a mixed-case squad id suppresses a lowercase welcome group id', () => {
      const w = welcome({ nostr_group_id: 'abc' });
      const result = offeredWelcomes(inputs({ welcomes: [w], squadIds: ['ABC'] }));
      expect(result).toEqual([]);
    });

    it('a padded squad id suppresses an unpadded welcome group id', () => {
      const w = welcome({ nostr_group_id: 'abc' });
      const result = offeredWelcomes(inputs({ welcomes: [w], squadIds: [' abc '] }));
      expect(result).toEqual([]);
    });

    it('a mixed-case declined group id suppresses the welcome', () => {
      const w = welcome({ nostr_group_id: 'abc' });
      const result = offeredWelcomes(inputs({ welcomes: [w], declinedGroupIds: ['Abc'] }));
      expect(result).toEqual([]);
    });

    it('a mixed-case pending-admission group id suppresses the welcome', () => {
      const w = welcome({ nostr_group_id: 'abc' });
      const result = offeredWelcomes(
        inputs({ welcomes: [w], pendingAdmissionGroupIds: ['ABC'] })
      );
      expect(result).toEqual([]);
    });

    it('a mixed-case joining group id suppresses the welcome', () => {
      const w = welcome({ nostr_group_id: 'abc' });
      const result = offeredWelcomes(
        inputs({ welcomes: [w], joiningGroupIds: new Set(['ABC']) })
      );
      expect(result).toEqual([]);
    });
  });

  it('dedups duplicate welcomes for the same group id, first one wins', () => {
    const first = welcome({ id: 'welcome-first', nostr_group_id: 'group-1', group_name: 'First' });
    const second = welcome({ id: 'welcome-second', nostr_group_id: 'GROUP-1', group_name: 'Second' });
    const result = offeredWelcomes(inputs({ welcomes: [first, second] }));
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('welcome-first');
    expect(result[0]!.name).toBe('First');
  });

  it('skips a welcome with an empty or missing nostr_group_id', () => {
    const empty = welcome({ nostr_group_id: '' });
    const whitespace = welcome({ id: 'welcome-ws', nostr_group_id: '   ' });
    const result = offeredWelcomes(inputs({ welcomes: [empty, whitespace] }));
    expect(result).toEqual([]);
  });

  it('preserves input order for offered entries', () => {
    const a = welcome({ id: 'a', nostr_group_id: 'group-a' });
    const b = welcome({ id: 'b', nostr_group_id: 'group-b' });
    const c = welcome({ id: 'c', nostr_group_id: 'group-c' });
    const result = offeredWelcomes(inputs({ welcomes: [b, c, a] }));
    expect(result.map((w) => w.id)).toEqual(['b', 'c', 'a']);
  });

  it('returns an empty array for an empty welcome list without mutating inputs', () => {
    const welcomes: PendingMlsWelcome[] = [];
    const squadIds = ['s1'];
    const result = offeredWelcomes(inputs({ welcomes, squadIds }));
    expect(result).toEqual([]);
    expect(welcomes).toEqual([]);
    expect(squadIds).toEqual(['s1']);
  });
});

describe('recordDeclinedWelcomeGroupId', () => {
  beforeEach(() => {
    declinedWelcomeGroupIds.set([]);
  });

  afterEach(() => {
    declinedWelcomeGroupIds.set([]);
  });

  it('appends a group id to the declinedWelcomeGroupIds store', () => {
    recordDeclinedWelcomeGroupId('group-1');
    expect(get(declinedWelcomeGroupIds)).toEqual(['group-1']);
  });

  it('is idempotent for the exact same id', () => {
    recordDeclinedWelcomeGroupId('group-1');
    recordDeclinedWelcomeGroupId('group-1');
    expect(get(declinedWelcomeGroupIds)).toEqual(['group-1']);
  });

  it('is idempotent across case and whitespace differences', () => {
    recordDeclinedWelcomeGroupId('group-1');
    recordDeclinedWelcomeGroupId('  GROUP-1  ');
    expect(get(declinedWelcomeGroupIds)).toEqual(['group-1']);
  });

  it('ignores empty or whitespace-only input', () => {
    recordDeclinedWelcomeGroupId('');
    recordDeclinedWelcomeGroupId('   ');
    expect(get(declinedWelcomeGroupIds)).toEqual([]);
  });
});
