import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  profiles,
  profileLoadingStates,
  loadProfile,
  getProfile,
  isProfileLoading,
} from './profiles';
import { dmChatsByNpub, blockedDmNpubs, activeDmId } from './dm';
import { currentUser } from './auth';
import { fetchNostrProfile, loadNostrProfile, type NostrProfile } from '../lib/api/nostr';
import { showToast } from './toast';
import { setCurrentNpubForPersistence } from './persistence-context';

const { handlers } = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown) => void>();
  return { handlers };
});

vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: (event: unknown) => void) => {
    handlers.set(event, handler);
    return Promise.resolve(() => {});
  },
}));

vi.mock('../lib/api/nostr', () => ({
  fetchNostrProfile: vi.fn(),
  loadNostrProfile: vi.fn(),
  startNotifs: vi.fn().mockResolvedValue(undefined),
  syncAllProfiles: vi.fn().mockResolvedValue(undefined),
  type: {},
}));

vi.mock('./toast', () => ({
  showToast: vi.fn(),
}));

describe('profiles', () => {
  const npub = 'npub1alice';
  const baseProfile: NostrProfile = {
    id: npub,
    name: 'Alice',
    display_name: 'Alice',
    avatar: 'https://example.com/avatar.png',
    banner: 'https://example.com/banner.png',
    about: 'About Alice',
    website: 'https://example.com',
    nip05: 'alice@example.com',
    lud06: '',
    lud16: '',
    nickname: '',
    last_read: '',
    status: { title: '', purpose: '', url: '' },
    last_updated: 0,
    typing_until: 0,
    mine: false,
    muted: false,
    bot: false,
    avatar_cached: '',
    banner_cached: '',
  };

  beforeEach(() => {
    vi.mocked(fetchNostrProfile).mockReset();
    vi.mocked(loadNostrProfile).mockReset();
    vi.mocked(showToast).mockReset();
  });

  afterEach(() => {
    profiles.set({});
    profileLoadingStates.set({});
    dmChatsByNpub.set({});
    blockedDmNpubs.set(new Set());
    activeDmId.set(null);
    currentUser.set(null);
    setCurrentNpubForPersistence(null);
    vi.clearAllMocks();
  });

  it('has expected initial values', () => {
    expect(get(profiles)).toEqual({});
    expect(get(profileLoadingStates)).toEqual({});
  });

  it('returns a profile from the cache via derived store', () => {
    profiles.set({ [npub]: baseProfile });
    const derived = getProfile(npub);
    expect(get(derived)).toEqual(baseProfile);
  });

  it('returns undefined when profile is not cached', () => {
    const derived = getProfile(npub);
    expect(get(derived)).toBeUndefined();
  });

  it('reports loading state via derived store', () => {
    profileLoadingStates.set({ [npub]: true });
    expect(get(isProfileLoading(npub))).toBe(true);
  });

  it('returns cached profile without fetching', async () => {
    profiles.set({ [npub]: baseProfile });
    const result = await loadProfile(npub);
    expect(result).toEqual(baseProfile);
    expect(fetchNostrProfile).not.toHaveBeenCalled();
  });

  it('fetches and caches a profile when not in cache', async () => {
    vi.mocked(fetchNostrProfile).mockResolvedValue(baseProfile);
    const result = await loadProfile(npub);
    expect(result).toEqual(baseProfile);
    expect(get(profiles)[npub]).toEqual(baseProfile);
    expect(fetchNostrProfile).toHaveBeenCalledWith(npub);
  });

  it('clears loading state after fetch', async () => {
    vi.mocked(fetchNostrProfile).mockResolvedValue(baseProfile);
    await loadProfile(npub);
    expect(get(profileLoadingStates)[npub]).toBe(false);
  });

  it('throws when fetch ultimately fails', async () => {
    vi.mocked(fetchNostrProfile).mockRejectedValue(new Error('not found'));
    await expect(loadProfile(npub)).rejects.toThrow('not found');
  });

  describe('event listeners', () => {
    it('init_finished sets profiles and dm state', () => {
      const initHandler = handlers.get('init_finished');
      expect(initHandler).toBeDefined();
      initHandler?.({
        payload: {
          profiles: [baseProfile],
          chats: [{ id: npub, chat_type: 'DirectMessage', messages: [{ at: 1, mine: false }] }],
        },
      });
      expect(get(profiles)[npub]).toEqual(baseProfile);
      expect(get(dmChatsByNpub)[npub]).toBeDefined();
    });

    it('profile_update updates the profile and blocked list', () => {
      profiles.set({ [npub]: baseProfile });
      const updateHandler = handlers.get('profile_update');
      expect(updateHandler).toBeDefined();
      updateHandler?.({
        payload: { id: npub, display_name: 'Alice Updated', blocked: true },
      });
      expect(get(profiles)[npub]?.display_name).toBe('Alice Updated');
      expect(get(blockedDmNpubs).has(npub)).toBe(true);
    });

    it('profile_nick_changed updates the profile and dm chat name', () => {
      profiles.set({ [npub]: baseProfile });
      dmChatsByNpub.set({ [npub]: { npub, name: 'Alice', hasFromMe: true, hasFromThem: true, lastAt: 1 } });
      const nickHandler = handlers.get('profile_nick_changed');
      expect(nickHandler).toBeDefined();
      nickHandler?.({ payload: { profile_id: npub, value: 'Al' } });
      expect(get(profiles)[npub]?.nickname).toBe('Al');
      expect(get(dmChatsByNpub)[npub]?.name).toBe('Al');
    });

    it('kind0_profile_published shows a toast', () => {
      const publishedHandler = handlers.get('kind0_profile_published');
      expect(publishedHandler).toBeDefined();
      publishedHandler?.({ payload: {} });
      expect(showToast).toHaveBeenCalledWith('Profile metadata (Kind 0) published to the network.');
    });

    it('kind0_profile_publish_failed shows a toast with the error', () => {
      const failedHandler = handlers.get('kind0_profile_publish_failed');
      expect(failedHandler).toBeDefined();
      failedHandler?.({ payload: 'publish failed' });
      expect(showToast).toHaveBeenCalledWith('publish failed');
    });
  });
});
