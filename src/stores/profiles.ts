import { writable, derived, get } from 'svelte/store';
import { listen } from '@tauri-apps/api/event';
import { fetchNostrProfile, loadNostrProfile, startNotifs, syncAllProfiles, type NostrProfile } from '../lib/api/nostr';
import { dmLog } from '../lib/utils/dm-debug';
import { getProfileDisplayName } from '../lib/utils/profile';
import { dmChatsByNpub, activeDmId, type DmChatState } from './app';
import { currentUser } from './auth';

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

    const unlisten = await listen('init_finished', (event: any) => {
      const payload = event.payload;
      dmLog('init_finished received', {
        profilesCount: payload?.profiles?.length ?? 0,
        chatsCount: payload?.chats?.length ?? 0,
      });
      // [Squad/Invite] debug: which chats (npubs) we got so we can see if inviter DM exists
      const chats = (payload?.chats && Array.isArray(payload.chats)) ? (payload.chats as { id?: string; chat_type?: string }[]) : [];
      const dmNpubs = chats.filter((c) => typeof c.id === 'string' && (c.id.startsWith('npub1') || c.chat_type === 'DirectMessage')).map((c) => c.id as string);
      console.log('[Squad/Invite] init_finished: chats total=', chats.length, 'dm npubs=', dmNpubs.length, 'ids (first 5)=', dmNpubs.slice(0, 5).map((id) => id.slice(0, 24) + '…'));
      if (!payload) return;

      if (payload.profiles) {
        const profilesMap: Record<string, NostrProfile> = {};
        for (const profile of payload.profiles) {
          profilesMap[profile.id] = profile;
        }
        profiles.set(profilesMap);
        dmLog('init_finished: profiles store set', Object.keys(profilesMap).length);
      }

      // Build DM map: Friends (2-way), Requests (they only), Pending (we only). Derived lists in app.ts.
      if (payload.chats && Array.isArray(payload.chats)) {
        const profilesMap = payload.profiles
          ? Object.fromEntries(payload.profiles.map((p: NostrProfile) => [p.id, p]))
          : {};
        type ChatPayload = {
          id: string;
          chat_type?: string;
          messages?: Array<{ at: number; mine?: boolean }>;
          created_at?: number;
        };
        const dmChats = (payload.chats as ChatPayload[]).filter(
          (c) =>
            typeof c.id === 'string' &&
            (c.id.startsWith('npub1') || c.chat_type === 'DirectMessage')
        );
        const dmFlags = (payload as { dm_flags?: Record<string, { has_from_me?: boolean; has_from_them?: boolean }> }).dm_flags;
        const map: Record<string, DmChatState> = {};
        for (const c of dmChats) {
          const ms = c.messages ?? [];
          // Prefer backend dm_flags (from full DB) so Friends vs Requests vs Pending is correct when init only loads 1 message per chat
          const flags = dmFlags?.[c.id];
          const hasFromMe = flags ? flags.has_from_me ?? false : ms.some((m: { mine?: boolean }) => m.mine === true);
          const hasFromThem = flags ? flags.has_from_them ?? false : ms.some((m: { mine?: boolean }) => m.mine === false);
          const lastAt = ms.length > 0 ? Math.max(...ms.map((m: { at?: number }) => m.at ?? 0)) : (c.created_at ?? 0);
          const profile = profilesMap[c.id];
          map[c.id] = {
            npub: c.id,
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
    await listen('profile_update', (event: any) => {
      const profile = event.payload as NostrProfile;
      if (profile?.id) {
        dmLog('profile_update', { npub: profile.id.slice(0, 20) + '…', name: profile.display_name || profile.name });
        profiles.update(p => ({ ...p, [profile.id]: profile }));
      }
    });
  } catch (error) {
    console.error('Failed to register profile_update event listener:', error);
  }
})();

// Listen for nickname changes
(async () => {
  try {
    await listen('profile_nick_changed', (event: any) => {
      const payload = event.payload as { profile_id?: string; value?: string };
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

/**
 * Load a Nostr profile from the backend cache (or trigger fetch if not cached)
 * @param npub - The npub (bech32 format) of the user
 * @returns Promise with the profile data
 */
export async function loadProfile(npub: string): Promise<NostrProfile> {
  // Check if already in our frontend cache
  let existing: NostrProfile | undefined;
  profiles.subscribe(p => { existing = p[npub]; })();
  
  if (existing) {
    return existing;
  }

  // Set loading state
  profileLoadingStates.update(states => ({ ...states, [npub]: true }));

  try {
    // Try to get from Rust cache first
    try {
      const profile = await fetchNostrProfile(npub);
      profiles.update(p => ({ ...p, [npub]: profile }));
      return profile;
    } catch (fetchError) {
      // Not in cache, trigger background fetch
      await loadNostrProfile(npub);
      
      // Wait a moment for the fetch to complete
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Try again
      const profile = await fetchNostrProfile(npub);
      profiles.update(p => ({ ...p, [npub]: profile }));
      return profile;
    }
  } catch (error) {
    console.error('Failed to load profile for', npub, ':', error);
    throw error;
  } finally {
    // Clear loading state
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

