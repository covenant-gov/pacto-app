import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { get, writable } from 'svelte/store';

const acceptMlsWelcomeMock = vi.fn();
const requireBackupVerifiedMock = vi.fn(() => true);
const finalizeMock = vi.fn();

// accept-invite.ts drags in squad-catalog / outbound-invite / backup-verification /
// dm-debug, none of which recordDeclinedWelcomeGroupId ever calls, but importing the
// module runs their top-level code. Mirror accept-invite.test.ts's mocks so import
// doesn't reach real Tauri invokes.
vi.mock('../squad/squad-catalog', () => ({
  persistSquadPatch: vi.fn(),
  persistSquad: vi.fn(),
}));

vi.mock('../../stores/backup-verification', () => ({
  requireBackupVerified: () => requireBackupVerifiedMock(),
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

vi.mock('../api/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/nostr')>();
  return {
    ...actual,
    acceptMlsWelcome: (...args: unknown[]) => acceptMlsWelcomeMock(...args),
  };
});

vi.mock('./accept-invite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./accept-invite')>();
  return {
    ...actual,
    finalizeSquadAfterAnnouncementsWelcome: (...args: unknown[]) => finalizeMock(...args),
  };
});

import {
  acceptOfferedWelcome,
  MAX_OFFERED_WELCOMES,
  offeredWelcomeFromPendingMls,
  offeredWelcomes,
  recordDeclinedWelcomeGroupId,
  clearDeclinedWelcomeGroupId,
  type OfferedWelcome,
  type OfferedWelcomeInputs,
} from './pending-welcomes';
import { declinedWelcomeGroupIds } from '../../stores/invite-decisions';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import {
  getPendingWelcomeFinalizationByGroupId,
  pendingWelcomeFinalizations,
  resetPendingWelcomeFinalizations,
  upsertPendingWelcomeFinalization,
} from '../../stores/pending-welcome-finalization';
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
    unmaterialized: [],
    ...overrides,
  };
}

function offered(overrides: Partial<OfferedWelcome> = {}): OfferedWelcome {
  return {
    id: 'welcome-1',
    groupId: 'group-1',
    name: 'Alpha',
    description: null,
    imageUrl: null,
    inviterNpub: 'npub1inviter',
    memberCount: 3,
    ...overrides,
  };
}

describe('offeredWelcomes', () => {
  it('offeredWelcomeFromPendingMls copies engine fields onto the card payload', () => {
    expect(offeredWelcomeFromPendingMls(welcome({ group_image_url: 'https://example/img.png' }))).toEqual(
      offered({ imageUrl: 'https://example/img.png' })
    );
  });

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

  it('still offers a welcome whose group has an accept already in flight', () => {
    const w = welcome({ nostr_group_id: 'group-1' });
    const result = offeredWelcomes(inputs({ welcomes: [w] }));
    expect(result).toHaveLength(1);
    expect(result[0]!.groupId).toBe('group-1');
  });

  it('includes an unmaterialized welcome even when it is gone from pendingMlsWelcomes', () => {
    const extra = offered({ id: 'welcome-stuck', groupId: 'group-stuck', name: 'Stuck' });
    const result = offeredWelcomes(inputs({ unmaterialized: [extra] }));
    expect(result).toEqual([extra]);
  });

  it('does not duplicate an unmaterialized welcome that is still in the pending list', () => {
    const w = welcome({ id: 'welcome-1', nostr_group_id: 'group-1' });
    const extra = offered({ id: 'welcome-1', groupId: 'group-1' });
    const result = offeredWelcomes(inputs({ welcomes: [w], unmaterialized: [extra] }));
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('welcome-1');
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

    it('a mixed-case unmaterialized group id is suppressed by a squad id', () => {
      const extra = offered({ groupId: 'abc' });
      const result = offeredWelcomes(inputs({ squadIds: ['ABC'], unmaterialized: [extra] }));
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

  it('caps pending welcomes to the newest MAX_OFFERED_WELCOMES entries', () => {
    const welcomes = Array.from({ length: MAX_OFFERED_WELCOMES + 5 }, (_, i) =>
      welcome({ id: `welcome-${i}`, nostr_group_id: `group-${i}` })
    );
    const result = offeredWelcomes(inputs({ welcomes }));
    expect(result).toHaveLength(MAX_OFFERED_WELCOMES);
    expect(result.map((w) => w.id)).toEqual(
      welcomes.slice(0, MAX_OFFERED_WELCOMES).map((w) => w.id)
    );
  });

  it('does not drop an unmaterialized recovery row when the pending list is at the cap', () => {
    const welcomes = Array.from({ length: MAX_OFFERED_WELCOMES }, (_, i) =>
      welcome({ id: `welcome-${i}`, nostr_group_id: `group-${i}` })
    );
    const extra = offered({ id: 'welcome-stuck', groupId: 'group-stuck', name: 'Stuck' });
    const result = offeredWelcomes(inputs({ welcomes, unmaterialized: [extra] }));
    expect(result[0]).toEqual(extra);
    expect(result).toHaveLength(MAX_OFFERED_WELCOMES + 1);
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

  it('clearDeclinedWelcomeGroupId removes a prior decline', () => {
    recordDeclinedWelcomeGroupId('group-1');
    clearDeclinedWelcomeGroupId('group-1');
    expect(get(declinedWelcomeGroupIds)).toEqual([]);
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

describe('acceptOfferedWelcome', () => {
  beforeEach(() => {
    acceptMlsWelcomeMock.mockReset().mockResolvedValue(true);
    requireBackupVerifiedMock.mockReset().mockReturnValue(true);
    finalizeMock.mockReset().mockResolvedValue(undefined);
    resetPendingWelcomeFinalizations();
    setCurrentNpubForPersistence('npub1invitee');
  });

  afterEach(() => {
    resetPendingWelcomeFinalizations();
    setCurrentNpubForPersistence(null);
  });

  it('accepts the welcome, materializes the squad, and does not record an invite id', async () => {
    await acceptOfferedWelcome(offered());
    expect(acceptMlsWelcomeMock).toHaveBeenCalledOnce();
    expect(acceptMlsWelcomeMock).toHaveBeenCalledWith('welcome-1');
    expect(finalizeMock).toHaveBeenCalledOnce();
    expect(finalizeMock).toHaveBeenCalledWith({ groupId: 'group-1', name: 'Alpha' }, null);
    expect(get(pendingWelcomeFinalizations)).toEqual([]);
  });

  it('propagates acceptMlsWelcome rejection and does not finalize', async () => {
    acceptMlsWelcomeMock.mockRejectedValueOnce(new Error('engine down'));
    await expect(acceptOfferedWelcome(offered())).rejects.toThrow('engine down');
    expect(finalizeMock).not.toHaveBeenCalled();
    expect(get(pendingWelcomeFinalizations)).toEqual([]);
  });

  it('keeps a durable finalization record when finalize fails, and retry skips acceptMlsWelcome', async () => {
    finalizeMock.mockRejectedValueOnce(new Error('persist failed'));
    await expect(acceptOfferedWelcome(offered())).rejects.toThrow('persist failed');
    expect(acceptMlsWelcomeMock).toHaveBeenCalledOnce();
    const stuck = getPendingWelcomeFinalizationByGroupId('group-1');
    expect(stuck).toMatchObject({ welcomeId: 'welcome-1', groupId: 'group-1', name: 'Alpha' });

    finalizeMock.mockResolvedValueOnce(undefined);
    await acceptOfferedWelcome(offered());
    expect(acceptMlsWelcomeMock).toHaveBeenCalledOnce();
    expect(finalizeMock).toHaveBeenCalledTimes(2);
    expect(getPendingWelcomeFinalizationByGroupId('group-1')).toBeUndefined();
  });

  it('aborts store mutations when the active npub changes after engine accept', async () => {
    acceptMlsWelcomeMock.mockImplementation(async () => {
      setCurrentNpubForPersistence('npub1other');
    });
    await expect(acceptOfferedWelcome(offered())).rejects.toThrow(
      'Account changed during welcome accept'
    );
    expect(finalizeMock).not.toHaveBeenCalled();
    expect(get(pendingWelcomeFinalizations)).toEqual([]);
  });

  it('skips acceptMlsWelcome when a finalization record already exists', async () => {
    upsertPendingWelcomeFinalization({
      welcomeId: 'welcome-1',
      groupId: 'group-1',
      name: 'Alpha',
      description: null,
      imageUrl: null,
      inviterNpub: 'npub1inviter',
      memberCount: 3,
      acceptedAt: 1,
    });
    await acceptOfferedWelcome(offered());
    expect(acceptMlsWelcomeMock).not.toHaveBeenCalled();
    expect(finalizeMock).toHaveBeenCalledOnce();
    expect(getPendingWelcomeFinalizationByGroupId('group-1')).toBeUndefined();
  });

  it('rejects and never calls acceptMlsWelcome when backup verification is not satisfied', async () => {
    requireBackupVerifiedMock.mockReturnValueOnce(false);
    await expect(acceptOfferedWelcome(offered())).rejects.toThrow('Backup verification required');
    expect(acceptMlsWelcomeMock).not.toHaveBeenCalled();
  });
});
