import { writable, derived } from 'svelte/store';
import { listen } from '@tauri-apps/api/event';
import { fetchNostrProfile, loadNostrProfile, type NostrProfile } from '../lib/api/nostr';
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
      if (!payload) return;

      if (payload.profiles) {
        const profilesMap: Record<string, NostrProfile> = {};
        for (const profile of payload.profiles) {
          profilesMap[profile.id] = profile;
        }
        profiles.set(profilesMap);
      }

      // Populate DM list from chats (DMs = id starts with npub1 or chat_type DirectMessage)
      if (payload.chats && Array.isArray(payload.chats)) {
        const profilesMap = payload.profiles
          ? Object.fromEntries(payload.profiles.map((p: NostrProfile) => [p.id, p]))
          : {};
        const dmEntries: DmEntry[] = payload.chats
          .filter(
            (c: { id: string; chat_type?: string }) =>
              typeof c.id === 'string' &&
              (c.id.startsWith('npub1') || c.chat_type === 'DirectMessage' || c.chat_type === 0)
          )
          .map((c: { id: string }) => {
            const profile = profilesMap[c.id];
            return {
              npub: c.id,
              name: profile?.display_name || profile?.name,
              avatar: profile?.avatar_cached || profile?.avatar,
            } as DmEntry;
          });
        dmList.set(dmEntries);
      }
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

