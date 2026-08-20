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
  squadNavOrder,
  showMembersPanel,
  squadDashboardChannelMode,
  myDashboardChannelMode,
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
  messageCountByChat,
  loadedOffsetByChat,
  dmSyncStatus,
  lastCatchUpSuccess,
  relayStatusByUrl,
  typingByChat,
  dmSendError,
  deletingDmNpubs,
} from '../../stores/dm';
import {
  dmThreadScrolledToBottom,
  resetUnreadStore,
} from '../../stores/unread';
import { resetCatchUpStore } from '../../stores/catch-up';
import {
  acceptedSquadInviteIds,
  declinedSquadInviteIds,
  acceptedChannelInviteMessageIds,
  declinedChannelInviteMessageIds,
  declinedWalletTxRequestMessageIds,
  acceptedWalletPeerInfoRequestMessageIds,
  declinedWalletPeerInfoRequestMessageIds,
  reciprocatedWalletPeerInfoRequestIds,
  declinedWelcomeGroupIds,
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
import { resetRelayedWalletTxKeys } from '../wallet/wallet-dm-transfer';
import { resetInviteAcceptState } from '../invites/accept-invite';
import { resetPendingAdmitState, PENDING_ADMIT_PREFIX, stopPendingAdmitDrain } from '../parent/pending-admit';
import {
  resetPendingSquadAdmissions,
  PENDING_SQUAD_ADMISSION_PREFIX,
} from '../../stores/pending-squad-admission';
import {
  resetPendingWelcomeFinalizations,
  PENDING_WELCOME_FINALIZATION_PREFIX,
} from '../../stores/pending-welcome-finalization';
import { joiningWelcomeGroupIds } from '../invites/pending-welcomes-store';
import {
  PENDING_APPROVED_JOINS_PREFIX,
  resetPendingApprovedJoins,
} from '../squad/join-request-finalize';
import { stopJoinInboxHolderSync } from '../squad/join-inbox-holder-sync';
import { resetCommonsPrefetchSession } from '../commons/commons-prefetch';
import { resetDashboardPrefetchSession } from '../app/dashboard-parent-prefetch';
import { INVITE_DECISION_SCOPED_PREFIXES } from '../../stores/invite-decisions';
import { recentEmojisStore } from '../../stores/emojis';
import { PACTO_COMMONS_BROADCASTS_PREFIX } from '../commons/local-broadcast-state';
import { PACTO_COMMONS_JOIN_REQUESTS_PREFIX, resetCommonsJoinRequestRevision } from '../commons/commons-join-request';
import { resetJoinRequestRespondInFlight } from '../squad/squad-join-mls';
import { resetWalletPeerInfoRequestInFlight } from '../wallet/wallet-peer-exchange';
import { resetSquadBotHolderActionInFlight } from '../squad/squad-bot';
import { resetSquadStateSyncRequestInFlight } from '../squad/squad-state-sync';
import { resetDeferredSquadRosterKeyParentIds } from '../squad/squad-roster-key-choice';
import {
  MUTINY_PROCESS_TX_PREFIX,
  resetMutinyProcessTxStore,
} from '../governance/mutiny-process-tx';
import { PACTO_SQUAD_JOIN_MUTED_PREFIX } from '../squad/squad-join-spam';
import { SQUAD_NETWORK_PREFIX } from '../squad/squad-network';
import { SQUAD_RPC_PREFIX } from '../squad/squad-rpc';
import { resetSquadJoinRequestStores } from '../../stores/squad-join-requests';
import { resetSquadHubAlertStores } from '../../stores/squad-hub-alerts';
import { resetGovActionPromptStores } from '../../stores/gov-action-prompts';
import { resetMlsGroupMembersStores } from '../../stores/mls-group-members';
import { resetMlsStoreResetState } from '../../stores/mls-reset';
import { resetStickerPacksStore } from '../../stores/stickers';
import { STARTUP_CHECK_PREFIX } from '../../stores/startup-check';
import { backupVerified } from '../../stores/backup-verification';
import {
  MLS_HISTORY_WELCOME_PREFIX,
  mlsHistoryWelcomeGroupIds,
} from '../../stores/mls-history-welcome';
import { clearPendingReactions } from '../messaging/reactions';
import { clearPendingAttachment } from '../messaging/attachment-composer';
import { clearLinkPreviewRequests } from '../messaging/link-preview';

/** Npub-scoped key prefixes (suffix is `_<npub>`). */
const SCOPED_KEY_PREFIXES = [
  'pacto_last_dm_npub',
  'pacto_last_squad_id',
  'pacto_last_channel_id',
  'pacto_last_channel_by_squad',
  'pacto_last_hub_channel_name_by_squad',
  'pacto_squad_nav_order',
  'pacto_parent_dashboard_mode',
  'pacto_pinned_dm_npubs',
  'pacto_wallet_summary_cache_v1',
  TREASURY_SAFES_CACHE_PREFIX,
  SQUAD_INFRA_CACHE_PREFIX,
  SQUAD_MEMBER_EVM_CACHE_PREFIX,
  GOVERNANCE_SNAPSHOT_CACHE_PREFIX,
  SETTINGS_CHAIN_CACHE_PREFIX,
  SAFE_STATE_DISK_CACHE_PREFIX,
  'pacto_wallet_ui_enabled_chains_v1',
  SQUAD_NETWORK_PREFIX,
  SQUAD_RPC_PREFIX,
  'pacto_wallet_preferred_network_v1',
  'pacto_wallet_rpc_prefs_v1',
  'pacto_wallet_tx_request_accepted',
  PACTO_COMMONS_BROADCASTS_PREFIX,
  PACTO_COMMONS_JOIN_REQUESTS_PREFIX,
  PACTO_SQUAD_JOIN_MUTED_PREFIX,
  'pacto_local_dev_defaults_applied_v1',
  ...INVITE_DECISION_SCOPED_PREFIXES,
  PENDING_SQUAD_ADMISSION_PREFIX,
  PENDING_WELCOME_FINALIZATION_PREFIX,
  PENDING_ADMIT_PREFIX,
  PENDING_APPROVED_JOINS_PREFIX,
  STARTUP_CHECK_PREFIX,
  'pacto_locale_v1',
  MLS_HISTORY_WELCOME_PREFIX,
  MUTINY_PROCESS_TX_PREFIX,
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
  stopJoinInboxHolderSync();
  stopPendingAdmitDrain();
  resetPendingAdmitState();
  resetPendingSquadAdmissions();
  resetPendingWelcomeFinalizations();
  joiningWelcomeGroupIds.set([]);
  resetPendingApprovedJoins();
  resetRelayedWalletTxKeys();
  resetDashboardPrefetchSession();
  resetCommonsPrefetchSession();
  resetCommonsJoinRequestRevision();
  resetJoinRequestRespondInFlight();
  resetWalletPeerInfoRequestInFlight();
  resetSquadBotHolderActionInFlight();
  resetSquadStateSyncRequestInFlight();
  resetDeferredSquadRosterKeyParentIds();
  resetMutinyProcessTxStore();
  resetSquadJoinRequestStores();
  resetSquadHubAlertStores();
  resetGovActionPromptStores();
  resetMlsGroupMembersStores();
  resetMlsStoreResetState();
  resetStickerPacksStore();
  clearPendingReactions();
  clearPendingAttachment();
  clearLinkPreviewRequests();
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
  deletingDmNpubs.set(new Set());
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
  squadNavOrder.set([]);
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
  reciprocatedWalletPeerInfoRequestIds.set([]);
  declinedWelcomeGroupIds.set([]);
  mlsHistoryWelcomeGroupIds.set([]);
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
  squadDashboardChannelMode.set('status');
  myDashboardChannelMode.set('status');
  showMembersPanel.set(false);
  walletSidebarOpen.set(false);
  walletSendPrefillFromRequest.set(null);

  backendDmMessages.set({});
  dmThreadAnnouncementsByNpub.set({});
  resetUnreadStore();
  resetCatchUpStore();
  dmThreadScrolledToBottom.set(false);
  messageCountByChat.set({});
  loadedOffsetByChat.set({});
  dmSyncStatus.set('idle');
  lastCatchUpSuccess.set(null);
  relayStatusByUrl.set({});
  typingByChat.set({});
  dmSendError.set(null);

  /** Appearance theme is device-level (`pacto_theme`); keep it across logout / new account / import. */
  recentEmojisStore.set([]);
  backupVerified.set(null);
}
