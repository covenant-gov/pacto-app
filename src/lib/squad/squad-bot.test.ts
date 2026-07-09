import { describe, expect, it } from 'vitest';
import {
  canAddBotHolder,
  canManageBotHolders,
  hasSquadAdminHolderManageRights,
  SQUAD_BOT_META_SCHEMA,
} from './squad-bot';

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
