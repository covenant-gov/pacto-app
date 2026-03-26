/**
 * Clear all account-specific frontend state (localStorage + in-memory stores).
 * Used on logout and when switching to a new account so the UI never shows
 * the previous account's squads, DMs, or related state.
 */

import {
  squads,
  networks,
  pinnedDmNpubs,
  dmChatsByNpub,
  activeDmId,
  lastOpenedDmByTab,
  lastOpenedSquadId,
  lastOpenedChannelId,
  lastChannelBySquadId,
  activeSquadId,
  activeChannelId,
  activeNetworkId,
  lastOpenedNetworkId,
  lastOpenedNetworkChannelId,
  lastChannelByNetworkId,
  acceptedSquadInviteIds,
  declinedSquadInviteIds,
  acceptedNetworkInviteIds,
  declinedNetworkInviteIds,
  acceptedChannelInviteMessageIds,
  declinedChannelInviteMessageIds,
  acceptedWalletTxRequestMessageIds,
  declinedWalletTxRequestMessageIds,
  acceptedWalletPeerInfoRequestMessageIds,
  declinedWalletPeerInfoRequestMessageIds,
  dmWalletPeerExchangeTick,
  backendGroupMessages,
  groupSendError,
  pendingMlsWelcomes,
  parentsCreatingAnnouncements,
  parentCreateErrorById,
  parentPendingCreateMembers,
  ungroupedChannels,
  channelMessages,
  composingNewChat,
  activeTopNavTab,
  activeDmTab,
  activeView,
  showMembersPanel,
  walletSidebarOpen,
  walletSendPrefillFromRequest,
  backendDmMessages,
  messageCountByChat,
  loadedOffsetByChat,
  dmSyncStatus,
  typingByChat,
  dmSendError,
  setCurrentNpubForPersistence,
  treasurySafesByParentId,
} from '../../stores/app';
import { safeStateByTreasuryId } from '../../stores/safe';
import { clearWalletSummaryCacheStore } from '../wallet/wallet-summary-cache';
import { INVITE_DECISION_SCOPED_PREFIXES } from '../../stores/invite-decisions';
import { theme } from '../../stores/theme';
import { recentEmojisStore } from '../../stores/emojis';

/** Legacy (non-scoped) keys to remove for backwards compatibility. */
const LEGACY_LOCAL_STORAGE_KEYS = [
  'pacto_squads',
  'pacto_networks',
  'pacto_last_dm_npub',
  'pacto_last_squad_id',
  'pacto_last_channel_id',
  'pacto_last_network_id',
  'pacto_last_network_channel_id',
  'pacto_pinned_dm_npubs',
  ...INVITE_DECISION_SCOPED_PREFIXES,
  'pacto_theme',
  'recentEmojis',
  'favoriteEmojis',
  '__pacto_init_finished_unlisten',
] as const;

/** Npub-scoped key prefixes (suffix is _<npub>). Invite decision keys from invite-decisions module. */
const SCOPED_KEY_PREFIXES = [
  'pacto_squads',
  'pacto_networks',
  'pacto_last_dm_npub',
  'pacto_last_squad_id',
  'pacto_last_channel_id',
  'pacto_last_channel_by_squad',
  'pacto_last_network_id',
  'pacto_last_network_channel_id',
  'pacto_last_channel_by_network',
  'pacto_pinned_dm_npubs',
  'pacto_wallet_summary_cache_v1',
  ...INVITE_DECISION_SCOPED_PREFIXES,
] as const;

function clearAccountLocalStorage(npub?: string): void {
  if (typeof localStorage === 'undefined') return;
  for (const key of LEGACY_LOCAL_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
  if (npub) {
    for (const prefix of SCOPED_KEY_PREFIXES) {
      try {
        localStorage.removeItem(`${prefix}_${npub}`);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Reset all account-specific in-memory stores so no previous account data is shown.
 * Call this before or alongside logout; also call when a new account becomes active.
 * @param npub - When provided (e.g. on logout), remove this account's npub-scoped localStorage keys.
 */
export function clearAccountState(npub?: string): void {
  setCurrentNpubForPersistence(null);
  clearWalletSummaryCacheStore();
  clearAccountLocalStorage(npub);

  treasurySafesByParentId.set({});
  safeStateByTreasuryId.set({});
  squads.set([]);
  pinnedDmNpubs.set(new Set());
  dmChatsByNpub.set({});
  activeDmId.set(null);
  lastOpenedDmByTab.set({
    friends: null,
    requests: null,
    pending: null,
    search: null,
    pinned: null,
  });
  lastOpenedSquadId.set(null);
  lastOpenedChannelId.set(null);
  lastChannelBySquadId.set({});
  activeSquadId.set(null);
  activeChannelId.set(null);
  networks.set([]);
  activeNetworkId.set(null);
  lastOpenedNetworkId.set(null);
  lastOpenedNetworkChannelId.set(null);
  lastChannelByNetworkId.set({});
  acceptedSquadInviteIds.set([]);
  declinedSquadInviteIds.set([]);
  acceptedNetworkInviteIds.set([]);
  declinedNetworkInviteIds.set([]);
  acceptedChannelInviteMessageIds.set([]);
  declinedChannelInviteMessageIds.set([]);
  acceptedWalletTxRequestMessageIds.set([]);
  declinedWalletTxRequestMessageIds.set([]);
  acceptedWalletPeerInfoRequestMessageIds.set([]);
  declinedWalletPeerInfoRequestMessageIds.set([]);
  dmWalletPeerExchangeTick.set(0);
  backendGroupMessages.set({});
  groupSendError.set(null);
  pendingMlsWelcomes.set([]);
  parentsCreatingAnnouncements.set(new Set());
  parentCreateErrorById.set({});
  parentPendingCreateMembers.set({});
  ungroupedChannels.set([]);
  channelMessages.set({});
  composingNewChat.set(false);
  activeTopNavTab.set('squads');
  activeDmTab.set('friends');
  activeView.set('hub');
  showMembersPanel.set(false);
  walletSidebarOpen.set(false);
  walletSendPrefillFromRequest.set(null);

  backendDmMessages.set({});
  messageCountByChat.set({});
  loadedOffsetByChat.set({});
  dmSyncStatus.set('idle');
  typingByChat.set({});
  dmSendError.set(null);

  theme.set('default');
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', 'default');
  }
  recentEmojisStore.set([]);
  // favoriteEmojis: emojis.ts keeps them in module-level state; we cleared the
  // localStorage key so after restart they're empty. No exported reset for in-memory.
}
