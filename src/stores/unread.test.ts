import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const mockGetUnreadCounts = vi.hoisted(() => vi.fn());
vi.mock('../lib/api/notifications', () => ({
  getUnreadCounts: (...args: unknown[]) => mockGetUnreadCounts(...args),
}));

import {
  clearPactoAppInboxUnread,
  dmSidebarCategoryForNpub,
  dmTabHasUnread,
  dmThreadScrolledToBottom,
  hydrateUnreadCounts,
  mergeUnreadCounts,
  pactoAppInboxLastReadId,
  pactoAppInboxUnreadCount,
  PACTO_APP_INBOX_LAST_READ_PREFIX,
  resetUnreadStore,
  unreadCountForChat,
  unreadCountsByChat,
} from './unread';
import { blockedDmNpubs, dmChatsByNpub, pactoAppInboxMessages, pinnedDmNpubs } from './dm';
import { setCurrentNpubForPersistence } from './persistence-context';

describe('unread', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    unreadCountsByChat.set({});
    pactoAppInboxLastReadId.set('');
    dmThreadScrolledToBottom.set(false);
    dmChatsByNpub.set({});
    pinnedDmNpubs.set(new Set());
    blockedDmNpubs.set(new Set());
    pactoAppInboxMessages.set([]);
    setCurrentNpubForPersistence(null);
    mockGetUnreadCounts.mockReset();
    vi.unstubAllGlobals();
  });

  it('has expected initial values', () => {
    expect(get(unreadCountsByChat)).toEqual({});
    expect(get(pactoAppInboxLastReadId)).toBe('');
    expect(get(dmThreadScrolledToBottom)).toBe(false);
  });

  // The Pacto App inbox is a synthetic, local-only thread with no backend count to
  // mirror (see countUnreadPactoAppInboxMessages in unread.ts) — the sole intentional
  // exception to "no selector computes a count from a message array".
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

  it('hydrates counts for MLS chat ids as well as npub ids', async () => {
    mockGetUnreadCounts.mockResolvedValue({ npub1alice: 2, 'mls-group-1': 5 });
    await hydrateUnreadCounts();
    expect(get(unreadCountsByChat)).toEqual({ npub1alice: 2, 'mls-group-1': 5 });
  });

  it('a changed-entry event updates one chat via merge, leaving others untouched', () => {
    unreadCountsByChat.set({ npub1alice: 1, 'mls-group-1': 4 });
    mergeUnreadCounts({ 'mls-group-1': 7 });
    expect(unreadCountForChat('mls-group-1')).toBe(7);
    expect(unreadCountForChat('npub1alice')).toBe(1);
  });

  it('merging a zero entry clears that chat without affecting others', () => {
    unreadCountsByChat.set({ npub1alice: 3, npub1bob: 2 });
    mergeUnreadCounts({ npub1alice: 0 });
    expect(get(unreadCountsByChat)).toEqual({ npub1alice: 0, npub1bob: 2 });
  });

  it('returns zero from unreadCountForChat for an unknown chat', () => {
    expect(unreadCountForChat('unknown')).toBe(0);
  });

  it('resetUnreadStore clears the map', () => {
    unreadCountsByChat.set({ npub1alice: 3 });
    resetUnreadStore();
    expect(get(unreadCountsByChat)).toEqual({});
  });

  it('computes tab unread flags from backend counts and inbox', () => {
    dmChatsByNpub.set({
      alice: { npub: 'alice', hasFromMe: true, hasFromThem: true, lastAt: 1 },
      bob: { npub: 'bob', hasFromMe: false, hasFromThem: true, lastAt: 1 },
      carol: { npub: 'carol', hasFromMe: true, hasFromThem: false, lastAt: 1 },
      dave: { npub: 'dave', hasFromMe: true, hasFromThem: true, lastAt: 1 },
    });
    pinnedDmNpubs.set(new Set(['alice']));
    unreadCountsByChat.set({ alice: 1, bob: 1, carol: 1, dave: 1 });

    const flags = get(dmTabHasUnread);
    expect(flags.pinned).toBe(true);
    expect(flags.friends).toBe(true);
    expect(flags.requests).toBe(true);
    expect(flags.pending).toBe(true);
  });

  it('a tab dot clears once every chat in that tab reaches zero', () => {
    dmChatsByNpub.set({
      dave: { npub: 'dave', hasFromMe: true, hasFromThem: true, lastAt: 1 },
    });
    unreadCountsByChat.set({ dave: 2 });
    expect(get(dmTabHasUnread).friends).toBe(true);

    mergeUnreadCounts({ dave: 0 });
    expect(get(dmTabHasUnread).friends).toBe(false);
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

  it('re-exports dmSidebarCategoryForNpub', () => {
    dmChatsByNpub.set({
      alice: { npub: 'alice', hasFromMe: true, hasFromThem: true, lastAt: 1 },
    });
    pinnedDmNpubs.set(new Set(['alice']));
    expect(dmSidebarCategoryForNpub('alice', get(dmChatsByNpub), get(pinnedDmNpubs))).toBe('pinned');
    expect(dmSidebarCategoryForNpub('unknown', get(dmChatsByNpub), get(pinnedDmNpubs))).toBe('friends');
  });
});
