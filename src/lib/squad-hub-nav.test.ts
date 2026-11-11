import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
  resolveHubParentSquad,
  resolveOpenHubParent,
  parentIdForChannelGroup,
  restoreSquadsHubSelection,
  syncSquadsHubSelection,
  resolveHubChannelForSquad,
  resolveEffectiveHubChannel,
  governanceChannelIdForSidebarClick,
} from './squad-hub-nav';
import {
  activeSquadId,
  activeChannelId,
  activeTopNavTab,
  lastChannelBySquadId,
  lastOpenedSquadId,
} from '../stores/navigation';
  import {
  squads,
  squadInfraByParentId,
  SETTINGS_CHANNEL_ID,
  SQUAD_GOVERNANCE_CHANNEL_ID,
  SQUAD_WARGAME_CHANNEL_ID,
  type Squad,
} from '../stores/squads';

const regular: Squad = {
  id: 'squad-a',
  name: 'Squad A',
  channels: [],
  kind: 'squad',
  createdAt: 1,
  updatedAt: 1,
};

const pair: Squad = {
  id: 'pair-ab',
  name: 'A ↔ B',
  channels: [],
  kind: 'squad-pair',
  pairedSquads: [
    { id: 'squad-a', name: 'Squad A' },
    { id: 'squad-b', name: 'Squad B' },
  ],
  createdAt: 2,
  updatedAt: 2,
};

describe('resolveHubParentSquad', () => {
  it('finds squad by id', () => {
    expect(resolveHubParentSquad([regular, pair], 'pair-ab')).toEqual(pair);
  });

  it('returns undefined for null squad id', () => {
    expect(resolveHubParentSquad([regular], null)).toBeUndefined();
  });
});

describe('resolveOpenHubParent', () => {
  it('resolves from activeSquadId', () => {
    expect(resolveOpenHubParent([regular, pair], 'pair-ab')).toEqual(pair);
  });

  it('returns null when no matching parent', () => {
    expect(resolveOpenHubParent([regular], 'missing')).toBeNull();
  });

  it('returns null for null squad id', () => {
    expect(resolveOpenHubParent([regular], null)).toBeNull();
  });
});

describe('parentIdForChannelGroup', () => {
  const squadWithChannels: Squad = {
    ...regular,
    channels: [
      { name: 'announcements', groupId: 'g-ann', order: 0 },
      { name: 'general', groupId: 'g-gen', order: 1 },
    ],
  };

  it('resolves announcements group id to parent squad', () => {
    expect(parentIdForChannelGroup([squadWithChannels], 'g-ann')).toBe('squad-a');
  });

  it('resolves child channel group id to parent squad', () => {
    expect(parentIdForChannelGroup([squadWithChannels], 'g-gen')).toBe('squad-a');
  });

  it('returns null when group is unknown', () => {
    expect(parentIdForChannelGroup([squadWithChannels], 'missing')).toBeNull();
  });

  it('returns parent when group id equals squad id', () => {
    expect(parentIdForChannelGroup([squadWithChannels], 'squad-a')).toBe('squad-a');
  });

  it('returns null for blank group id', () => {
    expect(parentIdForChannelGroup([squadWithChannels], '  ')).toBeNull();
  });
});

describe('resolveHubChannelForSquad', () => {
  afterEach(() => {
    squadInfraByParentId.set({});
  });
  it('defaults to Wargame when no last channel and no live pacto_gov', () => {
    const squad: Squad = {
      ...regular,
      channels: [{ name: 'announcements', groupId: 'g1', order: 0 }],
    };
    squadInfraByParentId.set({ 'squad-a': [] });
    const { channelId } = resolveHubChannelForSquad(squad, {}, {});
    expect(channelId).toBe(SQUAD_WARGAME_CHANNEL_ID);
  });

  it('defaults to Live when no last channel and live pacto_gov exists', () => {
    const squad: Squad = {
      ...regular,
      channels: [{ name: 'announcements', groupId: 'g1', order: 0 }],
    };
    squadInfraByParentId.set({
      'squad-a': [
        {
          id: 'pg-squad-a',
          parentId: 'squad-a',
          infraType: 'pacto_gov',
          chain: 'base',
          canonicalRef: '1',
          createdAtMs: 1,
          updatedAtMs: 1,
        },
      ],
    });
    expect(resolveHubChannelForSquad(squad, {}, {}).channelId).toBe(SQUAD_GOVERNANCE_CHANNEL_ID);
  });

  it('restores last dashboard and MLS channel selections', () => {
    const squad: Squad = {
      ...regular,
      channels: [
        { name: 'announcements', groupId: 'g1', order: 0 },
        { name: 'ops', groupId: 'g-ops', order: 1 },
      ],
    };
    expect(
      resolveHubChannelForSquad(squad, { 'squad-a': SQUAD_GOVERNANCE_CHANNEL_ID }, {}).channelId,
    ).toBe(SQUAD_GOVERNANCE_CHANNEL_ID);
    expect(
      resolveHubChannelForSquad(squad, { 'squad-a': 'g-ops' }, {}).channelId,
    ).toBe('g-ops');
  });

  it('restores last Wargame stack without requiring war-game infra', () => {
    const squad: Squad = {
      ...regular,
      channels: [{ name: 'announcements', groupId: 'g1', order: 0 }],
    };
    squadInfraByParentId.set({ 'squad-a': [] });
    expect(
      resolveHubChannelForSquad(squad, { 'squad-a': SQUAD_WARGAME_CHANNEL_ID }, {}).channelId,
    ).toBe(SQUAD_WARGAME_CHANNEL_ID);
  });

  it('keeps last Wargame stack while infra has not hydrated', () => {
    const squad: Squad = {
      ...regular,
      channels: [{ name: 'announcements', groupId: 'g1', order: 0 }],
    };
    expect(
      resolveHubChannelForSquad(squad, { 'squad-a': SQUAD_WARGAME_CHANNEL_ID }, {}).channelId,
    ).toBe(SQUAD_WARGAME_CHANNEL_ID);
  });
});

describe('governanceChannelIdForSidebarClick', () => {
  afterEach(() => {
    squadInfraByParentId.set({});
  });

  it('restores last chrome id', () => {
    expect(
      governanceChannelIdForSidebarClick('squad-a', { 'squad-a': SQUAD_GOVERNANCE_CHANNEL_ID }),
    ).toBe(SQUAD_GOVERNANCE_CHANNEL_ID);
    expect(
      governanceChannelIdForSidebarClick('squad-a', { 'squad-a': SQUAD_WARGAME_CHANNEL_ID }),
    ).toBe(SQUAD_WARGAME_CHANNEL_ID);
  });

  it('defaults to Wargame when no last chrome id and no live gov', () => {
    squadInfraByParentId.set({ 'squad-a': [] });
    expect(governanceChannelIdForSidebarClick('squad-a', {})).toBe(SQUAD_WARGAME_CHANNEL_ID);
  });
});

describe('restoreSquadsHubSelection', () => {
  beforeEach(() => {
    squads.set([]);
    activeSquadId.set(null);
    activeChannelId.set(null);
    lastOpenedSquadId.set(null);
    lastChannelBySquadId.set({});
    squadInfraByParentId.set({});
    activeTopNavTab.set('squads');
  });

  afterEach(() => {
    squads.set([]);
    activeSquadId.set(null);
    activeChannelId.set(null);
    lastOpenedSquadId.set(null);
    lastChannelBySquadId.set({});
    squadInfraByParentId.set({});
    activeTopNavTab.set('squads');
  });

  it('selects last opened squad on squads tab', () => {
    squads.set([
      { ...regular, channels: [{ name: 'announcements', groupId: 'g1', order: 0 }] },
      { ...pair, channels: [{ name: 'announcements', groupId: 'g2', order: 0 }] },
    ]);
    lastOpenedSquadId.set('pair-ab');
    restoreSquadsHubSelection();
    expect(get(activeSquadId)).toBe('pair-ab');
    expect(get(activeChannelId)).toBe(SQUAD_WARGAME_CHANNEL_ID);
  });

  it('selects first squad when last opened is missing', () => {
    squads.set([regular, pair]);
    restoreSquadsHubSelection();
    expect(get(activeSquadId)).toBe('squad-a');
  });

  it('fills missing channel when squad is already active', () => {
    squads.set([
      { ...regular, channels: [{ name: 'announcements', groupId: 'g1', order: 0 }] },
    ]);
    activeSquadId.set('squad-a');
    activeChannelId.set(null);
    syncSquadsHubSelection();
    expect(get(activeChannelId)).toBe(SQUAD_WARGAME_CHANNEL_ID);
  });

  it('resolveEffectiveHubChannel defaults to Wargame when channel is missing', () => {
    const squad: Squad = {
      ...regular,
      channels: [{ name: 'announcements', groupId: 'g1', order: 0 }],
    };
    squadInfraByParentId.set({ 'squad-a': [] });
    const resolved = resolveEffectiveHubChannel(squad, null, {}, {});
    expect(resolved.channelId).toBe(SQUAD_WARGAME_CHANNEL_ID);
  });

  it('resolveEffectiveHubChannel defaults to Wargame when squad has no MLS channels yet', () => {
    squadInfraByParentId.set({ 'squad-a': [] });
    const resolved = resolveEffectiveHubChannel(regular, null, {}, {});
    expect(resolved.channelId).toBe(SQUAD_WARGAME_CHANNEL_ID);
  });

  it('resolveEffectiveHubChannel remaps obsolete my-dashboard to settings', () => {
    const squad: Squad = {
      ...regular,
      channels: [{ name: 'announcements', groupId: 'g1', order: 0 }],
    };
    const resolved = resolveEffectiveHubChannel(squad, '__my_dashboard__', {}, {});
    expect(resolved.channelId).toBe(SETTINGS_CHANNEL_ID);
    expect(resolved.hubChannelName).toBeNull();
  });

  it('resolveEffectiveHubChannel keeps Wargame stack without war-game infra', () => {
    const squad: Squad = {
      ...regular,
      channels: [{ name: 'announcements', groupId: 'g1', order: 0 }],
    };
    squadInfraByParentId.set({ 'squad-a': [] });
    const resolved = resolveEffectiveHubChannel(squad, SQUAD_WARGAME_CHANNEL_ID, {}, {});
    expect(resolved.channelId).toBe(SQUAD_WARGAME_CHANNEL_ID);
    expect(resolved.hubChannelName).toBeNull();
  });

  it('clears active squad when catalog is empty', () => {
    activeSquadId.set('creating-squad-99');
    activeChannelId.set('creating-squad-99');
    syncSquadsHubSelection();
    expect(get(activeSquadId)).toBeNull();
    expect(get(activeChannelId)).toBeNull();
  });

  it('reassigns stale creating-squad id to first catalog row', () => {
    squads.set([
      { ...regular, id: 'grp-real', channels: [{ name: 'announcements', groupId: 'grp-real', order: 0 }] },
    ]);
    squadInfraByParentId.set({ 'grp-real': [] });
    activeSquadId.set('creating-squad-99');
    activeChannelId.set('creating-squad-99');
    syncSquadsHubSelection();
    expect(get(activeSquadId)).toBe('grp-real');
    expect(get(activeChannelId)).toBe(SQUAD_WARGAME_CHANNEL_ID);
  });
});
