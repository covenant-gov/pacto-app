import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  canAddBotHolder,
  canManageBotHolders,
  hasSquadAdminHolderManageRights,
  isSquadBotHolderActionInFlight,
  resetSquadBotHolderActionInFlight,
  rotateSquadBotKey,
  addSquadBotHolder,
  squadBotHolderActionInFlight,
  squadBotHolderActionInFlightRevision,
  SQUAD_BOT_META_SCHEMA,
} from './squad-bot';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../api/nostr', () => ({
  sendDmMessage: vi.fn().mockResolvedValue(undefined),
}));

import { invoke } from '@tauri-apps/api/core';

describe('canAddBotHolder', () => {
  const members = ['npub1a', 'npub1b', 'npub1c'];
  const holders = ['npub1a'];

  it('allows holder to add another member', () => {
    expect(canAddBotHolder(members, 'npub1a', 'npub1b', holders)).toBeNull();
  });

  it('rejects non-holder actor', () => {
    expect(canAddBotHolder(members, 'npub1b', 'npub1c', holders)).toMatch(/key holders/i);
  });

  it('rejects non-member target', () => {
    expect(canAddBotHolder(members, 'npub1a', 'npub1z', holders)).toMatch(/not a current/i);
  });

  it('rejects duplicate holder', () => {
    expect(canAddBotHolder(members, 'npub1a', 'npub1a', holders)).toMatch(/Already/i);
  });

  it('requires Full executor scope when Squad Admin is live', () => {
    expect(
      canAddBotHolder(members, 'npub1a', 'npub1b', holders, {
        squadAdminActive: true,
        executorRolesLabel: 'PAUSE',
      })
    ).toMatch(/Full executor/i);
    expect(
      canAddBotHolder(members, 'npub1a', 'npub1b', holders, {
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

describe('canManageBotHolders', () => {
  const state = {
    squadId: 's1',
    botNpub: 'npub1bot',
    holders: ['npub1a'],
    keyEpoch: 1,
    updatedAt: 1,
    hasLocalSecret: true,
    iAmHolder: true,
  };

  it('allows any holder before Squad Admin', () => {
    expect(canManageBotHolders({ squadAdminActive: false, state })).toBe(true);
  });

  it('requires Full scope after Squad Admin', () => {
    expect(
      canManageBotHolders({ squadAdminActive: true, executorRolesLabel: 'PAUSE', state })
    ).toBe(false);
    expect(
      canManageBotHolders({ squadAdminActive: true, executorRolesLabel: 'Full', state })
    ).toBe(true);
  });
});

describe('squad bot schema constants', () => {
  it('matches wire doc', () => {
    expect(SQUAD_BOT_META_SCHEMA).toBe('pacto.squad_bot.meta.v1');
  });
});

describe('squad bot holder action in-flight', () => {
  beforeEach(() => {
    resetSquadBotHolderActionInFlight();
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    resetSquadBotHolderActionInFlight();
  });

  it('reset clears in-flight set', () => {
    squadBotHolderActionInFlight.set(new Set(['s1']));
    squadBotHolderActionInFlightRevision.set(3);
    resetSquadBotHolderActionInFlight();
    expect(isSquadBotHolderActionInFlight('s1')).toBe(false);
    expect(get(squadBotHolderActionInFlight).size).toBe(0);
    expect(get(squadBotHolderActionInFlightRevision)).toBe(0);
  });

  it('marks during mutator and rejects concurrent action', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const state = {
      squadId: 's1',
      botNpub: 'npub1bot',
      holders: ['npub1a', 'npub1b'],
      keyEpoch: 1,
      updatedAt: 1,
      hasLocalSecret: true,
      iAmHolder: true,
    };
    vi.mocked(invoke).mockImplementation(async () => {
      expect(isSquadBotHolderActionInFlight('s1')).toBe(true);
      await gate;
      return {
        state,
        mlsAnnouncements: [],
        mlsInbox: [],
        keyShares: [],
      };
    });

    const pending = addSquadBotHolder('s1', 'npub1b');
    await vi.waitFor(() => expect(isSquadBotHolderActionInFlight('s1')).toBe(true));
    await expect(rotateSquadBotKey('s1')).resolves.toEqual({
      ok: false,
      error: 'Bot holder update already in progress.',
    });

    release();
    await expect(pending).resolves.toEqual({ ok: true, state });
    expect(isSquadBotHolderActionInFlight('s1')).toBe(false);
  });
});
