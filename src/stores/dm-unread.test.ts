import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  dmLastReadByNpub,
  dmUnreadByNpub,
  pactoAppInboxLastReadId,
  dmThreadScrolledToBottom,
  pactoAppInboxUnreadCount,
  dmTabHasUnread,
  unreadCountForNpub,
  hydrateDmUnreadFromInitChats,
  syncUnreadCountForNpub,
  incrementDmUnread,
  clearDmUnread,
  clearPactoAppInboxUnread,
  unreadCountForSidebarEntry,
  PACTO_APP_INBOX_LAST_READ_PREFIX,
  dmSidebarCategoryForNpub,
} from './dm-unread';
import {
  dmChatsByNpub,
  pinnedDmNpubs,
  blockedDmNpubs,
  pactoAppInboxMessages,
  PACTO_APP_DM_THREAD_ID,
} from './dm';
import { setCurrentNpubForPersistence } from './persistence-context';

describe('dm-unread', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    dmLastReadByNpub.set({});
    dmUnreadByNpub.set({});
    pactoAppInboxLastReadId.set('');
    dmThreadScrolledToBottom.set(false);
    dmChatsByNpub.set({});
    pinnedDmNpubs.set(new Set());
    blockedDmNpubs.set(new Set());
    pactoAppInboxMessages.set([]);
    setCurrentNpubForPersistence(null);
    vi.unstubAllGlobals();
  });

  it('has expected initial values', () => {
    expect(get(dmLastReadByNpub)).toEqual({});
    expect(get(dmUnreadByNpub)).toEqual({});
    expect(get(pactoAppInboxLastReadId)).toBe('');
    expect(get(dmThreadScrolledToBottom)).toBe(false);
  });

  it('computes pacto app inbox unread count', () => {
    pactoAppInboxMessages.set([
      { id: 'a', mine: false },
      { id: 'b', mine: false },
      { id: 'c', mine: false },
    ] as Parameters<typeof pactoAppInboxMessages.set>[0]);
    expect(get(pactoAppInboxUnreadCount)).toBe(3);
    pactoAppInboxLastReadId.set('b');
    expect(get(pactoAppInboxUnreadCount)).toBe(1);
    pactoAppInboxLastReadId.set('c');
    expect(get(pactoAppInboxUnreadCount)).toBe(0);
  });

  it('computes tab unread flags from peer unread counts and inbox', () => {
    dmChatsByNpub.set({
      alice: { npub: 'alice', hasFromMe: true, hasFromThem: true, lastAt: 1 },
      bob: { npub: 'bob', hasFromMe: false, hasFromThem: true, lastAt: 1 },
      carol: { npub: 'carol', hasFromMe: true, hasFromThem: false, lastAt: 1 },
      dave: { npub: 'dave', hasFromMe: true, hasFromThem: true, lastAt: 1 },
    });
    pinnedDmNpubs.set(new Set(['alice']));
    dmUnreadByNpub.set({ alice: 1, bob: 1, carol: 1, dave: 1 });

    const flags = get(dmTabHasUnread);
    expect(flags.pinned).toBe(true);
    expect(flags.friends).toBe(true);
    expect(flags.requests).toBe(true);
    expect(flags.pending).toBe(true);
  });

  it('returns zero unread for an unknown npub', () => {
    expect(unreadCountForNpub('unknown')).toBe(0);
  });

  it('hydrates unread state from init chats', () => {
    hydrateDmUnreadFromInitChats([
      { id: 'npub1alice', last_read: 'b', messages: [{ id: 'a', mine: false }, { id: 'b', mine: false }, { id: 'c', mine: false }] },
      { id: 'npub1bob', messages: [{ id: 'x', mine: false }] },
      { id: 'non-npub-squad', last_read: 'z', messages: [{ id: 'z', mine: false }] },
    ]);

    expect(get(dmLastReadByNpub)).toEqual({ 'npub1alice': 'b' });
    expect(get(dmUnreadByNpub)).toEqual({ 'npub1alice': 1, 'npub1bob': 1 });
  });

  it('syncs unread count for a peer from messages', () => {
    dmLastReadByNpub.set({ 'npub1alice': 'b' });
    syncUnreadCountForNpub('npub1alice', [
      { id: 'a', mine: false },
      { id: 'b', mine: false },
      { id: 'c', mine: false },
    ]);
    expect(unreadCountForNpub('npub1alice')).toBe(1);
  });

  it('increments and clears unread count', () => {
    incrementDmUnread('npub1alice');
    incrementDmUnread('npub1alice');
    expect(unreadCountForNpub('npub1alice')).toBe(2);

    clearDmUnread('npub1alice', 'msg-3');
    expect(unreadCountForNpub('npub1alice')).toBe(0);
    expect(get(dmLastReadByNpub)['npub1alice']).toBe('msg-3');
  });

  it('clears pacto app inbox unread', () => {
    clearPactoAppInboxUnread('msg-9');
    expect(get(pactoAppInboxLastReadId)).toBe('msg-9');
  });

  it('persists pacto app inbox last read id to localStorage', () => {
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

    setCurrentNpubForPersistence('npub1abc');
    pactoAppInboxLastReadId.set('msg-5');
    expect(storage.get(`${PACTO_APP_INBOX_LAST_READ_PREFIX}_npub1abc`)).toBe('msg-5');
  });

  it('returns sidebar unread count for pacto app inbox', () => {
    pactoAppInboxMessages.set([{ id: 'a', mine: false }, { id: 'b', mine: false }] as Parameters<typeof pactoAppInboxMessages.set>[0]);
    pactoAppInboxLastReadId.set('a');
    expect(unreadCountForSidebarEntry(PACTO_APP_DM_THREAD_ID, {}, new Set())).toBe(1);
  });

  it('returns sidebar unread count for a peer npub', () => {
    dmUnreadByNpub.set({ 'npub1alice': 3 });
    expect(unreadCountForSidebarEntry('npub1alice', {}, new Set())).toBe(3);
  });

  it('re-exports dmSidebarCategoryForNpub', () => {
    dmChatsByNpub.set({
      alice: { npub: 'alice', hasFromMe: true, hasFromThem: true, lastAt: 1 },
    });
    pinnedDmNpubs.set(new Set(['alice']));
    expect(dmSidebarCategoryForNpub('alice', get(dmChatsByNpub), get(pinnedDmNpubs))).toBe('pinned');
    expect(dmSidebarCategoryForNpub('unknown', get(dmChatsByNpub), get(pinnedDmNpubs))).toBe('friends');
  });
});
