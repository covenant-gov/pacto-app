import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  fetchNostrProfile,
  loadNostrProfile,
  refreshProfileNow,
  fetchMessages,
  startNotifs,
  getChatMessageCount,
  deleteDmChatBackend,
  getDmMessages,
  syncAllProfiles,
  updateProfile,
  uploadAvatar,
  setNickname,
  toggleDmBlock,
  queueProfileSync,
  startTyping,
  markAsRead,
  sendDmMessage,
  createGroupChat,
  listMlsGroups,
  getSafe,
  setSafe,
  listParentTreasurySafes,
  addParentTreasurySafe,
  getMlsGroupMetadata,
  parseSquadInviteMessage,
  formatSquadInviteMessage,
  parseChannelInSquadMessage,
  formatChannelInSquadMessage,
  listPendingMlsWelcomes,
  acceptMlsWelcome,
  inviteMemberToGroup,
  getMlsGroupMembers,
  backfillSquadMemberEvmFromProfiles,
  leaveMlsGroup,
  syncMlsGroupsNow,
  listDashboardPolls,
  sendDashboardPollCreate,
  sendDashboardPollVote,
  type MlsVirtualBucket,
} from './nostr';

vi.mock('@tauri-apps/api/core');
vi.mock('../utils/dm-debug', () => ({
  dmLog: vi.fn(),
  dmWarn: vi.fn(),
  dmError: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockReset();
});

// Profile

describe('fetchNostrProfile', () => {
  it('invokes get_profile with npub', async () => {
    mockedInvoke.mockResolvedValueOnce({ id: 'npub1' });
    const result = await fetchNostrProfile('npub1');
    expect(mockedInvoke).toHaveBeenCalledWith('get_profile', { npub: 'npub1' });
    expect(result.id).toBe('npub1');
  });
});

describe('loadNostrProfile', () => {
  it('invokes load_profile with npub', async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    const result = await loadNostrProfile('npub1');
    expect(mockedInvoke).toHaveBeenCalledWith('load_profile', { npub: 'npub1' });
    expect(result).toBe(true);
  });
});

describe('refreshProfileNow', () => {
  it('invokes refresh_profile_now with npub', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await refreshProfileNow('npub1');
    expect(mockedInvoke).toHaveBeenCalledWith('refresh_profile_now', { npub: 'npub1' });
  });
});

// Messages / DMs

describe('fetchMessages', () => {
  it('invokes fetch_messages with init and relay_url', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await fetchMessages(true, 'wss://relay.example.com');
    expect(mockedInvoke).toHaveBeenCalledWith('fetch_messages', {
      init: true,
      relay_url: 'wss://relay.example.com',
    });
  });

  it('coerces undefined relay to null', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await fetchMessages(false);
    expect(mockedInvoke).toHaveBeenCalledWith('fetch_messages', { init: false, relay_url: null });
  });
});

describe('startNotifs', () => {
  it('invokes notifs and returns boolean', async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    const result = await startNotifs();
    expect(mockedInvoke).toHaveBeenCalledWith('notifs');
    expect(result).toBe(true);
  });
});

describe('getChatMessageCount', () => {
  it('invokes get_chat_message_count with chatId', async () => {
    mockedInvoke.mockResolvedValueOnce(42);
    const result = await getChatMessageCount('chat-id');
    expect(mockedInvoke).toHaveBeenCalledWith('get_chat_message_count', { chatId: 'chat-id' });
    expect(result).toBe(42);
  });
});

describe('deleteDmChatBackend', () => {
  it('invokes delete_dm_chat with chatId', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await deleteDmChatBackend('chat-id');
    expect(mockedInvoke).toHaveBeenCalledWith('delete_dm_chat', { chatId: 'chat-id' });
  });
});

describe('getDmMessages', () => {
  it('invokes get_message_views with bucket filter', async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    await getDmMessages('chat-id', 10, 0, { virtualBucketFilter: 'inbox' });
    expect(mockedInvoke).toHaveBeenCalledWith('get_message_views', {
      chatId: 'chat-id',
      limit: 10,
      offset: 0,
      virtualBucketFilter: 'inbox',
    });
  });

  it('coerces undefined bucket filter to null', async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    await getDmMessages('chat-id', 5, 10);
    expect(mockedInvoke).toHaveBeenCalledWith('get_message_views', {
      chatId: 'chat-id',
      limit: 5,
      offset: 10,
      virtualBucketFilter: null,
    });
  });
});

describe('syncAllProfiles', () => {
  it('invokes sync_all_profiles', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await syncAllProfiles();
    expect(mockedInvoke).toHaveBeenCalledWith('sync_all_profiles');
  });
});

describe('updateProfile', () => {
  it('invokes update_profile with stringified fields', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await updateProfile({ name: 'Alice', avatar: 'url', banner: 'banner', about: 'hi' });
    expect(mockedInvoke).toHaveBeenCalledWith('update_profile', {
      name: 'Alice',
      avatar: 'url',
      banner: 'banner',
      about: 'hi',
    });
  });

  it('coerces undefined fields to empty strings', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await updateProfile({ name: 'Alice', avatar: undefined, banner: undefined, about: undefined } as unknown as Parameters<typeof updateProfile>[0]);
    expect(mockedInvoke).toHaveBeenCalledWith('update_profile', {
      name: 'Alice',
      avatar: '',
      banner: '',
      about: '',
    });
  });
});

describe('uploadAvatar', () => {
  it('invokes upload_avatar with filepath and upload_type', async () => {
    mockedInvoke.mockResolvedValueOnce('https://url');
    const result = await uploadAvatar('/path/to/img', 'avatar');
    expect(mockedInvoke).toHaveBeenCalledWith('upload_avatar', {
      filepath: '/path/to/img',
      upload_type: 'avatar',
    });
    expect(result).toBe('https://url');
  });
});

describe('setNickname', () => {
  it('invokes set_nickname with npub and nickname', async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    const result = await setNickname('npub1', 'Nick');
    expect(mockedInvoke).toHaveBeenCalledWith('set_nickname', { npub: 'npub1', nickname: 'Nick' });
    expect(result).toBe(true);
  });

  it('coerces undefined nickname to empty string', async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    await setNickname('npub1', undefined as unknown as string);
    expect(mockedInvoke).toHaveBeenCalledWith('set_nickname', { npub: 'npub1', nickname: '' });
  });
});

describe('toggleDmBlock', () => {
  it('invokes toggle_blocked with npub', async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    const result = await toggleDmBlock('npub1');
    expect(mockedInvoke).toHaveBeenCalledWith('toggle_blocked', { npub: 'npub1' });
    expect(result).toBe(true);
  });
});

describe('queueProfileSync', () => {
  it('invokes queue_profile_sync with defaults', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await queueProfileSync('npub1');
    expect(mockedInvoke).toHaveBeenCalledWith('queue_profile_sync', {
      npub: 'npub1',
      priority: 'medium',
      force_refresh: false,
    });
  });

  it('invokes queue_profile_sync with explicit options', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await queueProfileSync('npub1', 'critical', true);
    expect(mockedInvoke).toHaveBeenCalledWith('queue_profile_sync', {
      npub: 'npub1',
      priority: 'critical',
      force_refresh: true,
    });
  });
});

describe('startTyping', () => {
  it('invokes start_typing with receiver', async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    const result = await startTyping('npub1');
    expect(mockedInvoke).toHaveBeenCalledWith('start_typing', { receiver: 'npub1' });
    expect(result).toBe(true);
  });
});

describe('markAsRead', () => {
  it('invokes mark_as_read with chatId and messageId', async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    const result = await markAsRead('chat-id', 'msg-id');
    expect(mockedInvoke).toHaveBeenCalledWith('mark_as_read', { chatId: 'chat-id', messageId: 'msg-id' });
    expect(result).toBe(true);
  });

  it('passes null messageId', async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    await markAsRead('chat-id', null);
    expect(mockedInvoke).toHaveBeenCalledWith('mark_as_read', { chatId: 'chat-id', messageId: null });
  });
});

describe('sendDmMessage', () => {
  it('invokes message with content and defaults', async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    const result = await sendDmMessage('npub1', 'hello');
    expect(mockedInvoke).toHaveBeenCalledWith('message', {
      receiver: 'npub1',
      content: 'hello',
      repliedTo: '',
      file: null,
      virtualBucket: null,
    });
    expect(result).toBe(true);
  });

  it('passes repliedTo and virtualBucket', async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    await sendDmMessage('npub1', 'hello', 'reply-id', { virtualBucket: 'polls' as MlsVirtualBucket });
    expect(mockedInvoke).toHaveBeenCalledWith('message', {
      receiver: 'npub1',
      content: 'hello',
      repliedTo: 'reply-id',
      file: null,
      virtualBucket: 'polls',
    });
  });
});

// MLS / Squads

describe('createGroupChat', () => {
  it('invokes create_group_chat with name and members', async () => {
    mockedInvoke.mockResolvedValueOnce('group-id');
    const result = await createGroupChat('Squad', ['npub1', 'npub2']);
    expect(mockedInvoke).toHaveBeenCalledWith('create_group_chat', {
      groupName: 'Squad',
      memberIds: ['npub1', 'npub2'],
    });
    expect(result).toBe('group-id');
  });
});

describe('listMlsGroups', () => {
  it('invokes list_mls_groups', async () => {
    mockedInvoke.mockResolvedValueOnce(['g1', 'g2']);
    const result = await listMlsGroups();
    expect(mockedInvoke).toHaveBeenCalledWith('list_mls_groups');
    expect(result).toEqual(['g1', 'g2']);
  });
});

describe('getSafe', () => {
  it('invokes get_safe with parentId and returns address', async () => {
    mockedInvoke.mockResolvedValueOnce('0xabc');
    const result = await getSafe('parent-1');
    expect(mockedInvoke).toHaveBeenCalledWith('get_safe', { parentId: 'parent-1' });
    expect(result).toBe('0xabc');
  });

  it('normalizes null to null', async () => {
    mockedInvoke.mockResolvedValueOnce(null);
    const result = await getSafe('parent-1');
    expect(result).toBeNull();
  });
});

describe('setSafe', () => {
  it('invokes set_safe with parentId and safeAddress', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await setSafe('parent-1', '0xabc');
    expect(mockedInvoke).toHaveBeenCalledWith('set_safe', { parentId: 'parent-1', safeAddress: '0xabc' });
  });
});

describe('listParentTreasurySafes', () => {
  it('invokes list_parent_treasury_safes with parentId', async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    const result = await listParentTreasurySafes('parent-1');
    expect(mockedInvoke).toHaveBeenCalledWith('list_parent_treasury_safes', { parentId: 'parent-1' });
    expect(result).toEqual([]);
  });
});

describe('addParentTreasurySafe', () => {
  it('invokes add_parent_treasury_safe with all fields', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await addParentTreasurySafe('parent-1', '0xabc', { chain: 'sepolia', label: 'Treasury', entryId: 'e1' });
    expect(mockedInvoke).toHaveBeenCalledWith('add_parent_treasury_safe', {
      parentId: 'parent-1',
      safeAddress: '0xabc',
      chain: 'sepolia',
      label: 'Treasury',
      entryId: 'e1',
    });
  });

  it('coerces undefined options to null', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await addParentTreasurySafe('parent-1', '0xabc');
    expect(mockedInvoke).toHaveBeenCalledWith('add_parent_treasury_safe', {
      parentId: 'parent-1',
      safeAddress: '0xabc',
      chain: null,
      label: null,
      entryId: null,
    });
  });
});

describe('getMlsGroupMetadata', () => {
  it('invokes get_mls_group_metadata', async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    const result = await getMlsGroupMetadata();
    expect(mockedInvoke).toHaveBeenCalledWith('get_mls_group_metadata');
    expect(result).toEqual([]);
  });
});

describe('parseSquadInviteMessage', () => {
  const payload = {
    type: 'squad_invite' as const,
    squadName: 'Alpha',
    groupId: 'g1',
    kind: 'squad' as const,
    pairedSquads: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] as const,
    invitedByNpub: 'npub1',
  };

  it('parses valid squad invite payload', () => {
    const result = parseSquadInviteMessage(JSON.stringify(payload));
    expect(result).toEqual(payload);
  });

  it('returns null for invalid JSON', () => {
    expect(parseSquadInviteMessage('not json')).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    expect(parseSquadInviteMessage(JSON.stringify({ type: 'squad_invite' }))).toBeNull();
  });

  it('normalizes kind to squad-pair or squad', () => {
    const raw = { type: 'squad_invite', squadName: 'A', groupId: 'g1', kind: 'squad-pair' };
    expect(parseSquadInviteMessage(JSON.stringify(raw))?.kind).toBe('squad-pair');
  });
});

describe('formatSquadInviteMessage', () => {
  it('serializes payload to JSON', () => {
    const payload = { type: 'squad_invite' as const, squadName: 'A', groupId: 'g1' };
    expect(formatSquadInviteMessage(payload)).toBe(JSON.stringify(payload));
  });
});

describe('parseChannelInSquadMessage', () => {
  const payload = {
    type: 'channel_in_squad' as const,
    squadName: 'Alpha',
    announcementsGroupId: 'a1',
    channelGroupId: 'c1',
    channelName: 'general',
  };

  it('parses valid channel payload', () => {
    expect(parseChannelInSquadMessage(JSON.stringify(payload))).toEqual(payload);
  });

  it('returns null for invalid JSON', () => {
    expect(parseChannelInSquadMessage('not json')).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    expect(parseChannelInSquadMessage(JSON.stringify({ type: 'channel_in_squad' }))).toBeNull();
  });
});

describe('formatChannelInSquadMessage', () => {
  it('serializes payload to JSON', () => {
    expect(formatChannelInSquadMessage({
      type: 'channel_in_squad',
      squadName: 'A',
      announcementsGroupId: 'a1',
      channelGroupId: 'c1',
      channelName: 'general',
    })).toBe(JSON.stringify({
      type: 'channel_in_squad',
      squadName: 'A',
      announcementsGroupId: 'a1',
      channelGroupId: 'c1',
      channelName: 'general',
    }));
  });
});

describe('listPendingMlsWelcomes', () => {
  it('invokes list_pending_mls_welcomes', async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    const result = await listPendingMlsWelcomes();
    expect(mockedInvoke).toHaveBeenCalledWith('list_pending_mls_welcomes');
    expect(result).toEqual([]);
  });
});

describe('acceptMlsWelcome', () => {
  it('invokes accept_mls_welcome with welcome id', async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    const result = await acceptMlsWelcome('welcome-id');
    expect(mockedInvoke).toHaveBeenCalledWith('accept_mls_welcome', { welcomeEventIdHex: 'welcome-id' });
    expect(result).toBe(true);
  });
});

describe('inviteMemberToGroup', () => {
  it('invokes invite_member_to_group with groupId and memberNpub', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await inviteMemberToGroup('g1', 'npub1');
    expect(mockedInvoke).toHaveBeenCalledWith('invite_member_to_group', { groupId: 'g1', memberNpub: 'npub1' });
  });
});

describe('getMlsGroupMembers', () => {
  it('invokes get_mls_group_members and returns members', async () => {
    mockedInvoke.mockResolvedValueOnce({ group_id: 'g1', members: ['npub1'], admins: ['npub1'] });
    const result = await getMlsGroupMembers('g1');
    expect(mockedInvoke).toHaveBeenCalledWith('get_mls_group_members', { groupId: 'g1' });
    expect(result.members).toEqual(['npub1']);
  });
});

describe('backfillSquadMemberEvmFromProfiles', () => {
  it('invokes backfill_squad_member_evm_missing_from_profiles', async () => {
    mockedInvoke.mockResolvedValueOnce(3);
    const result = await backfillSquadMemberEvmFromProfiles('parent-1', ['npub1', 'npub2']);
    expect(mockedInvoke).toHaveBeenCalledWith('backfill_squad_member_evm_missing_from_profiles', {
      parentId: 'parent-1',
      memberNpubs: ['npub1', 'npub2'],
    });
    expect(result).toBe(3);
  });
});

describe('leaveMlsGroup', () => {
  it('invokes leave_mls_group with groupId', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await leaveMlsGroup('g1');
    expect(mockedInvoke).toHaveBeenCalledWith('leave_mls_group', { groupId: 'g1' });
  });
});

describe('syncMlsGroupsNow', () => {
  it('invokes sync_mls_groups_now with all groups when no groupId', async () => {
    mockedInvoke.mockResolvedValueOnce([2, 5]);
    const result = await syncMlsGroupsNow();
    expect(mockedInvoke).toHaveBeenCalledWith('sync_mls_groups_now', { group_id: null });
    expect(result).toEqual({ synced: 2, total: 5 });
  });

  it('invokes sync_mls_groups_now with a specific groupId', async () => {
    mockedInvoke.mockResolvedValueOnce([1, 1]);
    const result = await syncMlsGroupsNow('g1');
    expect(mockedInvoke).toHaveBeenCalledWith('sync_mls_groups_now', { group_id: 'g1' });
    expect(result).toEqual({ synced: 1, total: 1 });
  });
});

// Dashboard polls

describe('listDashboardPolls', () => {
  it('invokes list_dashboard_polls with parentId', async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    const result = await listDashboardPolls('parent-1');
    expect(mockedInvoke).toHaveBeenCalledWith('list_dashboard_polls', { parentId: 'parent-1' });
    expect(result).toEqual([]);
  });
});

describe('sendDashboardPollCreate', () => {
  it('invokes send_dashboard_poll_create with all params', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await sendDashboardPollCreate({
      mlsGroupId: 'g1',
      parentId: 'parent-1',
      pollId: 'p1',
      title: 'Title',
      description: 'Desc',
      options: [{ id: 'o1', label: 'Yes' }],
    });
    expect(mockedInvoke).toHaveBeenCalledWith('send_dashboard_poll_create', {
      mlsGroupId: 'g1',
      parentId: 'parent-1',
      pollId: 'p1',
      title: 'Title',
      description: 'Desc',
      options: [{ id: 'o1', label: 'Yes' }],
    });
  });
});

describe('sendDashboardPollVote', () => {
  it('invokes send_dashboard_poll_vote with all params', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await sendDashboardPollVote({
      mlsGroupId: 'g1',
      parentId: 'parent-1',
      pollId: 'p1',
      optionId: 'o1',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('send_dashboard_poll_vote', {
      mlsGroupId: 'g1',
      parentId: 'parent-1',
      pollId: 'p1',
      optionId: 'o1',
    });
  });
});
