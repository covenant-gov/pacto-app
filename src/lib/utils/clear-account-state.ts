/**
 * Clear all account-specific frontend state (localStorage + in-memory stores).
 * Used on logout and when switching to a new account so the UI never shows
 * the previous account's squads, DMs, or related state.
 */

import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import {
  activeTopNavTab,
  DEFAULT_TOP_NAV_TAB,
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
  dashboardPollReplicaNonceByParentId,
} from '../../stores/navigation';
import {
  pinnedDmNpubs,
  blockedDmNpubs,
  dmChatsByNpub,
  activeDmId,
  lastOpenedDmByTab,
  dmWalletPeerExchangeTick,
  composingNewChat,
  activeDmTab,
  walletSidebarOpen,
  walletSendPrefillFromRequest,
  backendDmMessages,
  dmThreadAnnouncementsByNpub,
  pactoAppInboxMessages,
  messageCountByChat,
  loadedOffsetByChat,
  dmSyncStatus,
  typingByChat,
  dmSendError,
} from '../../stores/dm';
import {
  dmLastReadByNpub,
  dmUnreadByNpub,
  pactoAppInboxLastReadId,
  dmThreadScrolledToBottom,
} from '../../stores/dm-unread';
import {
  acceptedSquadInviteIds,
  declinedSquadInviteIds,
  acceptedChannelInviteMessageIds,
  declinedChannelInviteMessageIds,
  declinedWalletTxRequestMessageIds,
  acceptedWalletPeerInfoRequestMessageIds,
  declinedWalletPeerInfoRequestMessageIds,
} from '../../stores/invite-decisions';
import {
  squads,
  treasurySafesByParentId,
  squadInfraByParentId,
  squadMemberEvmByParentId,
  parentsCreatingAnnouncements,
  parentCreateErrorById,
  parentPendingCreateMembers,
  ungroupedChannels,
  channelMessages,
} from '../../stores/squads';
import {
  backendGroupMessages,
  groupSendError,
  pendingMlsWelcomes,
} from '../../stores/mls-chat';
import { safeStateByTreasuryId } from '../../stores/safe';
import { clearWalletSummaryCacheStore } from '../wallet/wallet-summary-cache';
import { clearDashboardFetchMetaStores } from '../dashboard/dashboard-fetch-meta';
import { clearGovernanceSnapshotCacheStore } from '../dashboard/governance-snapshot-cache';
import { clearSettingsChainCacheStore, SETTINGS_CHAIN_CACHE_PREFIX } from '../dashboard/settings-chain-cache';
import { TREASURY_SAFES_CACHE_PREFIX } from '../dashboard/treasury-safes-cache';
import { SQUAD_INFRA_CACHE_PREFIX } from '../dashboard/squad-infra-cache';
import { SQUAD_MEMBER_EVM_CACHE_PREFIX } from '../dashboard/squad-member-evm-cache';
import { GOVERNANCE_SNAPSHOT_CACHE_PREFIX } from '../dashboard/governance-snapshot-cache';
import { SAFE_STATE_DISK_CACHE_PREFIX } from '../dashboard/safe-state-disk-cache';
import { resetInviteAcceptState } from '../invites/accept-invite';
import { resetCommonsPrefetchSession } from '../commons/commons-prefetch';
import { resetDashboardPrefetchSession } from '../app/dashboard-parent-prefetch';
import { INVITE_DECISION_SCOPED_PREFIXES } from '../../stores/invite-decisions';
import { recentEmojisStore } from '../../stores/emojis';
import { PACTO_COMMONS_BROADCASTS_PREFIX } from '../commons/local-broadcast-state';
import { PACTO_COMMONS_JOIN_REQUESTS_PREFIX } from '../commons/commons-join-request';

/** Npub-scoped key prefixes (suffix is `_<npub>`). */
const SCOPED_KEY_PREFIXES = [
  'pacto_last_dm_npub',
  'pacto_last_squad_id',
  'pacto_last_channel_id',
  'pacto_last_channel_by_squad',
  'pacto_last_hub_channel_name_by_squad',
  'pacto_parent_dashboard_mode',
  'pacto_pinned_dm_npubs',
  'pacto_app_inbox',
  'pacto_wallet_summary_cache_v1',
  TREASURY_SAFES_CACHE_PREFIX,
  SQUAD_INFRA_CACHE_PREFIX,
  SQUAD_MEMBER_EVM_CACHE_PREFIX,
  GOVERNANCE_SNAPSHOT_CACHE_PREFIX,
  SETTINGS_CHAIN_CACHE_PREFIX,
  SAFE_STATE_DISK_CACHE_PREFIX,
  'pacto_wallet_ui_enabled_chains_v1',
  'pacto_wallet_preferred_network_v1',
  'pacto_wallet_rpc_prefs_v1',
  'pacto_wallet_tx_request_accepted',
  PACTO_COMMONS_BROADCASTS_PREFIX,
  PACTO_COMMONS_JOIN_REQUESTS_PREFIX,
  ...INVITE_DECISION_SCOPED_PREFIXES,
] as const;

function clearAccountLocalStorage(npub?: string): void {
  if (typeof localStorage === 'undefined' || !npub) return;
  for (const prefix of SCOPED_KEY_PREFIXES) {
      try {
        localStorage.removeItem(`${prefix}_${npub}`);
      } catch {
        // ignore
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
  resetInviteAcceptState();
  resetDashboardPrefetchSession();
  resetCommonsPrefetchSession();
  clearWalletSummaryCacheStore();
  clearDashboardFetchMetaStores();
  clearGovernanceSnapshotCacheStore();
  clearSettingsChainCacheStore();
  clearAccountLocalStorage(npub);

  treasurySafesByParentId.set({});
  squadInfraByParentId.set({});
  squadMemberEvmByParentId.set({});
  dashboardPollReplicaNonceByParentId.set({});
  safeStateByTreasuryId.set({});
  squads.set([]);
  pinnedDmNpubs.set(new Set());
  blockedDmNpubs.set(new Set());
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
  activeTopNavTab.set(DEFAULT_TOP_NAV_TAB);
  activeDmTab.set('friends');
  activeView.set('hub');
  parentDashboardChannelMode.set('governance');
  showMembersPanel.set(false);
  walletSidebarOpen.set(false);
  walletSendPrefillFromRequest.set(null);

  backendDmMessages.set({});
  dmThreadAnnouncementsByNpub.set({});
  pactoAppInboxMessages.set([]);
  dmLastReadByNpub.set({});
  dmUnreadByNpub.set({});
  pactoAppInboxLastReadId.set('');
  dmThreadScrolledToBottom.set(false);
  messageCountByChat.set({});
  loadedOffsetByChat.set({});
  dmSyncStatus.set('idle');
  typingByChat.set({});
  dmSendError.set(null);

  /** Appearance theme is device-level (`pacto_theme`); keep it across logout / new account / import. */
  recentEmojisStore.set([]);
}
