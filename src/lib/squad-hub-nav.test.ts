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
} from './squad-hub-nav';
import {
  activeSquadId,
  activeChannelId,
  activeTopNavTab,
  lastChannelBySquadId,
  lastOpenedSquadId,
} from '../stores/navigation';
import { squads, DASHBOARD_CHANNEL_ID, type Squad } from '../stores/squads';

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
});

describe('resolveOpenHubParent', () => {
  it('resolves from activeSquadId', () => {
    expect(resolveOpenHubParent([regular, pair], 'pair-ab')).toEqual(pair);
  });

  it('returns null when no matching parent', () => {
    expect(resolveOpenHubParent([regular], 'missing')).toBeNull();
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
});

describe('resolveHubChannelForSquad', () => {
  it('defaults to dashboard when no per-squad last channel', () => {
    const squad: Squad = {
      ...regular,
      channels: [{ name: 'announcements', groupId: 'g1', order: 0 }],
    };
    const { channelId } = resolveHubChannelForSquad(squad, {}, {});
    expect(channelId).toBe(DASHBOARD_CHANNEL_ID);
  });
});

describe('restoreSquadsHubSelection', () => {
  beforeEach(() => {
    squads.set([]);
    activeSquadId.set(null);
    activeChannelId.set(null);
    lastOpenedSquadId.set(null);
    lastChannelBySquadId.set({});
    activeTopNavTab.set('squads');
  });

  afterEach(() => {
    squads.set([]);
    activeSquadId.set(null);
    activeChannelId.set(null);
    lastOpenedSquadId.set(null);
    lastChannelBySquadId.set({});
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
    expect(get(activeChannelId)).toBe(DASHBOARD_CHANNEL_ID);
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
    expect(get(activeChannelId)).toBe(DASHBOARD_CHANNEL_ID);
  });

  it('resolveEffectiveHubChannel defaults to dashboard when channel is missing', () => {
    const squad: Squad = {
      ...regular,
      channels: [{ name: 'announcements', groupId: 'g1', order: 0 }],
    };
    const resolved = resolveEffectiveHubChannel(squad, null, {}, {});
    expect(resolved.channelId).toBe(DASHBOARD_CHANNEL_ID);
  });

  it('resolveEffectiveHubChannel defaults to dashboard when squad has no MLS channels yet', () => {
    const resolved = resolveEffectiveHubChannel(regular, null, {}, {});
    expect(resolved.channelId).toBe(DASHBOARD_CHANNEL_ID);
  });
});
