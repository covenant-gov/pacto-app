import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../api/nostr', () => ({
  createGroupChat: vi.fn(),
  formatChannelInSquadMessage: vi.fn(),
  sendDmMessage: vi.fn(),
}));

vi.mock('../squad/skipped-members', () => ({
  warnSkippedMembers: vi.fn(),
  skippedMembersNotice: vi.fn((skipped: unknown[]) => (skipped.length ? 'skipped-notice' : '')),
  warnPendingInvites: vi.fn(),
  pendingInvitesNotice: vi.fn((pending: unknown[]) => (pending.length ? 'pending-notice' : '')),
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

vi.mock('../squad/squad-channels-catalog', () => ({
  publishSquadChannelsCatalog: vi.fn(),
}));

vi.mock('../../stores/toast', () => ({
  showToast: vi.fn(),
}));

vi.mock('../../stores/squads', () => ({
  squads: createMockWritable<Squad[]>([]),
  SQUAD_DASHBOARD_CHANNEL_ID: '__squad_dashboard__',
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
import { warnSkippedMembers, warnPendingInvites } from '../squad/skipped-members';
import { getAnnouncementsChannel, loadMembersForParent } from '../parent-navbar';
import { resolveHubChannelNameForGroupSelection } from '../mls/virtual-channel-bucket';
import { persistSquadPatch } from '../squad/squad-catalog';
import { publishSquadChannelsCatalog } from '../squad/squad-channels-catalog';
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
      subscribers.forEach((sub) => sub(value));
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
    { name: 'general', groupId: 'g-general', order: 1, access: 'open' },
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

    vi.mocked(createGroupChat).mockReset().mockResolvedValue({ groupId: 'g-new-channel', skippedMembers: [], pendingInvites: [] });
    vi.mocked(warnSkippedMembers).mockReset();
    vi.mocked(warnPendingInvites).mockReset();
    vi.mocked(formatChannelInSquadMessage).mockReset().mockReturnValue('channel-in-squad-payload');
    vi.mocked(sendDmMessage).mockReset().mockResolvedValue(true);
    vi.mocked(publishSquadChannelsCatalog).mockReset().mockResolvedValue(true);
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

  it('optimistically creates a placeholder channel with access', async () => {
    const onErrorBanner = vi.fn();
    runCreateChannelInParent({
      parent,
      squadId: 'parent-1',
      name: 'new-channel',
      selectedNpubs: ['npub-a'],
      access: 'open',
      onErrorBanner,
    });

    const state = get(squads);
    expect(state[0]?.channels).toHaveLength(3);
    const placeholder = state[0]?.channels.find((c) => c.name === 'new-channel');
    expect(placeholder?.groupId).toMatch(/^creating-\d+$/);
    expect(placeholder?.access).toBe('open');
  });

  it('persists open channel and publishes catalog', async () => {
    const onErrorBanner = vi.fn();
    runCreateChannelInParent({
      parent,
      squadId: 'parent-1',
      name: 'new-channel',
      selectedNpubs: ['npub-a', 'npub-b'],
      access: 'open',
      onErrorBanner,
    });

    await vi.waitFor(() => {
      expect(createGroupChat).toHaveBeenCalledWith('new-channel', ['npub-a', 'npub-b']);
    });

    await vi.waitFor(() => {
      expect(publishSquadChannelsCatalog).toHaveBeenCalled();
    });

    const state = get(squads);
    expect(state[0]?.channels.some((c) => c.groupId === 'g-new-channel' && c.access === 'open')).toBe(
      true
    );
    expect(onErrorBanner).not.toHaveBeenCalled();
  });

  it('does not publish catalog for closed channels', async () => {
    runCreateChannelInParent({
      parent,
      squadId: 'parent-1',
      name: 'secret',
      selectedNpubs: ['npub-a'],
      access: 'closed',
      onErrorBanner: vi.fn(),
    });

    await vi.waitFor(() => {
      expect(createGroupChat).toHaveBeenCalled();
    });

    await vi.waitFor(() => {
      expect(sendDmMessage).toHaveBeenCalled();
    });

    expect(publishSquadChannelsCatalog).not.toHaveBeenCalled();
  });

  it('rolls back on error and shows a banner', async () => {
    vi.mocked(createGroupChat).mockRejectedValueOnce(new Error('mls failed'));
    const onErrorBanner = vi.fn();

    runCreateChannelInParent({
      parent,
      squadId: 'parent-1',
      name: 'new-channel',
      selectedNpubs: ['npub-a'],
      access: 'open',
      onErrorBanner,
    });

    await vi.waitFor(() => {
      expect(onErrorBanner).toHaveBeenCalledWith('mls failed');
    });

    const state = get(squads);
    expect(state[0]?.channels).toHaveLength(2);
    expect(state[0]?.channels.some((c) => c.groupId.startsWith('creating-'))).toBe(false);
  });

  it('reports skipped members and does not DM them', async () => {
    vi.mocked(createGroupChat).mockResolvedValueOnce({
      groupId: 'g-new-channel',
      skippedMembers: [{ npub: 'npub-b', reason: 'Missing required encoding tag' }],
      pendingInvites: [],
    });

    runCreateChannelInParent({
      parent,
      squadId: 'parent-1',
      name: 'new-channel',
      selectedNpubs: ['npub-a', 'npub-b'],
      access: 'open',
      onErrorBanner: vi.fn(),
    });

    await vi.waitFor(() => {
      expect(warnSkippedMembers).toHaveBeenCalledWith([
        { npub: 'npub-b', reason: 'Missing required encoding tag' },
      ]);
    });

    expect(sendDmMessage).toHaveBeenCalledWith('npub-a', 'channel-in-squad-payload');
    expect(sendDmMessage).not.toHaveBeenCalledWith('npub-b', expect.anything());
  });

  it('warns about pending invites when welcome delivery fails', async () => {
    vi.mocked(createGroupChat).mockResolvedValueOnce({
      groupId: 'g-new-channel',
      skippedMembers: [],
      pendingInvites: [{ npub: 'npub-b', reason: 'relay unreachable' }],
    });

    runCreateChannelInParent({
      parent,
      squadId: 'parent-1',
      name: 'new-channel',
      selectedNpubs: ['npub-a', 'npub-b'],
      access: 'open',
      onErrorBanner: vi.fn(),
    });

    await vi.waitFor(() => {
      expect(warnPendingInvites).toHaveBeenCalledWith([
        { npub: 'npub-b', reason: 'relay unreachable' },
      ]);
    });
  });
});
