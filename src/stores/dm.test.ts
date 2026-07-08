import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  activeDmTab,
  pinnedDmNpubs,
  blockedDmNpubs,
  dmChatsByNpub,
  dmList,
  requestsList,
  pendingList,
  pinnedList,
  allDmEntriesUnified,
  dmSidebarCategoryForNpub,
  setDmChatState,
  addPendingDm,
  activeDmId,
  backendDmMessages,
  dmThreadAnnouncementsByNpub,
  pactoAppInboxMessages,
  appendPactoAppInboxMessage,
  reconcilePeerThreadInvites,
  appendPendingOutboundDmMessage,
  removeOutboundDmMessage,
  patchOutboundDmMessage,
  patchOutboundWalletTxByHash,
  appendDmThreadAnnouncement,
  messageCountByChat,
  loadedOffsetByChat,
  typingByChat,
  deleteDmChat,
  revertDmChat,
  walletSidebarOpen,
  toggleWalletSidebar,
  closeWalletSidebar,
  composingNewChat,
  newChatDraftNpub,
  newChatDraftMessage,
  walletSendPrefillFromRequest,
  dmWalletPeerExchangeTick,
  dmSyncStatus,
  dmSendError,
  lastOpenedDmByTab,
  type DmChatSnapshot,
  type DmMessage,
  PACTO_APP_DM_THREAD_ID,
} from './dm';
import {
  toPactoAppInboxEntry,
  isPactoAppRoutableInviteContent,
} from '../lib/pacto-app-inbox';
import { setCurrentNpubForPersistence } from './persistence-context';

vi.mock('../lib/pacto-app-inbox', () => ({
  toPactoAppInboxEntry: vi.fn((message: DmMessage, inviterNpub: string) => ({
    ...message,
    inviterNpub,
  })),
  mergePactoAppInboxEntry: vi.fn((list: unknown[], entry: unknown) => [...list, entry]),
  isPactoAppRoutableInviteContent: vi.fn(() => false),
  resolveInviteInviterNpub: vi.fn((_message: DmMessage, peerNpub: string) => peerNpub),
  PACTO_APP_DM_THREAD_ID: '__pacto_app__',
  PACTO_APP_DISPLAY_NAME: 'Inbox',
  isPactoAppThreadId: vi.fn((id: string | null | undefined) => id === '__pacto_app__'),
}));

function makeChat(npub: string, flags: { hasFromMe?: boolean; hasFromThem?: boolean; lastAt?: number } = {}) {
  return {
    npub,
    name: npub,
    hasFromMe: flags.hasFromMe ?? false,
    hasFromThem: flags.hasFromThem ?? false,
    lastAt: flags.lastAt ?? 1,
  };
}

describe('dm', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
      key: (i: number) => [...storage.keys()][i] ?? null,
      get length() {
        return storage.size;
      },
    } as Storage);
  });

  afterEach(() => {
    activeDmTab.set('friends');
    pinnedDmNpubs.set(new Set());
    blockedDmNpubs.set(new Set());
    dmChatsByNpub.set({});
    activeDmId.set(null);
    backendDmMessages.set({});
    dmThreadAnnouncementsByNpub.set({});
    pactoAppInboxMessages.set([]);
    messageCountByChat.set({});
    loadedOffsetByChat.set({});
    typingByChat.set({});
    walletSidebarOpen.set(false);
    composingNewChat.set(false);
    newChatDraftNpub.set('');
    newChatDraftMessage.set('');
    walletSendPrefillFromRequest.set(null);
    dmWalletPeerExchangeTick.set(0);
    dmSyncStatus.set('idle');
    dmSendError.set(null);
    lastOpenedDmByTab.set({ friends: null, requests: null, pending: null, search: null, pinned: null });
    setCurrentNpubForPersistence(null);
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('has expected initial values', () => {
    expect(get(activeDmTab)).toBe('friends');
    expect(get(walletSidebarOpen)).toBe(false);
    expect(get(composingNewChat)).toBe(false);
    expect(get(newChatDraftNpub)).toBe('');
    expect(get(newChatDraftMessage)).toBe('');
    expect(get(dmWalletPeerExchangeTick)).toBe(0);
    expect(get(dmSendError)).toBeNull();
    expect(get(dmSyncStatus)).toBe('idle');
  });

  describe('wallet sidebar', () => {
    it('toggles the wallet sidebar', () => {
      toggleWalletSidebar();
      expect(get(walletSidebarOpen)).toBe(true);
      toggleWalletSidebar();
      expect(get(walletSidebarOpen)).toBe(false);
    });

    it('closes the wallet sidebar', () => {
      walletSidebarOpen.set(true);
      closeWalletSidebar();
      expect(get(walletSidebarOpen)).toBe(false);
    });
  });

  describe('derived lists', () => {
    it('classifies chats into friends, requests, pending, and pinned', () => {
      dmChatsByNpub.set({
        alice: makeChat('alice', { hasFromMe: true, hasFromThem: true, lastAt: 10 }),
        bob: makeChat('bob', { hasFromMe: false, hasFromThem: true, lastAt: 20 }),
        carol: makeChat('carol', { hasFromMe: true, hasFromThem: false, lastAt: 30 }),
        dave: makeChat('dave', { hasFromMe: true, hasFromThem: true, lastAt: 40 }),
        eve: makeChat('eve', { hasFromMe: true, hasFromThem: true, lastAt: 50 }),
      });
      pinnedDmNpubs.set(new Set(['dave']));
      blockedDmNpubs.set(new Set(['eve']));

      expect(get(dmList).map((e) => e.npub)).toEqual(['alice']);
      expect(get(requestsList).map((e) => e.npub)).toEqual(['bob']);
      expect(get(pendingList).map((e) => e.npub)).toEqual(['carol']);
      expect(get(pinnedList).map((e) => e.npub)).toEqual(['dave']);
      expect(get(allDmEntriesUnified).map((e) => e.npub)).toEqual(['dave', 'carol', 'bob', 'alice']);
    });

    it('sorts by lastAt descending', () => {
      dmChatsByNpub.set({
        alice: makeChat('alice', { hasFromMe: true, hasFromThem: true, lastAt: 5 }),
        bob: makeChat('bob', { hasFromMe: true, hasFromThem: true, lastAt: 100 }),
        carol: makeChat('carol', { hasFromMe: true, hasFromThem: true, lastAt: 50 }),
      });
      expect(get(dmList).map((e) => e.npub)).toEqual(['bob', 'carol', 'alice']);
    });
  });

  describe('dmSidebarCategoryForNpub', () => {
    it('returns pinned for pacto app thread', () => {
      expect(dmSidebarCategoryForNpub(PACTO_APP_DM_THREAD_ID, {}, new Set())).toBe('pinned');
    });

    it('classifies by chat flags', () => {
      const chats = {
        alice: makeChat('alice', { hasFromMe: true, hasFromThem: true }),
        bob: makeChat('bob', { hasFromMe: false, hasFromThem: true }),
        carol: makeChat('carol', { hasFromMe: true, hasFromThem: false }),
      };
      expect(dmSidebarCategoryForNpub('alice', chats, new Set())).toBe('friends');
      expect(dmSidebarCategoryForNpub('bob', chats, new Set())).toBe('requests');
      expect(dmSidebarCategoryForNpub('carol', chats, new Set())).toBe('pending');
      expect(dmSidebarCategoryForNpub('alice', chats, new Set(['alice']))).toBe('pinned');
      expect(dmSidebarCategoryForNpub('unknown', chats, new Set())).toBe('friends');
    });
  });

  describe('setDmChatState and addPendingDm', () => {
    it('creates and updates chat state', () => {
      setDmChatState('alice', { name: 'Alice', hasFromMe: true, hasFromThem: true, lastAt: 10 });
      const chat = get(dmChatsByNpub)['alice'];
      expect(chat).toMatchObject({ npub: 'alice', name: 'Alice', hasFromMe: true, hasFromThem: true, lastAt: 10 });

      setDmChatState('alice', { hasFromThem: false });
      expect(get(dmChatsByNpub)['alice']?.hasFromThem).toBe(false);
    });

    it('adds a pending DM entry', () => {
      addPendingDm('alice');
      const chat = get(dmChatsByNpub)['alice'];
      expect(chat?.hasFromMe).toBe(true);
      expect(chat?.hasFromThem).toBe(false);
      expect(chat?.lastAt).toBeGreaterThan(0);
    });
  });

  describe('activeDmId persistence', () => {
    it('persists the active DM id under an npub-scoped key', () => {
      setCurrentNpubForPersistence('npub1abc');
      activeDmId.set('alice');
      const storage = (globalThis as unknown as { localStorage: Storage }).localStorage;
      expect(storage.getItem('pacto_last_dm_npub_npub1abc')).toBe('alice');
    });
  });

  describe('pacto app inbox', () => {
    it('appends a pacto app inbox message', () => {
      const message = { id: 'm1', content: 'hello', at: 1, mine: false } as DmMessage;
      appendPactoAppInboxMessage(message, 'inviter');
      const list = get(pactoAppInboxMessages);
      expect(list.length).toBe(1);
      expect(list[0]).toMatchObject({ id: 'm1', inviterNpub: 'inviter' });
      expect(toPactoAppInboxEntry).toHaveBeenCalledWith(message, 'inviter');
    });
  });

  describe('reconcilePeerThreadInvites', () => {
    it('moves routable invite messages into the pacto app inbox', () => {
      vi.mocked(isPactoAppRoutableInviteContent).mockImplementation((content: string) => content === 'invite');
      backendDmMessages.set({
        alice: [
          { id: 'm1', content: 'invite', at: 1, mine: false } as DmMessage,
          { id: 'm2', content: 'hello', at: 2, mine: false } as DmMessage,
        ],
      });
      pactoAppInboxMessages.set([]);

      reconcilePeerThreadInvites();

      expect(get(backendDmMessages)['alice']).toEqual([{ id: 'm2', content: 'hello', at: 2, mine: false }]);
      expect(get(pactoAppInboxMessages).length).toBe(1);
      expect(isPactoAppRoutableInviteContent).toHaveBeenCalledWith('invite');
    });
  });

  describe('outbound DM messages', () => {
    it('appends and removes an optimistic outbound message', () => {
      const id = appendPendingOutboundDmMessage('alice', 'hello');
      expect(get(backendDmMessages)['alice']).toHaveLength(1);
      expect(get(backendDmMessages)['alice']?.[0]).toMatchObject({ content: 'hello', mine: true, pending: true });

      removeOutboundDmMessage('alice', id);
      expect(get(backendDmMessages)['alice']).toHaveLength(0);
    });

    it('patches an outbound message by id', () => {
      const id = appendPendingOutboundDmMessage('alice', 'hello');
      patchOutboundDmMessage('alice', id, { failed: true });
      expect(get(backendDmMessages)['alice']?.[0]?.failed).toBe(true);
    });

    it('patches outbound wallet tx by hash', () => {
      backendDmMessages.set({
        alice: [
          { id: 'm1', content: JSON.stringify({ tx_hash: '0xabc' }), at: 1, mine: true } as DmMessage,
        ],
      });
      patchOutboundWalletTxByHash('alice', '0xABC', { pending: false });
      expect(get(backendDmMessages)['alice']?.[0]?.pending).toBe(false);
    });

    it('ignores patch when tx hash is missing or invalid', () => {
      backendDmMessages.set({
        alice: [
          { id: 'm1', content: JSON.stringify({ tx_hash: '0xabc' }), at: 1, mine: true } as DmMessage,
        ],
      });
      patchOutboundWalletTxByHash('alice', '0xwrong', { pending: false });
      expect(get(backendDmMessages)['alice']?.[0]?.pending).toBeUndefined();
      patchOutboundWalletTxByHash('alice', 'not-hex', { pending: false });
      expect(get(backendDmMessages)['alice']?.[0]?.pending).toBeUndefined();
    });
  });

  describe('thread announcements', () => {
    it('appends a local thread announcement', () => {
      appendDmThreadAnnouncement('alice', 'Announcement');
      expect(get(dmThreadAnnouncementsByNpub)['alice']).toHaveLength(1);
      expect(get(dmThreadAnnouncementsByNpub)['alice']?.[0]).toMatchObject({
        content: 'Announcement',
        mine: true,
        is_local_announcement: true,
      });
    });
  });

  describe('deleteDmChat', () => {
    it('removes all chat state for a peer', () => {
      dmChatsByNpub.set({ alice: makeChat('alice', { hasFromMe: true, hasFromThem: true, lastAt: 1 }) });
      backendDmMessages.set({ alice: [{ id: 'm1', content: 'hi', at: 1, mine: false } as DmMessage] });
      messageCountByChat.set({ alice: 5 });
      loadedOffsetByChat.set({ alice: 10 });
      pinnedDmNpubs.set(new Set(['alice']));
      activeDmId.set('alice');

      deleteDmChat('alice');

      expect(get(dmChatsByNpub)['alice']).toBeUndefined();
      expect(get(backendDmMessages)['alice']).toBeUndefined();
      expect(get(messageCountByChat)['alice']).toBeUndefined();
      expect(get(loadedOffsetByChat)['alice']).toBeUndefined();
      expect(get(pinnedDmNpubs).has('alice')).toBe(false);
      expect(get(activeDmId)).toBeNull();
    });
  });

  describe('revertDmChat', () => {
    it('restores chat state, messages, and pinned status from a snapshot', () => {
      const chat = makeChat('alice', { hasFromMe: true, hasFromThem: true, lastAt: 5 });
      const messages = [{ id: 'm1', content: 'hi', at: 1, mine: false } as DmMessage];
      const snapshot: DmChatSnapshot = {
        chatState: chat,
        messages,
        messageCount: 3,
        loadedOffset: 0,
        wasPinned: true,
      };

      revertDmChat('alice', snapshot);

      expect(get(dmChatsByNpub)['alice']).toEqual(chat);
      expect(get(backendDmMessages)['alice']).toEqual(messages);
      expect(get(messageCountByChat)['alice']).toBe(3);
      expect(get(loadedOffsetByChat)['alice']).toBe(0);
      expect(get(pinnedDmNpubs).has('alice')).toBe(true);
    });
  });
});
