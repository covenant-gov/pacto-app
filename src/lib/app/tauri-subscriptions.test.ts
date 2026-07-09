import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { subscribeAppEvents, type AppEventHandlers } from './tauri-subscriptions';
import type { DmMessage } from '../../stores/dm';

const mocks = vi.hoisted(() => {
  function createMockStore<T>(initial: T) {
    let value = initial;
    const subscribers = new Set<(v: T) => void>();
    return {
      set: (v: T) => {
        value = v;
        subscribers.forEach((s) => s(v));
      },
      update: (fn: (v: T) => T) => {
        value = fn(value);
        subscribers.forEach((s) => s(value));
      },
      subscribe: (fn: (v: T) => void) => {
        subscribers.add(fn);
        fn(value);
        return () => {
          subscribers.delete(fn);
        };
      },
      get: () => value,
    };
  }

  const registered: Record<string, Array<(event: unknown) => void>> = {};
  const listen = vi.fn((event: string, handler: (event: unknown) => void) => {
    registered[event] = registered[event] ?? [];
    registered[event].push(handler);
    return Promise.resolve(() => {});
  });

  const mockStores = {
    backendDmMessages: createMockStore<Record<string, DmMessage[]>>({}),
    backendGroupMessages: createMockStore<Record<string, DmMessage[]>>({}),
    dmChatsByNpub: createMockStore<Record<string, unknown>>({}),
    dmSyncStatus: createMockStore<string>('idle'),
    typingByChat: createMockStore<Record<string, string[]>>({}),
    pendingMlsWelcomes: createMockStore<unknown[]>([]),
    dashboardPollReplicaNonceByParentId: createMockStore<Record<string, number>>({}),
    activeDmId: createMockStore<string | null>(null),
  };

  const mockFunctions = {
    appendPactoAppInboxMessage: vi.fn(),
    reconcilePeerThreadInvites: vi.fn(),
    bumpMembershipVersion: vi.fn(),
    handleMlsWelcomeAccepted: vi.fn(),
    handleChannelAddedToSquad: vi.fn(),
    updateChannelNameIfPlaceholder: vi.fn(),
    listPendingMlsWelcomes: vi.fn(),
    fetchMessages: vi.fn(),
    parseAnnouncement: vi.fn(),
    parseWalletTxAnnouncement: vi.fn(),
    isPactoAppRoutableInviteContent: vi.fn(),
    resolveInviteInviterNpub: vi.fn(),
    incrementDmUnread: vi.fn(),
    dmLog: vi.fn(),
    dmError: vi.fn(),
  };

  const dmThreadScrolledToBottom = createMockStore<boolean>(false);

  return {
    createMockStore,
    registered,
    listen,
    mockStores,
    mockFunctions,
    dmThreadScrolledToBottom,
  };
});

vi.mock('@tauri-apps/api/event', () => ({
  listen: mocks.listen,
}));

vi.mock('../api/nostr', () => ({
  listPendingMlsWelcomes: (...args: unknown[]) => mocks.mockFunctions.listPendingMlsWelcomes(...args),
  fetchMessages: (...args: unknown[]) => mocks.mockFunctions.fetchMessages(...args),
}));

vi.mock('../announcements', () => ({
  parseAnnouncement: (...args: unknown[]) => mocks.mockFunctions.parseAnnouncement(...args),
  ANNOUNCE_TYPE_GOVERNANCE_UPDATED: 'governance_updated',
}));

vi.mock('../wallet/dm-messages', () => ({
  parseWalletTxAnnouncement: (...args: unknown[]) =>
    mocks.mockFunctions.parseWalletTxAnnouncement(...args),
  walletTxAnnouncementHash: (...args: unknown[]) => {
    const parsed = mocks.mockFunctions.parseWalletTxAnnouncement(...args);
    return parsed?.tx_hash?.toLowerCase() ?? null;
  },
}));

vi.mock('../pacto-app-inbox', () => ({
  isPactoAppRoutableInviteContent: (...args: unknown[]) =>
    mocks.mockFunctions.isPactoAppRoutableInviteContent(...args),
  resolveInviteInviterNpub: (...args: unknown[]) =>
    mocks.mockFunctions.resolveInviteInviterNpub(...args),
}));

vi.mock('../invites/accept-invite', () => ({
  handleChannelAddedToSquad: (...args: unknown[]) =>
    mocks.mockFunctions.handleChannelAddedToSquad(...args),
  handleMlsWelcomeAccepted: (...args: unknown[]) =>
    mocks.mockFunctions.handleMlsWelcomeAccepted(...args),
}));

vi.mock('../squad/squad-catalog', () => ({
  updateChannelNameIfPlaceholder: (...args: unknown[]) =>
    mocks.mockFunctions.updateChannelNameIfPlaceholder(...args),
}));

vi.mock('../utils/dm-debug', () => ({
  dmLog: (...args: unknown[]) => mocks.mockFunctions.dmLog(...args),
  dmError: (...args: unknown[]) => mocks.mockFunctions.dmError(...args),
}));

vi.mock('../../stores/app', () => ({
  backendDmMessages: mocks.mockStores.backendDmMessages,
  backendGroupMessages: mocks.mockStores.backendGroupMessages,
  dmChatsByNpub: mocks.mockStores.dmChatsByNpub,
  appendPactoAppInboxMessage: (...args: unknown[]) =>
    mocks.mockFunctions.appendPactoAppInboxMessage(...args),
  reconcilePeerThreadInvites: (...args: unknown[]) =>
    mocks.mockFunctions.reconcilePeerThreadInvites(...args),
  dmSyncStatus: mocks.mockStores.dmSyncStatus,
  typingByChat: mocks.mockStores.typingByChat,
  pendingMlsWelcomes: mocks.mockStores.pendingMlsWelcomes,
  bumpMembershipVersion: (...args: unknown[]) => mocks.mockFunctions.bumpMembershipVersion(...args),
  dashboardPollReplicaNonceByParentId: mocks.mockStores.dashboardPollReplicaNonceByParentId,
  activeDmId: mocks.mockStores.activeDmId,
}));

vi.mock('../../stores/dm-unread', () => ({
  incrementDmUnread: (...args: unknown[]) => mocks.mockFunctions.incrementDmUnread(...args),
  dmThreadScrolledToBottom: mocks.dmThreadScrolledToBottom,
}));

function emit(event: string, payload: unknown): void {
  const handlers = mocks.registered[event] ?? [];
  for (const h of handlers) {
    h({ payload } as unknown);
  }
}

function dmMessage(overrides: Partial<DmMessage> = {}) {
  return {
    id: 'msg1',
    content: 'hello',
    at: 1000,
    mine: false,
    npub: 'npub1sender',
    pending: false,
    failed: false,
    ...overrides,
  };
}

const handlers: AppEventHandlers = {
  mergeTreasurySafesForParent: vi.fn(),
  mergeSquadInfraForParent: vi.fn(),
};

describe('subscribeAppEvents', () => {
  let unsubscribe: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mocks.registered).forEach((k) => delete mocks.registered[k]);
    mocks.mockStores.backendDmMessages.set({});
    mocks.mockStores.backendGroupMessages.set({});
    mocks.mockStores.dmChatsByNpub.set({});
    mocks.mockStores.dmSyncStatus.set('idle');
    mocks.mockStores.typingByChat.set({});
    mocks.mockStores.pendingMlsWelcomes.set([]);
    mocks.mockStores.dashboardPollReplicaNonceByParentId.set({});
    mocks.mockStores.activeDmId.set(null);
    mocks.dmThreadScrolledToBottom.set(false);
    mocks.mockFunctions.isPactoAppRoutableInviteContent.mockReturnValue(false);
    mocks.mockFunctions.parseWalletTxAnnouncement.mockReturnValue(null);
    mocks.mockFunctions.parseAnnouncement.mockReturnValue(null);
    mocks.mockFunctions.listPendingMlsWelcomes.mockResolvedValue([]);
    mocks.mockFunctions.fetchMessages.mockResolvedValue(undefined);
  });

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = undefined;
    vi.useRealTimers();
  });

  it('registers expected event listeners', async () => {
    subscribeAppEvents(handlers);
    await Promise.resolve();
    const expected = [
      'message_new',
      'message_update',
      'sync_slice_finished',
      'sync_progress',
      'sync_finished',
      'typing-update',
      'mls_message_new',
      'mls_invite_received',
      'mls_welcome_accepted',
      'channel_added_to_squad',
      'mls_group_updated',
      'mls_group_initial_sync',
      'mls_group_left',
      'dashboard_poll_replica_updated',
    ];
    for (const e of expected) {
      expect(mocks.registered[e], `missing listener for ${e}`).toBeDefined();
      expect(mocks.registered[e].length).toBe(1);
    }
  });

  it('unsubscribes clears timeouts and unlisten promises', () => {
    unsubscribe = subscribeAppEvents(handlers);
    unsubscribe();
  });

  describe('message_new', () => {
    it('ignores non-npub1 chat ids', () => {
      unsubscribe = subscribeAppEvents(handlers);
      emit('message_new', { chat_id: 'group1', message: dmMessage() });
      expect(mocks.mockStores.backendDmMessages.get()).toEqual({});
      expect(mocks.mockFunctions.incrementDmUnread).not.toHaveBeenCalled();
    });

    it('appends pacto inbox message for routable invite content from others', () => {
      mocks.mockFunctions.isPactoAppRoutableInviteContent.mockReturnValue(true);
      mocks.mockFunctions.resolveInviteInviterNpub.mockReturnValue('npub1inviter');
      unsubscribe = subscribeAppEvents(handlers);
      const message = dmMessage({ mine: false });
      emit('message_new', { chat_id: 'npub1chat', message });
      expect(mocks.mockFunctions.appendPactoAppInboxMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'msg1' }),
        'npub1inviter'
      );
      expect(mocks.mockStores.backendDmMessages.get()).toEqual({});
    });

    it('does not append inbox message for own routable invite', () => {
      mocks.mockFunctions.isPactoAppRoutableInviteContent.mockReturnValue(true);
      unsubscribe = subscribeAppEvents(handlers);
      emit('message_new', { chat_id: 'npub1chat', message: dmMessage({ mine: true }) });
      expect(mocks.mockFunctions.appendPactoAppInboxMessage).not.toHaveBeenCalled();
    });

    it('adds message to backendDmMessages for normal DM content', () => {
      unsubscribe = subscribeAppEvents(handlers);
      emit('message_new', { chat_id: 'npub1chat', message: dmMessage({ id: 'm1' }) });
      expect(mocks.mockStores.backendDmMessages.get()).toHaveProperty('npub1chat');
      const chatMessages = mocks.mockStores.backendDmMessages.get()['npub1chat'];
      expect(chatMessages).toHaveLength(1);
      expect(chatMessages![0].id).toBe('m1');
    });

    it('increments unread for inbound message when not active thread', () => {
      unsubscribe = subscribeAppEvents(handlers);
      mocks.mockStores.activeDmId.set('npub1other');
      emit('message_new', { chat_id: 'npub1chat', message: dmMessage({ mine: false }) });
      expect(mocks.mockFunctions.incrementDmUnread).toHaveBeenCalledWith('npub1chat');
    });

    it('does not increment unread for own message', () => {
      unsubscribe = subscribeAppEvents(handlers);
      mocks.mockStores.activeDmId.set('npub1chat');
      emit('message_new', { chat_id: 'npub1chat', message: dmMessage({ mine: true }) });
      expect(mocks.mockFunctions.incrementDmUnread).not.toHaveBeenCalled();
    });

    it('does not increment unread when thread is active and scrolled to bottom', () => {
      unsubscribe = subscribeAppEvents(handlers);
      mocks.mockStores.activeDmId.set('npub1chat');
      mocks.dmThreadScrolledToBottom.set(true);
      emit('message_new', { chat_id: 'npub1chat', message: dmMessage({ mine: false }) });
      expect(mocks.mockFunctions.incrementDmUnread).not.toHaveBeenCalled();
    });

    it('updates dmChatsByNpub metadata', () => {
      unsubscribe = subscribeAppEvents(handlers);
      emit('message_new', { chat_id: 'npub1chat', message: dmMessage({ at: 5000, mine: false }) });
      const chat = mocks.mockStores.dmChatsByNpub.get()['npub1chat'] as Record<string, unknown>;
      expect(chat).toBeDefined();
      expect(chat.hasFromThem).toBe(true);
      expect(chat.lastAt).toBe(5000);
    });

    it('clears typing indicator for the chat', () => {
      unsubscribe = subscribeAppEvents(handlers);
      mocks.mockStores.typingByChat.set({ npub1chat: ['typer'] });
      emit('message_new', { chat_id: 'npub1chat', message: dmMessage() });
      expect(mocks.mockStores.typingByChat.get()).toEqual({ npub1chat: [] });
    });

    it('normalizes wallet tx announcement to pending false', () => {
      mocks.mockFunctions.parseWalletTxAnnouncement.mockReturnValue({ block_number: 1 });
      unsubscribe = subscribeAppEvents(handlers);
      emit('message_new', { chat_id: 'npub1chat', message: dmMessage({ pending: true }) });
      const stored = mocks.mockStores.backendDmMessages.get()['npub1chat']![0];
      expect(stored.pending).toBe(false);
    });
  });

  describe('message_update', () => {
    it('replaces message in DM backend for npub1 chat', () => {
      unsubscribe = subscribeAppEvents(handlers);
      emit('message_update', {
        chat_id: 'npub1chat',
        old_id: 'old1',
        message: dmMessage({ id: 'new1', at: 2000 }),
      });
      const list = mocks.mockStores.backendDmMessages.get()['npub1chat']!;
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('new1');
    });

    it('handles routable invite update in DM chat', () => {
      mocks.mockFunctions.isPactoAppRoutableInviteContent.mockReturnValue(true);
      mocks.mockFunctions.resolveInviteInviterNpub.mockReturnValue('npub1inviter');
      unsubscribe = subscribeAppEvents(handlers);
      emit('message_update', {
        chat_id: 'npub1chat',
        old_id: 'old1',
        message: dmMessage({ mine: false }),
      });
      expect(mocks.mockFunctions.appendPactoAppInboxMessage).toHaveBeenCalled();
      expect(mocks.mockStores.backendDmMessages.get()).toEqual({});
    });

    it('updates group messages for non-npub1 chat', () => {
      unsubscribe = subscribeAppEvents(handlers);
      emit('message_update', {
        chat_id: 'group1',
        old_id: 'old1',
        message: dmMessage({ id: 'new1', at: 2000 }),
      });
      expect(mocks.mockStores.backendGroupMessages.get()).toHaveProperty('group1');
    });

    it('merges treasury safes on squad_safe_updated announcement', () => {
      mocks.mockFunctions.parseAnnouncement.mockReturnValue({
        type: 'squad_safe_updated',
        payload: { squad_id: 's1' },
      });
      unsubscribe = subscribeAppEvents(handlers);
      emit('message_update', { chat_id: 'group1', old_id: 'old1', message: dmMessage() });
      expect(handlers.mergeTreasurySafesForParent).toHaveBeenCalledWith('s1');
    });

    it('merges squad infra on governance_updated announcement', () => {
      mocks.mockFunctions.parseAnnouncement.mockReturnValue({
        type: 'governance_updated',
        payload: { parent_id: 'p1' },
      });
      unsubscribe = subscribeAppEvents(handlers);
      emit('message_update', { chat_id: 'group1', old_id: 'old1', message: dmMessage() });
      expect(handlers.mergeSquadInfraForParent).toHaveBeenCalledWith('p1');
    });
  });

  describe('sync events', () => {
    it('sync_slice_finished triggers fetchMessages(false)', () => {
      unsubscribe = subscribeAppEvents(handlers);
      emit('sync_slice_finished', {});
      expect(mocks.mockFunctions.fetchMessages).toHaveBeenCalledWith(false);
      expect(mocks.mockStores.dmSyncStatus.get()).toBe('syncing');
    });

    it('sync_progress transitions idle to syncing', () => {
      unsubscribe = subscribeAppEvents(handlers);
      emit('sync_progress', {});
      expect(mocks.mockStores.dmSyncStatus.get()).toBe('syncing');
    });

    it('sync_progress keeps non-idle state unchanged', () => {
      mocks.mockStores.dmSyncStatus.set('finished');
      unsubscribe = subscribeAppEvents(handlers);
      emit('sync_progress', {});
      expect(mocks.mockStores.dmSyncStatus.get()).toBe('finished');
    });

    it('sync_finished reconciles invites and returns to idle after timeout', () => {
      vi.useFakeTimers();
      unsubscribe = subscribeAppEvents(handlers);
      emit('sync_finished', {});
      expect(mocks.mockFunctions.reconcilePeerThreadInvites).toHaveBeenCalled();
      expect(mocks.mockStores.dmSyncStatus.get()).toBe('finished');
      vi.advanceTimersByTime(2500);
      expect(mocks.mockStores.dmSyncStatus.get()).toBe('idle');
    });
  });

  describe('typing-update', () => {
    it('ignores non-npub1 conversations', () => {
      unsubscribe = subscribeAppEvents(handlers);
      emit('typing-update', { conversation_id: 'group1', typers: ['t1'] });
      expect(mocks.mockStores.typingByChat.get()).toEqual({});
    });

    it('sets typers for npub1 conversation', () => {
      unsubscribe = subscribeAppEvents(handlers);
      emit('typing-update', { conversation_id: 'npub1chat', typers: ['t1'] });
      expect(mocks.mockStores.typingByChat.get()['npub1chat']).toEqual(['t1']);
    });

    it('clears typers after expiry', () => {
      vi.useFakeTimers();
      unsubscribe = subscribeAppEvents(handlers);
      emit('typing-update', { conversation_id: 'npub1chat', typers: ['t1'] });
      vi.advanceTimersByTime(15_000);
      expect(mocks.mockStores.typingByChat.get()['npub1chat']).toEqual([]);
    });
  });

  describe('mls_message_new', () => {
    it('adds message to backendGroupMessages', () => {
      unsubscribe = subscribeAppEvents(handlers);
      emit('mls_message_new', { group_id: 'g1', message: dmMessage({ id: 'm1' }) });
      const list = mocks.mockStores.backendGroupMessages.get()['g1'] as Array<{ id: string }>;
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('m1');
    });

    it('merges treasury safes on squad_safe_updated', () => {
      mocks.mockFunctions.parseAnnouncement.mockReturnValue({
        type: 'squad_safe_updated',
        payload: { squad_id: 's1' },
      });
      unsubscribe = subscribeAppEvents(handlers);
      emit('mls_message_new', { group_id: 'g1', message: dmMessage() });
      expect(handlers.mergeTreasurySafesForParent).toHaveBeenCalledWith('s1');
    });

    it('merges squad infra on governance_updated', () => {
      mocks.mockFunctions.parseAnnouncement.mockReturnValue({
        type: 'governance_updated',
        payload: { parent_id: 'p1' },
      });
      unsubscribe = subscribeAppEvents(handlers);
      emit('mls_message_new', { group_id: 'g1', message: dmMessage() });
      expect(handlers.mergeSquadInfraForParent).toHaveBeenCalledWith('p1');
    });

    it('updates channel name when group_name provided', () => {
      unsubscribe = subscribeAppEvents(handlers);
      emit('mls_message_new', { group_id: 'g1', message: dmMessage(), group_name: 'General' });
      expect(mocks.mockFunctions.updateChannelNameIfPlaceholder).toHaveBeenCalledWith('g1', 'General');
    });
  });

  describe('mls invite and membership events', () => {
    it('mls_invite_received refreshes pending welcomes', async () => {
      mocks.mockFunctions.listPendingMlsWelcomes.mockResolvedValue([{ group_id: 'g1' }]);
      unsubscribe = subscribeAppEvents(handlers);
      emit('mls_invite_received', {});
      await Promise.resolve();
      await Promise.resolve();
      expect(mocks.mockFunctions.listPendingMlsWelcomes).toHaveBeenCalled();
      expect(mocks.mockStores.pendingMlsWelcomes.get()).toEqual([{ group_id: 'g1' }]);
    });

    it('mls_welcome_accepted refreshes welcomes and handles acceptance', async () => {
      mocks.mockFunctions.listPendingMlsWelcomes.mockResolvedValue([]);
      unsubscribe = subscribeAppEvents(handlers);
      emit('mls_welcome_accepted', { group_id: 'g1' });
      await Promise.resolve();
      await Promise.resolve();
      expect(mocks.mockFunctions.listPendingMlsWelcomes).toHaveBeenCalled();
      expect(mocks.mockFunctions.handleMlsWelcomeAccepted).toHaveBeenCalledWith('g1');
    });

    it('channel_added_to_squad refreshes welcomes and handles channel', async () => {
      mocks.mockFunctions.listPendingMlsWelcomes.mockResolvedValue([]);
      unsubscribe = subscribeAppEvents(handlers);
      emit('channel_added_to_squad', {
        announcements_group_id: 'a1',
        channel_group_id: 'c1',
        channel_name: 'General',
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(mocks.mockFunctions.listPendingMlsWelcomes).toHaveBeenCalled();
      expect(mocks.mockFunctions.handleChannelAddedToSquad).toHaveBeenCalledWith('a1', 'c1', 'General');
    });

    it.each([
      'mls_group_updated',
      'mls_group_initial_sync',
      'mls_group_left',
    ])('%s bumps membership version', (event) => {
      unsubscribe = subscribeAppEvents(handlers);
      emit(event, { group_id: 'g1' });
      expect(mocks.mockFunctions.bumpMembershipVersion).toHaveBeenCalledWith('g1');
    });
  });

  describe('dashboard_poll_replica_updated', () => {
    it('increments nonce for parent id', () => {
      unsubscribe = subscribeAppEvents(handlers);
      emit('dashboard_poll_replica_updated', { parent_id: 'p1' });
      expect(mocks.mockStores.dashboardPollReplicaNonceByParentId.get()['p1']).toBe(1);
      emit('dashboard_poll_replica_updated', { parentId: 'p1' });
      expect(mocks.mockStores.dashboardPollReplicaNonceByParentId.get()['p1']).toBe(2);
    });

    it('ignores missing parent id', () => {
      unsubscribe = subscribeAppEvents(handlers);
      emit('dashboard_poll_replica_updated', {});
      expect(mocks.mockStores.dashboardPollReplicaNonceByParentId.get()).toEqual({});
    });
  });
});
