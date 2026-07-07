import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../api/nostr', () => ({
  createGroupChat: vi.fn(),
  formatChannelInSquadMessage: vi.fn(),
  sendDmMessage: vi.fn(),
}));

vi.mock('../parent-navbar', () => ({
  getAnnouncementsChannel: vi.fn(),
  loadMembersForParent: vi.fn(),
}));

vi.mock('../mls/virtual-channel-bucket', () => ({
  resolveHubChannelNameForGroupSelection: vi.fn(),
}));

vi.mock('../utils/tauri-errors', () => ({
  getInvokeErrorMessage: vi.fn((e: unknown) =>
    e instanceof Error ? e.message : String(e)
  ),
  friendlyMessage: vi.fn((msg: string) => msg),
}));

vi.mock('../squad/squad-catalog', () => ({
  persistSquadPatch: vi.fn(),
}));

vi.mock('../../stores/squads', () => ({
  squads: createMockWritable<Squad[]>([]),
  DASHBOARD_CHANNEL_ID: '__dashboard__',
}));

vi.mock('../../stores/navigation', () => ({
  activeSquadId: createMockWritable<string | null>(null),
  activeChannelId: createMockWritable<string | null>(null),
  activeHubChannelName: createMockWritable<string | null>(null),
  activeView: createMockWritable<'hub' | 'profile'>('hub'),
  lastChannelBySquadId: createMockWritable<Record<string, string>>({}),
  lastHubChannelNameBySquadId: createMockWritable<Record<string, string>>({}),
}));

import { createGroupChat, formatChannelInSquadMessage, sendDmMessage } from '../api/nostr';
import { getAnnouncementsChannel, loadMembersForParent } from '../parent-navbar';
import { resolveHubChannelNameForGroupSelection } from '../mls/virtual-channel-bucket';
import { persistSquadPatch } from '../squad/squad-catalog';
import { squads, type Squad } from '../../stores/squads';
import {
  activeChannelId,
  activeHubChannelName,
  activeView,
  lastChannelBySquadId,
  lastHubChannelNameBySquadId,
} from '../../stores/navigation';
import {
  loadCreateChannelMemberList,
  runCreateChannelInParent,
} from './create-channel-flow';

function createMockWritable<T>(initial: T) {
  let value = initial;
  const subscribers = new Set<(v: T) => void>();
  return {
    set: (v: T) => {
      value = v;
      subscribers.forEach((fn) => fn(v));
    },
    update: (fn: (v: T) => T) => {
      value = fn(value);
      subscribers.forEach((fn) => fn(value));
    },
    subscribe: (fn: (v: T) => void) => {
      fn(value);
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}

const parent: Squad = {
  id: 'parent-1',
  name: 'Alpha',
  channels: [
    { name: 'announcements', groupId: 'g-announce', order: 0 },
    { name: 'general', groupId: 'g-general', order: 1 },
  ],
  kind: 'squad',
  createdAt: 1,
  updatedAt: 1,
};

describe('loadCreateChannelMemberList', () => {
  it('delegates to loadMembersForParent', async () => {
    vi.mocked(loadMembersForParent).mockResolvedValue(['npub-a', 'npub-b']);
    const members = await loadCreateChannelMemberList(parent, 'npub-me');
    expect(loadMembersForParent).toHaveBeenCalledWith(parent, 'npub-me');
    expect(members).toEqual(['npub-a', 'npub-b']);
  });
});

describe('runCreateChannelInParent', () => {
  beforeEach(() => {
    squads.set([parent]);
    activeChannelId.set('g-announce');
    activeHubChannelName.set('announcements');
    activeView.set('hub');
    lastChannelBySquadId.set({});
    lastHubChannelNameBySquadId.set({});

    vi.mocked(createGroupChat).mockReset().mockResolvedValue('g-new-channel');
    vi.mocked(formatChannelInSquadMessage).mockReset().mockReturnValue('channel-in-squad-payload');
    vi.mocked(sendDmMessage).mockReset().mockResolvedValue(true);
    vi.mocked(getAnnouncementsChannel).mockReset().mockReturnValue({
      name: 'announcements',
      groupId: 'g-announce',
      order: 0,
    });
    vi.mocked(resolveHubChannelNameForGroupSelection).mockReset().mockReturnValue('announcements');
    vi.mocked(persistSquadPatch).mockReset().mockImplementation(async (parentId, patch) => {
      squads.update((list) =>
        list.map((s) => (s.id !== parentId ? s : patch(s)))
      );
      return get(squads).find((s) => s.id === parentId) || null;
    });
  });

  afterEach(() => {
    squads.set([]);
    activeChannelId.set(null);
    activeHubChannelName.set(null);
    activeView.set('hub');
    lastChannelBySquadId.set({});
    lastHubChannelNameBySquadId.set({});
  });

  it('optimistically creates a placeholder channel and updates navigation', async () => {
    const onErrorBanner = vi.fn();
    runCreateChannelInParent({
      parent,
      squadId: 'parent-1',
      name: 'new-channel',
      selectedNpubs: ['npub-a'],
      onErrorBanner,
    });

    const state = get(squads);
    expect(state[0]?.channels).toHaveLength(3);
    const placeholder = state[0]?.channels.find((c) => c.name === 'new-channel');
    expect(placeholder?.groupId).toMatch(/^creating-\d+$/);
    expect(placeholder?.order).toBe(2);

    expect(get(activeChannelId)).toBe(placeholder?.groupId);
    expect(get(activeHubChannelName)).toBe('new-channel');
    expect(get(activeView)).toBe('hub');
    expect(get(lastChannelBySquadId)['parent-1']).toBe(placeholder?.groupId);
    expect(get(lastHubChannelNameBySquadId)['parent-1']).toBe('new-channel');
  });

  it('replaces the placeholder after MLS create and sends DMs', async () => {
    const onErrorBanner = vi.fn();
    runCreateChannelInParent({
      parent,
      squadId: 'parent-1',
      name: 'new-channel',
      selectedNpubs: ['npub-a', 'npub-b'],
      onErrorBanner,
    });

    await vi.waitFor(() => {
      expect(createGroupChat).toHaveBeenCalledWith('new-channel', ['npub-a', 'npub-b']);
    });

    await vi.waitFor(() => {
      expect(persistSquadPatch).toHaveBeenCalled();
    });

    const state = get(squads);
    expect(state[0]?.channels).toHaveLength(3);
    expect(state[0]?.channels.some((c) => c.groupId === 'g-new-channel')).toBe(true);
    expect(state[0]?.channels.some((c) => c.groupId.startsWith('creating-'))).toBe(false);

    expect(formatChannelInSquadMessage).toHaveBeenCalledWith({
      type: 'channel_in_squad',
      squadName: 'Alpha',
      announcementsGroupId: 'g-announce',
      channelGroupId: 'g-new-channel',
      channelName: 'new-channel',
    });

    await vi.waitFor(() => {
      expect(sendDmMessage).toHaveBeenCalledTimes(2);
    });

    expect(sendDmMessage).toHaveBeenCalledWith('npub-a', 'channel-in-squad-payload');
    expect(sendDmMessage).toHaveBeenCalledWith('npub-b', 'channel-in-squad-payload');

    expect(onErrorBanner).not.toHaveBeenCalled();
  });

  it('continues sending DMs when one recipient fails', async () => {
    vi.mocked(sendDmMessage)
      .mockRejectedValueOnce(new Error('dm failed'))
      .mockResolvedValue(true);
    const onErrorBanner = vi.fn();

    runCreateChannelInParent({
      parent,
      squadId: 'parent-1',
      name: 'new-channel',
      selectedNpubs: ['npub-a', 'npub-b'],
      onErrorBanner,
    });

    await vi.waitFor(() => {
      expect(sendDmMessage).toHaveBeenCalledTimes(2);
    });

    expect(sendDmMessage).toHaveBeenCalledWith('npub-a', 'channel-in-squad-payload');
    expect(sendDmMessage).toHaveBeenCalledWith('npub-b', 'channel-in-squad-payload');
    expect(onErrorBanner).not.toHaveBeenCalled();
  });

  it('rolls back on error and shows a banner', async () => {
    vi.mocked(createGroupChat).mockRejectedValueOnce(new Error('mls failed'));
    const onErrorBanner = vi.fn();

    runCreateChannelInParent({
      parent,
      squadId: 'parent-1',
      name: 'new-channel',
      selectedNpubs: ['npub-a'],
      onErrorBanner,
    });

    await vi.waitFor(() => {
      expect(onErrorBanner).toHaveBeenCalledWith('mls failed');
    });

    const state = get(squads);
    expect(state[0]?.channels).toHaveLength(2);
    expect(state[0]?.channels.some((c) => c.groupId.startsWith('creating-'))).toBe(false);
  });
});
