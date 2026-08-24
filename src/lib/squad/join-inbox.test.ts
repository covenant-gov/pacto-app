import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  canAddJoinInboxHolder,
  canManageJoinInboxHolders,
  hasSquadAdminHolderManageRights,
  isJoinInboxHolderActionInFlight,
  resetJoinInboxHolderActionInFlight,
  rotateJoinInboxKey,
  addJoinInboxHolder,
  joinInboxHolderActionInFlight,
  joinInboxHolderActionInFlightRevision,
  JOIN_INBOX_META_SCHEMA,
} from './join-inbox';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../api/nostr', () => ({
  sendDmMessage: vi.fn().mockResolvedValue(undefined),
}));

import { invoke } from '@tauri-apps/api/core';

describe('canAddJoinInboxHolder', () => {
  const members = ['npub1a', 'npub1b', 'npub1c'];
  const holders = ['npub1a'];

  it('allows holder to add another member', () => {
    expect(canAddJoinInboxHolder(members, 'npub1a', 'npub1b', holders)).toBeNull();
  });

  it('rejects non-holder actor', () => {
    expect(canAddJoinInboxHolder(members, 'npub1b', 'npub1c', holders)).toMatch(/Join inbox holders/i);
  });

  it('rejects non-member target', () => {
    expect(canAddJoinInboxHolder(members, 'npub1a', 'npub1z', holders)).toMatch(/not a current/i);
  });

  it('rejects duplicate holder', () => {
    expect(canAddJoinInboxHolder(members, 'npub1a', 'npub1a', holders)).toMatch(/Already/i);
  });

  it('requires Full executor scope when Squad Admin is live', () => {
    expect(
      canAddJoinInboxHolder(members, 'npub1a', 'npub1b', holders, {
        squadAdminActive: true,
        executorRolesLabel: 'PAUSE',
      })
    ).toMatch(/Full executor/i);
    expect(
      canAddJoinInboxHolder(members, 'npub1a', 'npub1b', holders, {
        squadAdminActive: true,
        executorRolesLabel: 'Full',
      })
    ).toBeNull();
  });
});

describe('hasSquadAdminHolderManageRights', () => {
  it('accepts Full scope', () => {
    expect(hasSquadAdminHolderManageRights('Full')).toBe(true);
    expect(hasSquadAdminHolderManageRights('FULL, PAUSE')).toBe(true);
  });

  it('rejects paused or empty', () => {
    expect(hasSquadAdminHolderManageRights('Full (paused)')).toBe(false);
    expect(hasSquadAdminHolderManageRights('—')).toBe(false);
    expect(hasSquadAdminHolderManageRights(undefined)).toBe(false);
  });
});

describe('canManageJoinInboxHolders', () => {
  const state = {
    squadId: 's1',
    inboxNpub: 'npub1inbox',
    holders: ['npub1a'],
    keyEpoch: 1,
    updatedAt: 0,
    hasLocalSecret: true,
    iAmHolder: true,
  };

  it('requires local secret holder', () => {
    expect(
      canManageJoinInboxHolders({
        squadAdminActive: false,
        state: { ...state, hasLocalSecret: false },
      })
    ).toBe(false);
  });

  it('allows holder without Squad Admin', () => {
    expect(canManageJoinInboxHolders({ squadAdminActive: false, state })).toBe(true);
  });
});

describe('join inbox holder action in-flight', () => {
  beforeEach(() => {
    resetJoinInboxHolderActionInFlight();
  });

  afterEach(() => {
    resetJoinInboxHolderActionInFlight();
  });

  it('serializes mutations per squad', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    vi.mocked(invoke).mockImplementation(async () => {
      await gate;
      return {
        state: {
          squadId: 's1',
          inboxNpub: 'npub1inbox',
          holders: ['npub1a'],
          keyEpoch: 1,
          updatedAt: 1,
          hasLocalSecret: true,
          iAmHolder: true,
        },
        mlsAnnouncements: [],
        mlsInbox: [],
        keyShares: [],
      };
    });

    const pending = addJoinInboxHolder('s1', 'npub1b');
    await vi.waitFor(() => expect(isJoinInboxHolderActionInFlight('s1')).toBe(true));
    await expect(rotateJoinInboxKey('s1')).resolves.toEqual({
      ok: false,
      error: 'Join inbox holder update already in progress.',
    });
    expect(get(joinInboxHolderActionInFlight).has('s1')).toBe(true);
    expect(get(joinInboxHolderActionInFlightRevision)).toBeGreaterThan(0);
    release();
    await pending;
    expect(isJoinInboxHolderActionInFlight('s1')).toBe(false);
  });
});

describe('JOIN_INBOX_META_SCHEMA', () => {
  it('uses join inbox wire schema', () => {
    expect(JOIN_INBOX_META_SCHEMA).toBe('pacto.squad.join_inbox.meta.v1');
  });
});
