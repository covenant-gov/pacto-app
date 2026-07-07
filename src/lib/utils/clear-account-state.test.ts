import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { clearAccountState } from './clear-account-state';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import {
  activeTopNavTab,
  activeView,
  activeSquadId,
  activeChannelId,
  activeHubChannelName,
  lastOpenedSquadId,
  lastOpenedChannelId,
  lastChannelBySquadId,
  lastHubChannelNameBySquadId,
  showMembersPanel,
  parentDashboardChannelMode,
  DEFAULT_TOP_NAV_TAB,
} from '../../stores/navigation';
import {
  pinnedDmNpubs,
  blockedDmNpubs,
  dmChatsByNpub,
  activeDmId,
  lastOpenedDmByTab,
  walletSidebarOpen,
  composingNewChat,
  activeDmTab,
  dmSendError,
  pactoAppInboxMessages,
  dmThreadAnnouncementsByNpub,
  type DmChatState,
} from '../../stores/dm';
import {
  acceptedSquadInviteIds,
  declinedSquadInviteIds,
  acceptedChannelInviteMessageIds,
  declinedChannelInviteMessageIds,
  declinedWalletTxRequestMessageIds,
  acceptedWalletPeerInfoRequestMessageIds,
  declinedWalletPeerInfoRequestMessageIds,
} from '../../stores/invite-decisions';
import { squads, ungroupedChannels, channelMessages, type Channel, type Squad } from '../../stores/squads';
import { recentEmojisStore, type EmojiEntry } from '../../stores/emojis';
import { dmLastReadByNpub, dmUnreadByNpub, pactoAppInboxLastReadId } from '../../stores/dm-unread';

describe('clearAccountState', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setCurrentNpubForPersistence(null);
    squads.set([]);
    ungroupedChannels.set([]);
    channelMessages.set({});
    pinnedDmNpubs.set(new Set());
    blockedDmNpubs.set(new Set());
    dmChatsByNpub.set({});
    activeDmId.set(null);
    lastOpenedDmByTab.set({ friends: null, requests: null, pending: null, search: null, pinned: null });
    lastOpenedSquadId.set(null);
    lastOpenedChannelId.set(null);
    lastChannelBySquadId.set({});
    lastHubChannelNameBySquadId.set({});
    activeSquadId.set(null);
    activeChannelId.set(null);
    activeHubChannelName.set(null);
    acceptedSquadInviteIds.set([]);
    declinedSquadInviteIds.set([]);
    acceptedChannelInviteMessageIds.set([]);
    declinedChannelInviteMessageIds.set([]);
    declinedWalletTxRequestMessageIds.set([]);
    acceptedWalletPeerInfoRequestMessageIds.set([]);
    declinedWalletPeerInfoRequestMessageIds.set([]);
    activeTopNavTab.set(DEFAULT_TOP_NAV_TAB);
    activeDmTab.set('friends');
    activeView.set('hub');
    parentDashboardChannelMode.set('governance');
    showMembersPanel.set(false);
    walletSidebarOpen.set(false);
    composingNewChat.set(false);
    dmSendError.set(null);
    pactoAppInboxMessages.set([]);
    dmThreadAnnouncementsByNpub.set({});
    dmLastReadByNpub.set({});
    dmUnreadByNpub.set({});
    pactoAppInboxLastReadId.set('');
    recentEmojisStore.set([]);
  });

  it('removes npub-scoped localStorage keys when npub is provided', () => {
    const npub = 'npub1abcdef';
    storage.set(`pacto_last_dm_npub_${npub}`, 'value');
    storage.set(`pacto_pinned_dm_npubs_${npub}`, 'value');
    storage.set(`pacto_wallet_ui_enabled_chains_v1_${npub}`, 'value');
    storage.set('unrelated_key', 'keep');

    clearAccountState(npub);

    expect(storage.has(`pacto_last_dm_npub_${npub}`)).toBe(false);
    expect(storage.has(`pacto_pinned_dm_npubs_${npub}`)).toBe(false);
    expect(storage.has(`pacto_wallet_ui_enabled_chains_v1_${npub}`)).toBe(false);
    expect(storage.get('unrelated_key')).toBe('keep');
  });

  it('does not remove localStorage keys when npub is omitted', () => {
    const npub = 'npub1abcdef';
    storage.set(`pacto_last_dm_npub_${npub}`, 'value');
    clearAccountState();
    expect(storage.get(`pacto_last_dm_npub_${npub}`)).toBe('value');
  });

  it('resets navigation stores to defaults', () => {
    activeSquadId.set('squad-1');
    activeChannelId.set('channel-1');
    activeHubChannelName.set('hub-1');
    activeView.set('profile');
    activeTopNavTab.set('dms');
    parentDashboardChannelMode.set('treasury');
    showMembersPanel.set(true);

    clearAccountState('npub1abcdef');

    expect(get(activeSquadId)).toBeNull();
    expect(get(activeChannelId)).toBeNull();
    expect(get(activeHubChannelName)).toBeNull();
    expect(get(activeView)).toBe('hub');
    expect(get(activeTopNavTab)).toBe(DEFAULT_TOP_NAV_TAB);
    expect(get(parentDashboardChannelMode)).toBe('governance');
    expect(get(showMembersPanel)).toBe(false);
  });

  it('resets DM stores to defaults', () => {
    const chatState: DmChatState = {
      npub: 'npub1',
      hasFromMe: true,
      hasFromThem: false,
      lastAt: 1,
    };
    pinnedDmNpubs.set(new Set(['npub1']));
    blockedDmNpubs.set(new Set(['npub2']));
    dmChatsByNpub.set({ npub1: chatState });
    activeDmId.set('npub1');
    activeDmTab.set('requests');
    composingNewChat.set(true);
    dmSendError.set('boom');
    pactoAppInboxMessages.set([
      { id: '1', content: 'hi', at: 1, mine: false, inviterNpub: 'npub1' },
    ]);
    dmThreadAnnouncementsByNpub.set({ npub1: [] });

    clearAccountState('npub1abcdef');

    expect(get(pinnedDmNpubs).size).toBe(0);
    expect(get(blockedDmNpubs).size).toBe(0);
    expect(get(dmChatsByNpub)).toEqual({});
    expect(get(activeDmId)).toBeNull();
    expect(get(activeDmTab)).toBe('friends');
    expect(get(composingNewChat)).toBe(false);
    expect(get(dmSendError)).toBeNull();
    expect(get(pactoAppInboxMessages)).toEqual([]);
    expect(get(dmThreadAnnouncementsByNpub)).toEqual({});
  });

  it('resets invite decision stores to defaults', () => {
    acceptedSquadInviteIds.set(['invite-1']);
    declinedSquadInviteIds.set(['invite-2']);
    acceptedChannelInviteMessageIds.set(['msg-1']);
    declinedChannelInviteMessageIds.set(['msg-2']);
    declinedWalletTxRequestMessageIds.set(['msg-3']);
    acceptedWalletPeerInfoRequestMessageIds.set(['msg-4']);
    declinedWalletPeerInfoRequestMessageIds.set(['msg-5']);

    clearAccountState('npub1abcdef');

    expect(get(acceptedSquadInviteIds)).toEqual([]);
    expect(get(declinedSquadInviteIds)).toEqual([]);
    expect(get(acceptedChannelInviteMessageIds)).toEqual([]);
    expect(get(declinedChannelInviteMessageIds)).toEqual([]);
    expect(get(declinedWalletTxRequestMessageIds)).toEqual([]);
    expect(get(acceptedWalletPeerInfoRequestMessageIds)).toEqual([]);
    expect(get(declinedWalletPeerInfoRequestMessageIds)).toEqual([]);
  });

  it('resets DM read state stores', () => {
    dmLastReadByNpub.set({ npub1: 'id' });
    dmUnreadByNpub.set({ npub1: 1 });
    pactoAppInboxLastReadId.set('last-read');

    clearAccountState('npub1abcdef');

    expect(get(dmLastReadByNpub)).toEqual({});
    expect(get(dmUnreadByNpub)).toEqual({});
    expect(get(pactoAppInboxLastReadId)).toBe('');
  });

  it('resets squads and recent emoji stores', () => {
    const squad: Squad = {
      id: 's1',
      name: 'S',
      channels: [],
      kind: 'squad',
      createdAt: 1,
      updatedAt: 1,
    };
    const channel: Channel = { name: 'c', groupId: 'c1', order: 0 };
    const emoji: EmojiEntry = { emoji: '😀', name: 'grinning' };
    squads.set([squad]);
    ungroupedChannels.set([channel]);
    channelMessages.set({ s1: [] });
    recentEmojisStore.set([emoji]);

    clearAccountState('npub1abcdef');

    expect(get(squads)).toEqual([]);
    expect(get(ungroupedChannels)).toEqual([]);
    expect(get(channelMessages)).toEqual({});
    expect(get(recentEmojisStore)).toEqual([]);
  });
});
