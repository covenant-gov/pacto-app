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
import type { PactoAppInboxEntry } from '../lib/pacto-app-inbox';
import { setCurrentNpubForPersistence } from './persistence-context';
import {
  PARENT_DASHBOARD_MODE_PREFIX,
  parseParentDashboardChannelMode,
  parentDashboardChannelMode,
  lastOpenedSquadId,
  lastOpenedChannelId,
  lastChannelBySquadId,
  lastHubChannelNameBySquadId,
  LAST_SQUAD_ID_PREFIX,
  LAST_CHANNEL_ID_PREFIX,
  LAST_CHANNEL_BY_SQUAD_PREFIX,
  LAST_HUB_CHANNEL_NAME_BY_SQUAD_PREFIX,
} from './navigation';
import {
  activeDmId,
  pinnedDmNpubs,
  pactoAppInboxMessages,
  PINNED_DM_NPUBS_PREFIX,
  PACTO_APP_INBOX_PREFIX,
  LAST_DM_NPUB_PREFIX,
} from './dm';
import { pactoAppInboxLastReadId, PACTO_APP_INBOX_LAST_READ_PREFIX } from './dm-unread';
import { hydrateSquadsFromDb } from '../lib/squad/squad-catalog';
import { normalizeHubChannelName } from './squads';

export {
  currentNpubForPersistence,
  setCurrentNpubForPersistence,
  persistenceKey,
} from './persistence-context';

/** Load account-specific state from localStorage for the given npub. Call after login/create/import/unlock. */
export function loadAccountState(npub: string): void {
  setCurrentNpubForPersistence(npub);
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
    const rawPactoInbox = localStorage.getItem(`${PACTO_APP_INBOX_PREFIX}_${npub}`);
    if (rawPactoInbox) {
      try {
        const parsed = JSON.parse(rawPactoInbox) as unknown;
        const list = Array.isArray(parsed) ? (parsed as PactoAppInboxEntry[]) : [];
        pactoAppInboxMessages.set(list.filter((m) => typeof m?.id === 'string' && typeof m.inviterNpub === 'string'));
      } catch {
        pactoAppInboxMessages.set([]);
      }
    } else {
      pactoAppInboxMessages.set([]);
    }
    const rawInboxLastRead = localStorage.getItem(`${PACTO_APP_INBOX_LAST_READ_PREFIX}_${npub}`);
    pactoAppInboxLastReadId.set(typeof rawInboxLastRead === 'string' ? rawInboxLastRead : '');
    const lastDm = localStorage.getItem(`${LAST_DM_NPUB_PREFIX}_${npub}`);
    if (lastDm) activeDmId.set(lastDm);
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
    void import('../lib/invites/accept-invite').then(({ reconcileStaleInviteDecisions }) => {
      reconcileStaleInviteDecisions();
    });
    const rawDashboardMode = localStorage.getItem(`${PARENT_DASHBOARD_MODE_PREFIX}_${npub}`);
    parentDashboardChannelMode.set(parseParentDashboardChannelMode(rawDashboardMode));
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
}
