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
    lastCatchUpSuccess: createMockStore<number | null>(null),
  };

  const mockFunctions = {
    bumpMembershipVersion: vi.fn(),
    handleMlsWelcomeAccepted: vi.fn(),
    handleChannelAddedToSquad: vi.fn(),
    notifyPendingInviteWelcome: vi.fn(),
    updateChannelNameIfPlaceholder: vi.fn(),
    listPendingMlsWelcomes: vi.fn(),
    fetchMessages: vi.fn(),
    parseSquadInviteMessage: vi.fn(),
    syncMlsGroupsNow: vi.fn(),
    parseAnnouncement: vi.fn(),
    parseWalletTxAnnouncement: vi.fn(),
    mergeUnreadCounts: vi.fn(),
    dmLog: vi.fn(),
    dmError: vi.fn(),
    listRelays: vi.fn(),
    seedRelayHealth: vi.fn(),
    applyRelayStatusChange: vi.fn(),
    installSyncHealthTicker: vi.fn(() => vi.fn()),
  };

  const migrationCompleteToast = createMockStore<{ shown: boolean; message: string } | null>(null);
  const showMigrationCompleteToast = vi.fn((message: string) => {
    migrationCompleteToast.set({ shown: true, message });
  });
  const dropSessionState = vi.fn();
  const initSessionFocusChecks = vi.fn(() => () => {});

  return {
    createMockStore,
    registered,
    listen,
    mockStores,
    mockFunctions,
    migrationCompleteToast,
    showMigrationCompleteToast,
    dropSessionState,
    initSessionFocusChecks,
  };
});

vi.mock('@tauri-apps/api/event', () => ({
  listen: mocks.listen,
}));

vi.mock('../api/nostr', () => ({
  listPendingMlsWelcomes: (...args: unknown[]) => mocks.mockFunctions.listPendingMlsWelcomes(...args),
  fetchMessages: (...args: unknown[]) => mocks.mockFunctions.fetchMessages(...args),
  parseSquadInviteMessage: (...args: unknown[]) => mocks.mockFunctions.parseSquadInviteMessage(...args),
  syncMlsGroupsNow: (...args: unknown[]) => mocks.mockFunctions.syncMlsGroupsNow(...args),
}));

vi.mock('../api/relays', () => ({
  listRelays: (...args: unknown[]) => mocks.mockFunctions.listRelays(...args),
}));

vi.mock('../announcements', () => ({
  parseAnnouncement: (...args: unknown[]) => mocks.mockFunctions.parseAnnouncement(...args),
  ANNOUNCE_TYPE_GOVERNANCE_UPDATED: 'governance_updated',
  ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE: 'squad_member_evm_share',
}));

vi.mock('../wallet/dm-messages', () => ({
  parseWalletTxAnnouncement: (...args: unknown[]) =>
    mocks.mockFunctions.parseWalletTxAnnouncement(...args),
  walletTxAnnouncementHash: (...args: unknown[]) => {
    const parsed = mocks.mockFunctions.parseWalletTxAnnouncement(...args);
    return parsed?.tx_hash?.toLowerCase() ?? null;
  },
}));

vi.mock('../invites/accept-invite', () => ({
  handleChannelAddedToSquad: (...args: unknown[]) =>
    mocks.mockFunctions.handleChannelAddedToSquad(...args),
  handleMlsWelcomeAccepted: (...args: unknown[]) =>
    mocks.mockFunctions.handleMlsWelcomeAccepted(...args),
  notifyPendingInviteWelcome: (...args: unknown[]) =>
    mocks.mockFunctions.notifyPendingInviteWelcome(...args),
}));

vi.mock('../squad/squad-catalog', () => ({
  updateChannelNameIfPlaceholder: (...args: unknown[]) =>
    mocks.mockFunctions.updateChannelNameIfPlaceholder(...args),
}));

vi.mock('../utils/dm-debug', () => ({
  dmLog: (...args: unknown[]) => mocks.mockFunctions.dmLog(...args),
  dmError: (...args: unknown[]) => mocks.mockFunctions.dmError(...args),
}));

vi.mock('../../stores/auth', () => ({
  dropSessionState: mocks.dropSessionState,
  initSessionFocusChecks: mocks.initSessionFocusChecks,
  showMigrationCompleteToast: mocks.showMigrationCompleteToast,
  migrationCompleteToast: mocks.migrationCompleteToast,
}));

vi.mock('../../stores/app', () => ({
  backendDmMessages: mocks.mockStores.backendDmMessages,
  backendGroupMessages: mocks.mockStores.backendGroupMessages,
  dmChatsByNpub: mocks.mockStores.dmChatsByNpub,
  dmSyncStatus: mocks.mockStores.dmSyncStatus,
  typingByChat: mocks.mockStores.typingByChat,
  pendingMlsWelcomes: mocks.mockStores.pendingMlsWelcomes,
  bumpMembershipVersion: (...args: unknown[]) => mocks.mockFunctions.bumpMembershipVersion(...args),
  dashboardPollReplicaNonceByParentId: mocks.mockStores.dashboardPollReplicaNonceByParentId,
  lastCatchUpSuccess: mocks.mockStores.lastCatchUpSuccess,
  seedRelayHealth: (...args: unknown[]) => mocks.mockFunctions.seedRelayHealth(...args),
  applyRelayStatusChange: (...args: unknown[]) => mocks.mockFunctions.applyRelayStatusChange(...args),
  installSyncHealthTicker: mocks.mockFunctions.installSyncHealthTicker,
}));

vi.mock('../../stores/unread', () => ({
  mergeUnreadCounts: (...args: unknown[]) => mocks.mockFunctions.mergeUnreadCounts(...args),
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
  mergeSquadMemberEvmForAnnouncementsGroup: vi.fn(),
};

describe('subscribeAppEvents', () => {
  let unsubscribe: (() => void) | undefined;
  const windowAddEventListener = vi.fn();
  const windowRemoveEventListener = vi.fn();
  const documentAddEventListener = vi.fn();
  const documentRemoveEventListener = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // installWakeSyncHandlers (called from subscribeAppEvents) touches window/document;
    // this suite runs in the 'node' test environment, so stub the bare minimum it needs.
    vi.stubGlobal('window', {
      addEventListener: windowAddEventListener,
      removeEventListener: windowRemoveEventListener,
    });
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: documentAddEventListener,
      removeEventListener: documentRemoveEventListener,
    });
    Object.keys(mocks.registered).forEach((k) => delete mocks.registered[k]);
    mocks.mockStores.backendDmMessages.set({});
    mocks.mockStores.backendGroupMessages.set({});
    mocks.mockStores.dmChatsByNpub.set({});
    mocks.mockStores.dmSyncStatus.set('idle');
    mocks.mockStores.typingByChat.set({});
    mocks.mockStores.pendingMlsWelcomes.set([]);
    mocks.mockStores.dashboardPollReplicaNonceByParentId.set({});
    mocks.mockStores.lastCatchUpSuccess.set(null);
    mocks.mockFunctions.parseSquadInviteMessage.mockReturnValue(null);
    mocks.mockFunctions.parseWalletTxAnnouncement.mockReturnValue(null);
    mocks.mockFunctions.parseAnnouncement.mockReturnValue(null);
    mocks.mockFunctions.listPendingMlsWelcomes.mockResolvedValue([]);
    mocks.mockFunctions.fetchMessages.mockResolvedValue(undefined);
    mocks.mockFunctions.syncMlsGroupsNow.mockResolvedValue(undefined);
    mocks.mockFunctions.listRelays.mockResolvedValue([]);
    mocks.mockFunctions.installSyncHealthTicker.mockReturnValue(vi.fn());
  });

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('registers expected event listeners', async () => {
    unsubscribe = subscribeAppEvents(handlers);
    await Promise.resolve();
    const expected = [
      'message_new',
      'message_update',
      'sync_slice_finished',
      'sync_progress',
      'sync_finished',
      'relay_status_change',
      'typing-update',
      'mls_message_new',
      'unread_counts_changed',
      'mls_invite_received',
      'mls_welcome_accepted',
      'channel_added_to_squad',
      'mls_group_updated',
      'mls_group_initial_sync',
      'mls_group_left',
      'dashboard_poll_replica_updated',
      'migration_complete',
      'session_locked',
    ];
    for (const e of expected) {
      expect(mocks.registered[e], `missing listener for ${e}`).toBeDefined();
      expect(mocks.registered[e].length).toBe(1);
    }

    expect(windowAddEventListener).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(documentAddEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(documentAddEventListener).toHaveBeenCalledWith('resume', expect.any(Function));

    unsubscribe();
    unsubscribe = undefined;

    expect(windowRemoveEventListener).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(documentRemoveEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(documentRemoveEventListener).toHaveBeenCalledWith('resume', expect.any(Function));
  });

  it('unsubscribes clears timeouts and unlisten promises', () => {
    unsubscribe = subscribeAppEvents(handlers);
    unsubscribe();
  });

  it('shows migration complete toast on migration_complete event', () => {
    unsubscribe = subscribeAppEvents(handlers);
    emit('migration_complete', {});
    expect(mocks.showMigrationCompleteToast).toHaveBeenCalledWith('Account security updated');
    expect(mocks.migrationCompleteToast.get()).toEqual({
      shown: true,
      message: 'Account security updated',
    });
  });

  describe('message_new', () => {
    it('ignores non-npub1 chat ids', () => {
      unsubscribe = subscribeAppEvents(handlers);
      emit('message_new', { chat_id: 'group1', message: dmMessage() });
      expect(mocks.mockStores.backendDmMessages.get()).toEqual({});
    });

    it('syncs MLS groups eagerly for an incoming squad invite DM', () => {
      mocks.mockFunctions.parseSquadInviteMessage.mockReturnValue({ groupId: 'g1' });
      unsubscribe = subscribeAppEvents(handlers);
      emit('message_new', { chat_id: 'npub1chat', message: dmMessage({ mine: false }) });
      expect(mocks.mockFunctions.syncMlsGroupsNow).toHaveBeenCalledWith('g1');
      expect(mocks.mockStores.backendDmMessages.get()['npub1chat']).toHaveLength(1);
    });

    it('does not sync MLS groups for an own outgoing squad invite DM', () => {
      mocks.mockFunctions.parseSquadInviteMessage.mockReturnValue({ groupId: 'g1' });
      unsubscribe = subscribeAppEvents(handlers);
      emit('message_new', { chat_id: 'npub1chat', message: dmMessage({ mine: true }) });
      expect(mocks.mockFunctions.syncMlsGroupsNow).not.toHaveBeenCalled();
    });

    it('adds message to backendDmMessages for normal DM content', () => {
      unsubscribe = subscribeAppEvents(handlers);
      emit('message_new', { chat_id: 'npub1chat', message: dmMessage({ id: 'm1' }) });
      expect(mocks.mockStores.backendDmMessages.get()).toHaveProperty('npub1chat');
      const chatMessages = mocks.mockStores.backendDmMessages.get()['npub1chat'];
      expect(chatMessages).toHaveLength(1);
      expect(chatMessages![0].id).toBe('m1');
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

  describe('unread_counts_changed', () => {
    it('merges the payload into the unread store', () => {
      unsubscribe = subscribeAppEvents(handlers);
      emit('unread_counts_changed', { npub1chat: 3, group1: 0 });
      expect(mocks.mockFunctions.mergeUnreadCounts).toHaveBeenCalledWith({ npub1chat: 3, group1: 0 });
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

    it('syncs MLS groups eagerly for an incoming squad invite DM update', () => {
      mocks.mockFunctions.parseSquadInviteMessage.mockReturnValue({ groupId: 'g1' });
      unsubscribe = subscribeAppEvents(handlers);
      emit('message_update', {
        chat_id: 'npub1chat',
        old_id: 'old1',
        message: dmMessage({ mine: false }),
      });
      expect(mocks.mockFunctions.syncMlsGroupsNow).toHaveBeenCalledWith('g1');
      expect(mocks.mockStores.backendDmMessages.get()['npub1chat']).toHaveLength(1);
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

    it('sync_finished returns to idle after timeout', () => {
      vi.useFakeTimers();
      unsubscribe = subscribeAppEvents(handlers);
      emit('sync_finished', {});
      expect(mocks.mockStores.dmSyncStatus.get()).toBe('finished');
      vi.advanceTimersByTime(2500);
      expect(mocks.mockStores.dmSyncStatus.get()).toBe('idle');
    });

    it('sync_finished sets lastCatchUpSuccess to now', () => {
      unsubscribe = subscribeAppEvents(handlers);
      const before = Date.now();
      emit('sync_finished', {});
      const value = mocks.mockStores.lastCatchUpSuccess.get();
      expect(value).not.toBeNull();
      expect(value as number).toBeGreaterThanOrEqual(before);
    });
  });

  describe('relay_status_change', () => {
    it('forwards url/status to applyRelayStatusChange', () => {
      unsubscribe = subscribeAppEvents(handlers);
      emit('relay_status_change', { url: 'wss://relay.one', status: 'disconnected' });
      expect(mocks.mockFunctions.applyRelayStatusChange).toHaveBeenCalledWith(
        'wss://relay.one',
        'disconnected'
      );
    });
  });

  describe('startup relay health seeding', () => {
    it('seeds relayStatusByUrl from listRelays on subscribe', async () => {
      mocks.mockFunctions.listRelays.mockResolvedValue([
        { url: 'wss://relay.one', status: 'connected', is_default: true, is_custom: false, enabled: true, mode: 'both' },
      ]);
      unsubscribe = subscribeAppEvents(handlers);
      await Promise.resolve();
      await Promise.resolve();
      expect(mocks.mockFunctions.seedRelayHealth).toHaveBeenCalledWith([
        { url: 'wss://relay.one', status: 'connected', enabled: true },
      ]);
    });

    it('starts the sync health ticker and stops it on cleanup', () => {
      unsubscribe = subscribeAppEvents(handlers);
      expect(mocks.mockFunctions.installSyncHealthTicker).toHaveBeenCalled();
      const cleanupFn = mocks.mockFunctions.installSyncHealthTicker.mock.results[0]?.value;
      unsubscribe();
      unsubscribe = undefined;
      expect(cleanupFn).toHaveBeenCalled();
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

    it('merges roster EVM on squad_member_evm_share', () => {
      mocks.mockFunctions.parseAnnouncement.mockReturnValue({
        type: 'squad_member_evm_share',
        payload: { parent_id: 'announcements-mls', evm_address: '0xabc' },
      });
      unsubscribe = subscribeAppEvents(handlers);
      emit('mls_message_new', { group_id: 'announcements-mls', message: dmMessage() });
      expect(handlers.mergeSquadMemberEvmForAnnouncementsGroup).toHaveBeenCalledWith(
        'announcements-mls',
      );
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
      expect(mocks.mockFunctions.notifyPendingInviteWelcome).toHaveBeenCalledWith(null);
    });

    it('mls_invite_received wakes accept waiters with group_id', async () => {
      mocks.mockFunctions.listPendingMlsWelcomes.mockResolvedValue([]);
      unsubscribe = subscribeAppEvents(handlers);
      emit('mls_invite_received', { group_id: 'g-ann' });
      expect(mocks.mockFunctions.notifyPendingInviteWelcome).toHaveBeenCalledWith('g-ann');
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
