import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { listPendingMlsWelcomes, fetchMessages } from '../api/nostr';
import { parseAnnouncement, ANNOUNCE_TYPE_GOVERNANCE_UPDATED } from '../announcements';
import {
  isPactoAppRoutableInviteContent,
  resolveInviteInviterNpub,
} from '../pacto-app-inbox';
import { handleChannelAddedToSquad, handleMlsWelcomeAccepted } from '../invites/accept-invite';
import { dmLog, dmError } from '../utils/dm-debug';
import {
  backendDmMessages,
  backendGroupMessages,
  dmChatsByNpub,
  appendPactoAppInboxMessage,
  reconcilePeerThreadInvites,
  dmSyncStatus,
  typingByChat,
  pendingMlsWelcomes,
  bumpMembershipVersion,
  dashboardPollReplicaNonceByParentId,
  updateChannelNameIfPlaceholder,
  type DmMessage,
  type DmChatState,
  type SyncStatus,
} from '../../stores/app';

const TYPING_EXPIRY_SEC = 15;

export interface AppEventHandlers {
  mergeTreasurySafesForParent: (parentId: string) => void;
  mergeSquadInfraForParent: (parentId: string) => void;
}

function normalizeDmPayload(message: DmMessage): DmMessage {
  return {
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
  };
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
  unsubs.push(listen(event, handler));
}

export function subscribeAppEvents(handlers: AppEventHandlers): () => void {
  const typingClearTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  const unsubs: Promise<UnlistenFn>[] = [];

  register(unsubs, 'message_new', (event) => {
    const { message, chat_id } = event.payload as { message: DmMessage; chat_id: string };
    dmLog('message_new', {
      chat_id: chat_id.slice(0, 20) + '…',
      messageId: message.id?.slice(0, 12),
      mine: message.mine,
    });
    if (!chat_id.startsWith('npub1')) return;
    const content = message.content ?? '';
    const isPactoRoutableInvite = isPactoAppRoutableInviteContent(content);
    const m = normalizeDmPayload(message);
    if (isPactoRoutableInvite) {
      if (!m.mine) {
        appendPactoAppInboxMessage(m, resolveInviteInviterNpub(m, chat_id, content));
      }
    } else {
      backendDmMessages.update((byNpub: Record<string, DmMessage[]>) => {
        const list = byNpub[chat_id] ?? [];
        if (list.some((x) => x.id === m.id)) return byNpub;
        const withoutOpt = list.filter(
          (x) => !(x.id.startsWith('opt-') && x.mine && x.content === m.content)
        );
        return { ...byNpub, [chat_id]: [...withoutOpt, m] };
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
      const msgContent = m.content ?? '';
      if (isPactoAppRoutableInviteContent(msgContent)) {
        if (!m.mine) {
          appendPactoAppInboxMessage(m, resolveInviteInviterNpub(m, chat_id, msgContent));
        }
      } else {
        backendDmMessages.update((byNpub: Record<string, DmMessage[]>) => {
          const list = byNpub[chat_id] ?? [];
          const out = list.filter((x) => x.id !== old_id && x.id !== m.id);
          return {
            ...byNpub,
            [chat_id]: [...out, m].sort((a: DmMessage, b: DmMessage) => a.at - b.at),
          };
        });
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
      const announce = parseAnnouncement(m.content);
      if (announce?.type === 'squad_safe_updated') {
        handlers.mergeTreasurySafesForParent(announce.payload.squad_id);
      }
      if (announce?.type === ANNOUNCE_TYPE_GOVERNANCE_UPDATED) {
        handlers.mergeSquadInfraForParent(announce.payload.parent_id);
      }
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
    reconcilePeerThreadInvites();
    dmSyncStatus.set('finished');
    setTimeout(() => dmSyncStatus.set('idle'), 2500);
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
    const announce = parseAnnouncement(m.content);
    if (announce?.type === 'squad_safe_updated') {
      handlers.mergeTreasurySafesForParent(announce.payload.squad_id);
    }
    if (announce?.type === ANNOUNCE_TYPE_GOVERNANCE_UPDATED) {
      handlers.mergeSquadInfraForParent(announce.payload.parent_id);
    }
    if (group_name) updateChannelNameIfPlaceholder(group_id, group_name);
  });

  refreshPendingWelcomes().catch((e) => dmError('refreshPendingWelcomes', e));

  register(unsubs, 'mls_invite_received', () => {
    console.log('[Squad/Invite] mls_invite_received event: refreshing pending welcomes');
    refreshPendingWelcomes().catch((e) => dmError('mls_invite_received refresh', e));
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

  register(unsubs, 'dashboard_poll_replica_updated', (event) => {
    const raw = event.payload as Record<string, unknown> | undefined;
    const pidRaw = raw?.parent_id ?? raw?.parentId;
    const pid = typeof pidRaw === 'string' ? pidRaw.trim() : '';
    if (!pid) return;
    dashboardPollReplicaNonceByParentId.update((m) => ({ ...m, [pid]: (m[pid] ?? 0) + 1 }));
  });

  return () => {
    for (const t of typingClearTimeouts.values()) clearTimeout(t);
    typingClearTimeouts.clear();
    unsubs.forEach((p) => p.then((fn) => fn()));
  };
}
