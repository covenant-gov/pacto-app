/**
 * Clear all account-specific frontend state (localStorage + in-memory stores).
 * Used on logout and when switching to a new account so the UI never shows
 * the previous account's squads, DMs, or related state.
 */

import {
  squads,
  pinnedDmNpubs,
  dmChatsByNpub,
  activeDmId,
  lastOpenedDmByTab,
  lastOpenedSquadId,
  lastOpenedChannelId,
  activeSquadId,
  activeChannelId,
  backendGroupMessages,
  groupSendError,
  pendingMlsWelcomes,
  ungroupedChannels,
  channelMessages,
  composingNewChat,
  activeTopNavTab,
  activeDmTab,
  activeView,
  backendDmMessages,
  messageCountByChat,
  loadedOffsetByChat,
  dmSyncStatus,
  typingByChat,
  dmSendError,
  setCurrentNpubForPersistence,
} from '../../stores/app';
import { theme } from '../../stores/theme';
import { recentEmojisStore } from '../../stores/emojis';

/** Legacy (non-scoped) keys to remove for backwards compatibility. */
const LEGACY_LOCAL_STORAGE_KEYS = [
  'pacto_squads',
  'pacto_last_dm_npub',
  'pacto_last_squad_id',
  'pacto_last_channel_id',
  'pacto_pinned_dm_npubs',
  'pacto_theme',
  'recentEmojis',
  'favoriteEmojis',
  '__pacto_init_finished_unlisten',
] as const;

/** Npub-scoped key prefixes (suffix is _<npub>). */
const SCOPED_KEY_PREFIXES = [
  'pacto_squads',
  'pacto_last_dm_npub',
  'pacto_last_squad_id',
  'pacto_last_channel_id',
  'pacto_pinned_dm_npubs',
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
  clearAccountLocalStorage(npub);

  squads.set([]);
  pinnedDmNpubs.set(new Set());
  dmChatsByNpub.set({});
  activeDmId.set(null);
  lastOpenedDmByTab.set({
    friends: null,
    requests: null,
    pending: null,
    pinned: null,
  });
  lastOpenedSquadId.set(null);
  lastOpenedChannelId.set(null);
  activeSquadId.set(null);
  activeChannelId.set(null);
  backendGroupMessages.set({});
  groupSendError.set(null);
  pendingMlsWelcomes.set([]);
  ungroupedChannels.set([]);
  channelMessages.set({});
  composingNewChat.set(false);
  activeTopNavTab.set('squads');
  activeDmTab.set('friends');
  activeView.set('hub');

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
