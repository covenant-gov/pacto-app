import { hydrateWalletSummaryCacheFromDisk } from '../lib/wallet/wallet-summary-cache';
import { hydrateTreasurySafesCacheFromDisk } from '../lib/dashboard/treasury-safes-cache';
import { hydrateSquadInfraCacheFromDisk } from '../lib/dashboard/squad-infra-cache';
import { hydrateSquadMemberEvmCacheFromDisk } from '../lib/dashboard/squad-member-evm-cache';
import { hydrateGovernanceSnapshotCacheFromDisk } from '../lib/dashboard/governance-snapshot-cache';
import { hydrateSettingsChainCacheFromDisk } from '../lib/dashboard/settings-chain-cache';
import { hydrateSafeStateCacheFromDisk } from '../lib/dashboard/safe-state-disk-cache';
import { safeStateByTreasuryId } from './safe';
import { loadDeferredSquadRosterKeyParentIds } from '../lib/squad/squad-roster-key-choice';
import { getInviteDecisionLoadEntries } from './invite-decisions';
import { setCurrentNpubForPersistence, persistenceKey } from './persistence-context';
import { loadBackupVerified } from './backup-verification';
import {
  SQUAD_DASHBOARD_MODE_PREFIX,
  MY_DASHBOARD_MODE_PREFIX,
  parseSquadDashboardChannelMode,
  parseMyDashboardChannelMode,
  squadDashboardChannelMode,
  myDashboardChannelMode,
  lastOpenedSquadId,
  lastOpenedChannelId,
  lastChannelBySquadId,
  lastHubChannelNameBySquadId,
  squadNavOrder,
  LAST_SQUAD_ID_PREFIX,
  LAST_CHANNEL_ID_PREFIX,
  LAST_CHANNEL_BY_SQUAD_PREFIX,
  LAST_HUB_CHANNEL_NAME_BY_SQUAD_PREFIX,
  SQUAD_NAV_ORDER_PREFIX,
} from './navigation';
import { parseSquadNavOrder } from '../lib/squad/squad-nav-order';
import {
  activeDmId,
  pinnedDmNpubs,
  PINNED_DM_NPUBS_PREFIX,
  LAST_DM_NPUB_PREFIX,
  newChatDraftNpub,
  newChatDraftMessage,
  NEW_CHAT_DRAFT_NPUB_PREFIX,
  NEW_CHAT_DRAFT_MESSAGE_PREFIX,
} from './dm';
import { hydrateSquadsFromDb } from '../lib/squad/squad-catalog';
import { normalizeHubChannelName } from './squads';
import { hydrateLocale } from './locale';
import { loadStartupCheckPreference } from './startup-check';
import { loadMlsHistoryWelcome } from './mls-history-welcome';

export {
  currentNpubForPersistence,
  setCurrentNpubForPersistence,
  persistenceKey,
} from './persistence-context';

/** Load account-specific state from localStorage for the given npub. Call after login/create/import/unlock. */
export function loadAccountState(npub: string): void {
  setCurrentNpubForPersistence(npub);
  void loadBackupVerified();
  loadMlsHistoryWelcome(npub);
  // Nav order must load before hydrate reconciles / seeds the rail.
  if (typeof localStorage !== 'undefined') {
    try {
      const navKey = persistenceKey(SQUAD_NAV_ORDER_PREFIX);
      if (navKey) {
        squadNavOrder.set(parseSquadNavOrder(localStorage.getItem(navKey)));
      } else {
        squadNavOrder.set([]);
      }
    } catch {
      squadNavOrder.set([]);
    }
  }
  void hydrateSquadsFromDb().then(async () => {
    const { reconcileStaleInviteDecisions } = await import('../lib/invites/accept-invite');
    reconcileStaleInviteDecisions();
  });
  if (typeof localStorage === 'undefined') return;
  try {
    const pinnedKey = `${PINNED_DM_NPUBS_PREFIX}_${npub}`;
    const rawPinned = localStorage.getItem(pinnedKey);
    if (rawPinned) {
      const parsed = JSON.parse(rawPinned) as unknown;
      const arr = Array.isArray(parsed) ? (parsed as string[]).filter((x) => typeof x === 'string') : [];
      pinnedDmNpubs.set(new Set(arr));
    }
    const lastDm = localStorage.getItem(`${LAST_DM_NPUB_PREFIX}_${npub}`)?.trim();
    if (lastDm) activeDmId.set(lastDm);
    const draftNpub = localStorage.getItem(`${NEW_CHAT_DRAFT_NPUB_PREFIX}_${npub}`);
    newChatDraftNpub.set(draftNpub ?? '');
    const draftMessage = localStorage.getItem(`${NEW_CHAT_DRAFT_MESSAGE_PREFIX}_${npub}`);
    newChatDraftMessage.set(draftMessage ?? '');
    const lastSquad = localStorage.getItem(`${LAST_SQUAD_ID_PREFIX}_${npub}`);
    if (lastSquad) lastOpenedSquadId.set(lastSquad);
    const lastChannel = localStorage.getItem(`${LAST_CHANNEL_ID_PREFIX}_${npub}`);
    if (lastChannel) lastOpenedChannelId.set(lastChannel);
    const rawBySquad = localStorage.getItem(`${LAST_CHANNEL_BY_SQUAD_PREFIX}_${npub}`);
    if (rawBySquad) {
      try {
        const parsed = JSON.parse(rawBySquad) as unknown;
        lastChannelBySquadId.set(typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {});
      } catch {
        lastChannelBySquadId.set({});
      }
    }
    const rawHubBySquad = localStorage.getItem(`${LAST_HUB_CHANNEL_NAME_BY_SQUAD_PREFIX}_${npub}`);
    if (rawHubBySquad) {
      try {
        const parsed = JSON.parse(rawHubBySquad) as unknown;
        if (typeof parsed === 'object' && parsed !== null) {
          const normalized: Record<string, string> = {};
          for (const [sid, name] of Object.entries(parsed as Record<string, string>)) {
            if (typeof name !== 'string') continue;
            const hub = normalizeHubChannelName(name);
            if (hub) normalized[sid] = hub;
          }
          lastHubChannelNameBySquadId.set(normalized);
        } else {
          lastHubChannelNameBySquadId.set({});
        }
      } catch {
        lastHubChannelNameBySquadId.set({});
      }
    }

    for (const [key, setStore] of getInviteDecisionLoadEntries(npub)) {
      try {
        const raw = localStorage.getItem(key);
        const arr = raw ? (JSON.parse(raw) as unknown) : [];
        setStore(Array.isArray(arr) ? (arr as string[]).filter((x) => typeof x === 'string') : []);
      } catch {
        setStore([]);
      }
    }
    // reconcileStaleInviteDecisions already runs after hydrateSquadsFromDb() completes
    const rawSquadDashboardMode = localStorage.getItem(`${SQUAD_DASHBOARD_MODE_PREFIX}_${npub}`);
    squadDashboardChannelMode.set(parseSquadDashboardChannelMode(rawSquadDashboardMode));
    const rawMyDashboardMode = localStorage.getItem(`${MY_DASHBOARD_MODE_PREFIX}_${npub}`);
    myDashboardChannelMode.set(parseMyDashboardChannelMode(rawMyDashboardMode));
    loadStartupCheckPreference(npub);
  } catch {
    // ignore parse errors
  }
  loadDeferredSquadRosterKeyParentIds();
  hydrateWalletSummaryCacheFromDisk(npub);
  hydrateTreasurySafesCacheFromDisk(npub);
  hydrateSquadInfraCacheFromDisk(npub);
  hydrateSquadMemberEvmCacheFromDisk(npub);
  hydrateGovernanceSnapshotCacheFromDisk(npub);
  hydrateSettingsChainCacheFromDisk(npub);
  hydrateSafeStateCacheFromDisk(npub, (rows) => {
    safeStateByTreasuryId.update((cur) => ({ ...cur, ...rows }));
  });
  hydrateLocale(npub);
}
