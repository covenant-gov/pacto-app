import { writable, derived } from 'svelte/store';
import { listen } from '@tauri-apps/api/event';
import { fetchNostrProfile, loadNostrProfile, startNotifs, type NostrProfile } from '../lib/api/nostr';
import { dmLog } from '../lib/utils/dm-debug';
import { dmList, type DmEntry } from './app';

// Store all loaded profiles, keyed by npub
export const profiles = writable<Record<string, NostrProfile>>({});

// Track loading states for profiles
export const profileLoadingStates = writable<Record<string, boolean>>({});

// Listen for initial DB load (profiles + chats from Nostr relay sync)
(async () => {
  try {
    await listen('init_finished', (event: any) => {
      const payload = event.payload;
      dmLog('init_finished received', {
        profilesCount: payload?.profiles?.length ?? 0,
        chatsCount: payload?.chats?.length ?? 0,
      });
      if (!payload) return;

      if (payload.profiles) {
        const profilesMap: Record<string, NostrProfile> = {};
        for (const profile of payload.profiles) {
          profilesMap[profile.id] = profile;
        }
        profiles.set(profilesMap);
        dmLog('init_finished: profiles store set', Object.keys(profilesMap).length);
      }

      // Populate DM list from chats (DMs = id starts with npub1 or chat_type DirectMessage).
      // Sort by last activity (DM_FLOW §5.1): newest first.
      if (payload.chats && Array.isArray(payload.chats)) {
        const profilesMap = payload.profiles
          ? Object.fromEntries(payload.profiles.map((p: NostrProfile) => [p.id, p]))
          : {};
        type ChatPayload = {
          id: string;
          chat_type?: string;
          messages?: Array<{ at: number }>;
          created_at?: number;
        };
        const dmChats = (payload.chats as ChatPayload[]).filter(
          (c) =>
            typeof c.id === 'string' &&
            (c.id.startsWith('npub1') || c.chat_type === 'DirectMessage')
        );
        const dmEntries: DmEntry[] = dmChats.map((c) => {
          const profile = profilesMap[c.id];
          return {
            npub: c.id,
            name: profile?.display_name || profile?.name,
            avatar: profile?.avatar_cached || profile?.avatar,
          } as DmEntry;
        });
        // Last activity: last message .at, or created_at, or 0
        const lastAt = (c: ChatPayload) => {
          const ms = c.messages;
          if (ms && ms.length > 0) return ms[ms.length - 1].at ?? 0;
          return c.created_at ?? 0;
        };
        const orderByLastAt = new Map(dmChats.map((c) => [c.id, lastAt(c)]));
        dmEntries.sort((a, b) => (orderByLastAt.get(b.npub) ?? 0) - (orderByLastAt.get(a.npub) ?? 0));
        dmList.set(dmEntries);
        dmLog('init_finished: dmList set (sorted by last activity)', dmEntries.length, 'DMs');
      }

      // Start live subscriptions so relays push new DMs/group messages (per MESSAGING_OVERVIEW §9)
      dmLog('init_finished: calling startNotifs()');
      startNotifs().catch((e) => console.error('notifs failed:', e));
    });
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

