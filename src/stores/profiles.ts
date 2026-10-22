import { writable, derived, get } from 'svelte/store';
import { listen } from '../lib/api';
import { fetchNostrProfile, loadNostrProfile, startNotifs, syncAllProfiles } from '../lib/api/nostr';
import type { NostrProfile } from '../lib/api/nostr';
export type { NostrProfile };
import { dmLog } from '../lib/utils/dm-debug';
import { getProfileDisplayName, profileNeedsRelayHydration } from '../lib/utils/profile';
import { activeDmId, dmChatsByNpub, blockedDmNpubs, dmSyncStatus, lastCatchUpSuccess, type DmChatState } from './dm';
import { hydrateUnreadCounts } from './unread';
import { hydrateCatchUpCount } from './catch-up';
import { currentUser } from './auth-session';

type InitFinishedPayload = {
  profiles?: NostrProfile[];
  chats?: Array<{
    id?: string;
    chat_type?: string;
    messages?: Array<{ at: number; mine?: boolean }>;
    last_read?: string;
    created_at?: number;
  }>;
  dm_flags?: Record<string, { has_from_me?: boolean; has_from_them?: boolean }>;
};

const LAST_DM_NPUB_PREFIX = 'pacto_last_dm_npub';
let lastOpenChatRestored = false;

// Store all loaded profiles, keyed by npub
export const profiles = writable<Record<string, NostrProfile>>({});

// Track loading states for profiles
export const profileLoadingStates = writable<Record<string, boolean>>({});

const INIT_LISTENER_KEY = '__pacto_init_finished_unlisten';

// Listen for initial DB load (profiles + chats from Nostr relay sync). Single registration so HMR doesn't stack listeners.
(async () => {
  try {
    const prev = typeof window !== 'undefined' ? (window as unknown as { [key: string]: (() => void) | undefined })[INIT_LISTENER_KEY] : undefined;
    if (prev) prev();

    const unlisten = await listen<InitFinishedPayload>('init_finished', (event) => {
      const payload = event.payload;
      dmLog('init_finished received', {
        profilesCount: payload?.profiles?.length ?? 0,
        chatsCount: payload?.chats?.length ?? 0,
      });
      // [Squad/Invite] debug: which chats (npubs) we got so we can see if inviter DM exists
      const chats = (payload?.chats && Array.isArray(payload.chats)) ? payload.chats : [];
      const dmNpubs = chats.filter((c) => typeof c.id === 'string' && (c.id.startsWith('npub1') || c.chat_type === 'DirectMessage')).map((c) => c.id as string);
      console.log('[Squad/Invite] init_finished: chats total=', chats.length, 'dm npubs=', dmNpubs.length, 'ids (first 5)=', dmNpubs.slice(0, 5).map((id) => id.slice(0, 24) + '…'));
      if (!payload) return;

      // Backend-owned per-chat unread map (R14): hydrate once chats are known to
      // exist, independent of whether this payload happens to include a chats array.
      hydrateUnreadCounts().catch((e) => console.error('hydrateUnreadCounts failed:', e));

      // Catch up tab badge count (R14, same authority): lightweight hydrate
      // now, full entry list loads lazily when Catch up is opened.
      hydrateCatchUpCount().catch((e) => console.error('hydrateCatchUpCount failed:', e));

      if (payload.profiles) {
        const profilesMap = mergeInitProfiles(get(profiles), payload.profiles);
        profiles.set(profilesMap);
        blockedDmNpubs.set(
          new Set(
            Object.entries(profilesMap)
              .filter(([, p]) => p.blocked)
              .map(([id]) => id)
          )
        );
        dmLog('init_finished: profiles store set', Object.keys(profilesMap).length);
      }

      // Build DM map: Friends (2-way), Requests (they only), Pending (we only). Derived lists in app.ts.
      if (payload.chats && Array.isArray(payload.chats)) {
        const profilesMap = get(profiles);
      const dmChats = payload.chats.filter(
          (c) =>
            typeof c.id === 'string' &&
            (c.id.startsWith('npub1') || c.chat_type === 'DirectMessage')
        );
        const dmFlags = payload.dm_flags;
        const map: Record<string, DmChatState> = {};
        for (const c of dmChats) {
          const id = c.id;
          if (typeof id !== 'string') continue;
          const ms = c.messages ?? [];
          // Prefer backend dm_flags (from full DB) so Friends vs Requests vs Pending is correct when init only loads 1 message per chat
          const flags = dmFlags?.[id];
          const hasFromMe = flags ? flags.has_from_me ?? false : ms.some((m: { mine?: boolean }) => m.mine === true);
          const hasFromThem = flags ? flags.has_from_them ?? false : ms.some((m: { mine?: boolean }) => m.mine === false);
          const lastAt = ms.length > 0 ? Math.max(...ms.map((m: { at?: number }) => m.at ?? 0)) : (c.created_at ?? 0);
          const profile = profilesMap[id];
          map[id] = {
            npub: id,
            name: getProfileDisplayName(profile ?? undefined),
            avatar: profile?.avatar_cached || profile?.avatar,
            hasFromMe,
            hasFromThem,
            lastAt,
          };
        }
        dmChatsByNpub.set(map);
        dmLog('init_finished: dmChatsByNpub set', Object.keys(map).length, 'DMs (Friends/Requests/Pending)');
        console.log('[Squad/Invite] init_finished: dmChatsByNpub keys=', Object.keys(map).map((k) => k.slice(0, 20) + '…'));

        // Restore last open chat if still in map (npub-scoped key, or legacy)
        if (!lastOpenChatRestored && typeof localStorage !== 'undefined') {
          lastOpenChatRestored = true;
          const npub = get(currentUser)?.npub;
          const key = npub ? `${LAST_DM_NPUB_PREFIX}_${npub}` : LAST_DM_NPUB_PREFIX;
          const lastNpub = localStorage.getItem(key)?.trim();
          if (lastNpub && lastNpub in map) {
            dmLog('init_finished: restore last open chat', lastNpub.slice(0, 20) + '…');
            activeDmId.set(lastNpub);
          }
        }
      }

      // Queue all contacts for profile sync so names/PFPs fill in over time
      syncAllProfiles().catch((e) => console.error('sync_all_profiles failed:', e));

      // Start live subscriptions so relays push new DMs/group messages
      dmLog('init_finished: calling startNotifs()');
      startNotifs().catch((e) => console.error('notifs failed:', e));

      // Clear initial sync banner (login or page load had set syncing; backend may not emit sync_finished for init-only).
      // Set lastCatchUpSuccess here too so the behind/stalled predicate doesn't drift stale
      // off a completion that never went through the sync_finished handler.
      dmSyncStatus.set('finished');
      lastCatchUpSuccess.set(Date.now());
      setTimeout(() => dmSyncStatus.set('idle'), 2500);
      void import('../lib/squad/squad-catalog-recover').then(({ enrichRecoveredSquadNamesFromInvites }) => {
        void enrichRecoveredSquadNamesFromInvites();
      });
    });

    if (typeof window !== 'undefined') {
      (window as unknown as { [key: string]: () => void })[INIT_LISTENER_KEY] = unlisten;
    }
  } catch (error) {
    console.error('Failed to register init_finished listener:', error);
  }
})();

// Listen for profile updates from backend
(async () => {
  try {
    await listen<NostrProfile>('profile_update', (event) => {
      const profile = event.payload;
      if (profile?.id) {
        dmLog('profile_update', { npub: profile.id.slice(0, 20) + '…', name: profile.display_name || profile.name });
        profiles.update((p) => {
          const next = { ...p, [profile.id]: { ...p[profile.id], ...profile } };
          blockedDmNpubs.set(
            new Set(Object.entries(next).filter(([, x]) => x.blocked).map(([k]) => k))
          );
          return next;
        });
      }
    });
  } catch (error) {
    console.error('Failed to register profile_update event listener:', error);
  }
})();

// Listen for nickname changes
(async () => {
  try {
    await listen<{ profile_id?: string; value?: string }>('profile_nick_changed', (event) => {
      const payload = event.payload;
      const { profile_id, value } = payload;
      if (!profile_id || value === undefined) return;
      dmLog('profile_nick_changed', { npub: profile_id.slice(0, 20) + '…', nickname: value });
      profiles.update((p) => {
        const existing = p[profile_id];
        if (!existing) return p;
        return { ...p, [profile_id]: { ...existing, nickname: value } };
      });
      // Keep DM map display name in sync (sidebar uses derived dmList/requestsList/pendingList)
      dmChatsByNpub.update((m) => {
        const cur = m[profile_id];
        if (!cur) return m;
        return { ...m, [profile_id]: { ...cur, name: value } };
      });
    });
  } catch (error) {
    console.error('Failed to register profile_nick_changed event listener:', error);
  }
})();

/** Incoming Kind 0 wins; an empty init row must not replace a hydrated profile. */
export function mergeInitProfiles(
  current: Record<string, NostrProfile>,
  incoming: NostrProfile[]
): Record<string, NostrProfile> {
  const next = { ...current };
  for (const profile of incoming) {
    const existing = next[profile.id];
    if (!profileNeedsRelayHydration(profile)) {
      next[profile.id] = profile;
    } else if (!existing || profileNeedsRelayHydration(existing)) {
      next[profile.id] = profile;
    }
  }
  return next;
}

const HYDRATE_RETRY_MS = [0, 1000, 2000];

/**
 * Load a Nostr profile from the backend cache (or trigger fetch if not cached).
 * Empty shells (e.g. own profile after reinstall) still trigger Kind 0 hydrate.
 */
export async function loadProfile(npub: string): Promise<NostrProfile> {
  let existing: NostrProfile | undefined;
  profiles.subscribe(p => { existing = p[npub]; })();

  if (existing && !profileNeedsRelayHydration(existing)) {
    return existing;
  }

  profileLoadingStates.update(states => ({ ...states, [npub]: true }));

  try {
    try {
      const profile = await fetchNostrProfile(npub);
      if (!profileNeedsRelayHydration(profile)) {
        profiles.update(p => ({ ...p, [npub]: profile }));
        return profile;
      }
    } catch {
      // Not in Rust cache yet
    }

    let profile: NostrProfile | undefined;
    for (let attempt = 0; attempt < HYDRATE_RETRY_MS.length; attempt++) {
      const delay = HYDRATE_RETRY_MS[attempt];
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      await loadNostrProfile(npub);
      profile = await fetchNostrProfile(npub);
      profiles.update(p => ({ ...p, [npub]: profile! }));
      if (!profileNeedsRelayHydration(profile)) {
        return profile;
      }
    }
    if (!profile) {
      throw new Error('profile missing');
    }
    return profile;
  } catch (error) {
    console.error('Failed to load profile for', npub, ':', error);
    throw error;
  } finally {
    profileLoadingStates.update(states => ({ ...states, [npub]: false }));
  }
}

/**
 * Get a profile from the cache (doesn't fetch if missing)
 * @param npub - The npub to look up
 * @returns Derived store with the profile or undefined
 */
export function getProfile(npub: string) {
  return derived(profiles, $profiles => $profiles[npub]);
}

/**
 * Check if a profile is currently loading
 * @param npub - The npub to check
 * @returns Derived store with loading state
 */
export function isProfileLoading(npub: string) {
  return derived(profileLoadingStates, $states => $states[npub] || false);
}

