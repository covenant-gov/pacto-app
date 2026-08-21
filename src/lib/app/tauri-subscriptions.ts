import { get } from 'svelte/store';
import { listen, type UnlistenFn } from '../api';
import {
  listPendingMlsWelcomes,
  fetchMessages,
  parseSquadInviteMessage,
  syncMlsGroupsNow,
  type MlsStoreResetGroupState,
} from '../api/nostr';
import { listRelays, type RelayStatus } from '../api/relays';
import { parseWalletTxAnnouncement, walletTxAnnouncementHash } from '../wallet/dm-messages';
import { onMlsStructuredMessage } from './mls-structured-refresh';
import { handleChannelAddedToSquad, handleMlsWelcomeAccepted, notifyPendingInviteWelcome } from '../invites/accept-invite';
import {
  handleInviteeConsentForAdmit,
  parseSquadInviteAccepted,
} from '../squad/squad-outbound-invite';
import {
  handleBotJoinResponseDm,
  tryCompletePendingApprovedJoins,
} from '../squad/join-request-finalize';
import { updateChannelNameIfPlaceholder } from '../squad/squad-catalog';
import { dmLog, dmError } from '../utils/dm-debug';
import { dropSessionState, initSessionFocusChecks, showMigrationCompleteToast } from '../../stores/auth';
import { installWakeSyncHandlers } from './wake-sync';
import {
  backendDmMessages,
  backendGroupMessages,
  dmChatsByNpub,
  deletingDmNpubs,
  dmSyncStatus,
  typingByChat,
  pendingMlsWelcomes,
  bumpMembershipVersion,
  dashboardPollReplicaNonceByParentId,
  lastCatchUpSuccess,
  seedRelayHealth,
  applyRelayStatusChange,
  installSyncHealthTicker,
  type DmMessage,
  type DmChatState,
  type SyncStatus,
} from '../../stores/app';
import { mergeUnreadCounts } from '../../stores/unread';
import { applyStickerPacksUpdate } from '../../stores/stickers';
import type { StickerPack } from '../api/stickers';

import {
  applyMlsStoreResetState,
  refreshMlsStoreResetState,
} from '../../stores/mls-reset';
const TYPING_EXPIRY_SEC = 15;

export interface AppEventHandlers {
  mergeTreasurySafesForParent: (parentId: string) => void;
  mergeSquadInfraForParent: (parentId: string) => void;
  /** Refresh Crew roster EVM maps after a peer `squad_member_evm_share` (announcements MLS group id). */
  mergeSquadMemberEvmForAnnouncementsGroup: (announcementsGroupId: string) => void;
}

function normalizeDmPayload(message: DmMessage): DmMessage {
  const base = {
    id: message.id,
    content: message.content,
    at: message.at,
    mine: message.mine,
    npub: message.npub,
    pending: message.pending,
    failed: message.failed,
    virtual_bucket: (message as { virtual_bucket?: string | null }).virtual_bucket,
    replied_to: (message as { replied_to?: string }).replied_to,
    replied_to_content: (message as { replied_to_content?: string | null }).replied_to_content,
    replied_to_npub: (message as { replied_to_npub?: string | null }).replied_to_npub,
    replied_to_has_attachment: (message as { replied_to_has_attachment?: boolean | null })
      .replied_to_has_attachment,
    attachments: message.attachments,
    reactions: message.reactions,
    preview_metadata: message.preview_metadata,
  };
  const ann = parseWalletTxAnnouncement(message.content ?? '');
  if (ann?.block_number) {
    return { ...base, pending: false };
  }
  return base;
}

async function refreshPendingWelcomes(): Promise<void> {
  console.log('[Squad/Invite] refreshPendingWelcomes: calling listPendingMlsWelcomes…');
  const list = await listPendingMlsWelcomes();
  pendingMlsWelcomes.set(list);
  console.log(
    '[Squad/Invite] refreshPendingWelcomes: count=',
    list.length,
    'welcomes=',
    list.map((w) => ({
      groupId: w.nostr_group_id?.slice(0, 16) + '…',
      name: w.group_name,
      wrapperId: w.wrapper_event_id?.slice(0, 16) + '…',
    }))
  );
}

function register(
  unsubs: Promise<UnlistenFn>[],
  event: string,
  handler: Parameters<typeof listen>[1]
): void {
  const isVitest =
    (typeof import.meta.env !== 'undefined' && import.meta.env.VITEST) ||
    (typeof process !== 'undefined' && process.env?.VITEST);
  if (!isVitest && typeof window !== 'undefined' && !window.__TAURI__) {
    unsubs.push(Promise.resolve(() => {}));
    return;
  }
  unsubs.push(listen(event, handler));
}

export function subscribeAppEvents(handlers: AppEventHandlers): () => void {
  const typingClearTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  const unsubs: Promise<UnlistenFn>[] = [];
  const cleanupSessionFocusChecks = initSessionFocusChecks();
  const cleanupWakeSync = installWakeSyncHandlers();
  const cleanupSyncHealthTicker = installSyncHealthTicker();
  refreshMlsStoreResetState().catch((e) => dmError('refreshMlsStoreResetState', e));
  listRelays()
    .then((relays) =>
      seedRelayHealth(relays.map((r) => ({ url: r.url, status: r.status, enabled: r.enabled })))
    )
    .catch((e) => dmError('seedRelayHealth: listRelays failed', e));

  register(unsubs, 'message_new', (event) => {
    const { message, chat_id } = event.payload as { message: DmMessage; chat_id: string };
    dmLog('message_new', {
      chat_id: chat_id.slice(0, 20) + '…',
      messageId: message.id?.slice(0, 12),
      mine: message.mine,
    });
    if (!chat_id.startsWith('npub1')) return;
    if (get(deletingDmNpubs).has(chat_id)) return;
    const content = message.content ?? '';
    const inviteAccepted = parseSquadInviteAccepted(content);
    if (inviteAccepted && !message.mine) {
      void handleInviteeConsentForAdmit(inviteAccepted, { broadcastAdmitNeeded: true });
      return;
    }
    if (!message.mine) {
      void handleBotJoinResponseDm(content, chat_id);
    }
    const m = normalizeDmPayload(message);
    backendDmMessages.update((byNpub: Record<string, DmMessage[]>) => {
      const list = byNpub[chat_id] ?? [];
      if (list.some((x) => x.id === m.id)) return byNpub;
      const incomingHash = walletTxAnnouncementHash(m.content ?? '');
      const withoutDupes = list.filter((x) => {
        if (x.id === m.id) return false;
        if (incomingHash) {
          return walletTxAnnouncementHash(x.content ?? '') !== incomingHash;
        }
        return !(x.id.startsWith('opt-') && x.mine && x.content === m.content);
      });
      return { ...byNpub, [chat_id]: [...withoutDupes, m] };
    });
    dmChatsByNpub.update((map: Record<string, DmChatState>) => {
      const cur = map[chat_id];
      const next = {
        npub: chat_id,
        name: cur?.name,
        avatar: cur?.avatar,
        hasFromMe: (cur?.hasFromMe ?? false) || m.mine,
        hasFromThem: (cur?.hasFromThem ?? false) || !m.mine,
        lastAt: Math.max(cur?.lastAt ?? 0, m.at),
      };
      return { ...map, [chat_id]: next };
    });
    if (!m.mine) {
      const invite = parseSquadInviteMessage(content);
      if (invite?.groupId) {
        void syncMlsGroupsNow(invite.groupId).catch((e) =>
          dmError('syncMlsGroupsNow after squad invite DM', e)
        );
      }
    }
    const clearTimeoutId = typingClearTimeouts.get(chat_id);
    if (clearTimeoutId) {
      clearTimeout(clearTimeoutId);
      typingClearTimeouts.delete(chat_id);
    }
    typingByChat.update((by: Record<string, string[]>) => {
      if (!by[chat_id]?.length) return by;
      return { ...by, [chat_id]: [] };
    });
  });

  register(unsubs, 'message_update', (event) => {
    const { old_id, message, chat_id } = event.payload as {
      old_id: string;
      message: DmMessage;
      chat_id: string;
    };
    dmLog('message_update', {
      chat_id: chat_id.slice(0, 20) + '…',
      old_id: old_id?.slice(0, 12),
      new_id: message.id?.slice(0, 12),
    });
    const m = normalizeDmPayload(message);
    if (chat_id.startsWith('npub1')) {
      if (get(deletingDmNpubs).has(chat_id)) return;
      backendDmMessages.update((byNpub: Record<string, DmMessage[]>) => {
        const list = byNpub[chat_id] ?? [];
        const out = list.filter((x) => x.id !== old_id && x.id !== m.id);
        return {
          ...byNpub,
          [chat_id]: [...out, m].sort((a: DmMessage, b: DmMessage) => a.at - b.at),
        };
      });
      if (!m.mine) {
        const invite = parseSquadInviteMessage(m.content ?? '');
        if (invite?.groupId) {
          void syncMlsGroupsNow(invite.groupId).catch((e) =>
            dmError('syncMlsGroupsNow after squad invite DM update', e)
          );
        }
      }
    } else {
      backendGroupMessages.update((byGroup: Record<string, DmMessage[]>) => {
        const list = byGroup[chat_id] ?? [];
        const out = list.filter((x) => x.id !== old_id && x.id !== m.id);
        return {
          ...byGroup,
          [chat_id]: [...out, m].sort((a: DmMessage, b: DmMessage) => a.at - b.at),
        };
      });
      onMlsStructuredMessage(m.content, chat_id, handlers);
    }
  });

  register(unsubs, 'sync_slice_finished', () => {
    dmLog('sync_slice_finished → fetchMessages(false)');
    dmSyncStatus.set('syncing');
    fetchMessages(false).catch((e) => {
      dmError('sync_slice_finished: fetchMessages(false) failed', e);
    });
  });

  register(unsubs, 'sync_progress', () => {
    dmSyncStatus.update((s: SyncStatus) => (s === 'idle' ? 'syncing' : s));
  });

  register(unsubs, 'sync_finished', () => {
    dmLog('sync_finished (historical sync complete)');
    dmSyncStatus.set('finished');
    lastCatchUpSuccess.set(Date.now());
    setTimeout(() => dmSyncStatus.set('idle'), 2500);
  });

  register(unsubs, 'relay_status_change', (event) => {
    const { url, status } = event.payload as { url: string; status: RelayStatus };
    applyRelayStatusChange(url, status);
  });

  register(unsubs, 'typing-update', (e) => {
    const { conversation_id, typers } = e.payload as { conversation_id: string; typers: string[] };
    if (!conversation_id.startsWith('npub1')) return;
    const list = typers ?? [];
    typingByChat.update((by: Record<string, string[]>) => ({ ...by, [conversation_id]: list }));

    const existing = typingClearTimeouts.get(conversation_id);
    if (existing) clearTimeout(existing);
    typingClearTimeouts.delete(conversation_id);
    if (list.length > 0) {
      const t = setTimeout(() => {
        typingClearTimeouts.delete(conversation_id);
        typingByChat.update((by: Record<string, string[]>) => {
          const next = { ...by };
          if (next[conversation_id]?.length) next[conversation_id] = [];
          return next;
        });
      }, TYPING_EXPIRY_SEC * 1000);
      typingClearTimeouts.set(conversation_id, t);
    }
  });

  register(unsubs, 'mls_message_new', (event) => {
    const { group_id, message, group_name } = event.payload as {
      group_id: string;
      message: DmMessage;
      group_name?: string;
    };
    const m = normalizeDmPayload(message);
    backendGroupMessages.update((byGroup: Record<string, DmMessage[]>) => {
      const list = byGroup[group_id] ?? [];
      if (list.some((x) => x.id === m.id)) return byGroup;
      const withoutOpt = list.filter(
        (x) =>
          !(
            (x.id.startsWith('opt-') || x.id.startsWith('pending-')) &&
            x.mine &&
            x.content === m.content
          )
      );
      return { ...byGroup, [group_id]: [...withoutOpt, m] };
    });
    onMlsStructuredMessage(m.content, group_id, handlers);
    if (group_name) updateChannelNameIfPlaceholder(group_id, group_name);
  });

  register(unsubs, 'unread_counts_changed', (event) => {
    mergeUnreadCounts(event.payload as Record<string, number>);
  });

  register(unsubs, 'sticker_packs_updated', (event) => {
    applyStickerPacksUpdate((event.payload as { packs: StickerPack[] }).packs);
  });

  refreshPendingWelcomes().catch((e) => dmError('refreshPendingWelcomes', e));

  register(unsubs, 'mls_invite_received', (event) => {
    console.log('[Squad/Invite] mls_invite_received event: refreshing pending welcomes');
    refreshPendingWelcomes().catch((e) => dmError('mls_invite_received refresh', e));
    const groupId =
      event?.payload && typeof event.payload === 'object' && 'group_id' in event.payload
        ? String((event.payload as { group_id?: string }).group_id ?? '')
        : '';
    notifyPendingInviteWelcome(groupId || null);
    void tryCompletePendingApprovedJoins(groupId || null);
  });

  register(unsubs, 'mls_store_reset', (event) => {
    applyMlsStoreResetState(event.payload as MlsStoreResetGroupState[]);
  });

  register(unsubs, 'mls_welcome_accepted', (event) => {
    const group_id = (event.payload as { group_id: string }).group_id;
    refreshPendingWelcomes().catch((e) => dmError('mls_welcome_accepted refresh', e));
    handleMlsWelcomeAccepted(group_id);
  });

  register(unsubs, 'channel_added_to_squad', (event) => {
    const { announcements_group_id, channel_group_id, channel_name } = event.payload as {
      announcements_group_id: string;
      channel_group_id: string;
      channel_name: string;
    };
    refreshPendingWelcomes().catch((e) => dmError('channel_added_to_squad refresh', e));
    handleChannelAddedToSquad(announcements_group_id, channel_group_id, channel_name);
  });

  register(unsubs, 'mls_group_updated', (event) => {
    const gid = (event.payload as { group_id?: string })?.group_id;
    if (gid) bumpMembershipVersion(gid);
  });

  register(unsubs, 'mls_group_initial_sync', (event) => {
    const gid = (event.payload as { group_id?: string })?.group_id;
    if (gid) bumpMembershipVersion(gid);
  });

  register(unsubs, 'mls_group_left', (event) => {
    const gid = (event.payload as { group_id?: string })?.group_id;
    if (gid) bumpMembershipVersion(gid);
  });

  register(unsubs, 'mls_group_metadata', (event) => {
    const payload = event.payload;
    if (payload && typeof payload === 'object' && 'group_id' in payload) {
      const gid = payload.group_id;
      if (typeof gid === 'string' && gid) bumpMembershipVersion(gid);
    }
  });

  register(unsubs, 'dashboard_poll_replica_updated', (event) => {
    const raw = event.payload as Record<string, unknown> | undefined;
    const pidRaw = raw?.parent_id ?? raw?.parentId;
    const pid = typeof pidRaw === 'string' ? pidRaw.trim() : '';
    if (!pid) return;
    dashboardPollReplicaNonceByParentId.update((m) => ({ ...m, [pid]: (m[pid] ?? 0) + 1 }));
  });

  register(unsubs, 'migration_complete', () => {
    dmLog('migration_complete: showing migration toast');
    showMigrationCompleteToast('Account security updated');
  });

  register(unsubs, 'session_locked', () => {
    dmLog('session_locked: dropping frontend auth state');
    dropSessionState();
  });

  return () => {
    for (const t of typingClearTimeouts.values()) clearTimeout(t);
    typingClearTimeouts.clear();
    unsubs.forEach((p) => p.then((fn) => fn()));
    cleanupSessionFocusChecks();
    cleanupWakeSync();
    cleanupSyncHealthTicker();
  };
}
