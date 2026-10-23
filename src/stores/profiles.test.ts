import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  profiles,
  profileLoadingStates,
  loadProfile,
  startProfileLoad,
  getProfile,
  isProfileLoading,
  mergeInitProfiles,
} from './profiles';
import { dmChatsByNpub, blockedDmNpubs, activeDmId, lastCatchUpSuccess } from './dm';
import { currentUser } from './auth-session';
import { fetchNostrProfile, loadNostrProfile, type NostrProfile } from '../lib/api/nostr';
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

vi.mock('./unread', () => ({
  hydrateUnreadCounts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/squad/squad-catalog-recover', () => ({
  enrichRecoveredSquadNamesFromInvites: vi.fn(async () => {}),
  recoverMissingSquadCatalog: vi.fn(async () => 0),
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
    bot: false,
    avatar_cached: '',
    banner_cached: '',
  };

  beforeEach(() => {
    vi.mocked(fetchNostrProfile).mockReset();
    vi.mocked(loadNostrProfile).mockReset();
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

  it('returns cached profile without fetching when metadata is present', async () => {
    profiles.set({ [npub]: baseProfile });
    const result = await loadProfile(npub);
    expect(result).toEqual(baseProfile);
    expect(fetchNostrProfile).not.toHaveBeenCalled();
    expect(loadNostrProfile).not.toHaveBeenCalled();
  });

  it('hydrates from relays when cached profile is an empty shell', async () => {
    const emptyShell: NostrProfile = {
      ...baseProfile,
      name: '',
      display_name: '',
      avatar: '',
      mine: true,
    };
    profiles.set({ [npub]: emptyShell });
    vi.mocked(fetchNostrProfile)
      .mockResolvedValueOnce(emptyShell)
      .mockResolvedValueOnce(baseProfile);
    vi.mocked(loadNostrProfile).mockResolvedValue(true);

    const result = await loadProfile(npub);

    expect(loadNostrProfile).toHaveBeenCalledTimes(1);
    expect(loadNostrProfile).toHaveBeenCalledWith(npub);
    expect(result).toEqual(baseProfile);
    expect(get(profiles)[npub]).toEqual(baseProfile);
  });

  it('retries Kind 0 fetch when the first re-read is still empty', async () => {
    vi.useFakeTimers();
    const emptyShell: NostrProfile = {
      ...baseProfile,
      name: '',
      display_name: '',
      avatar: '',
      mine: true,
    };
    profiles.set({ [npub]: emptyShell });
    vi.mocked(fetchNostrProfile)
      .mockResolvedValueOnce(emptyShell)
      .mockResolvedValueOnce(emptyShell)
      .mockResolvedValueOnce(baseProfile);
    vi.mocked(loadNostrProfile).mockResolvedValue(true);

    const pending = loadProfile(npub);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await pending;

    expect(loadNostrProfile).toHaveBeenCalledTimes(2);
    expect(result).toEqual(baseProfile);
    vi.useRealTimers();
  });

  it('signals requested once the relay Kind 0 request is sent, before it answers', async () => {
    const emptyShell: NostrProfile = { ...baseProfile, name: '', display_name: '', avatar: '' };
    const relayLoad = Promise.withResolvers<boolean>();
    vi.mocked(fetchNostrProfile)
      .mockResolvedValueOnce(emptyShell)
      .mockResolvedValueOnce(baseProfile);
    vi.mocked(loadNostrProfile).mockReturnValue(relayLoad.promise);

    const load = startProfileLoad(npub);
    expect(loadNostrProfile).not.toHaveBeenCalled();
    await load.requested;
    expect(loadNostrProfile).toHaveBeenCalledWith(npub);

    relayLoad.resolve(true);
    await expect(load.profile).resolves.toEqual(baseProfile);
  });

  it('signals requested without a relay request when the cache already has the profile', async () => {
    vi.mocked(fetchNostrProfile).mockResolvedValue(baseProfile);

    const load = startProfileLoad(npub);
    await load.requested;

    await expect(load.profile).resolves.toEqual(baseProfile);
    expect(loadNostrProfile).not.toHaveBeenCalled();
  });

  it('shares one in-flight restore across concurrent callers and tracks loading', async () => {
    const emptyShell: NostrProfile = { ...baseProfile, name: '', display_name: '', avatar: '' };
    const relayLoad = Promise.withResolvers<boolean>();
    vi.mocked(fetchNostrProfile)
      .mockResolvedValueOnce(emptyShell)
      .mockResolvedValueOnce(baseProfile);
    vi.mocked(loadNostrProfile).mockReturnValue(relayLoad.promise);

    const first = loadProfile(npub);
    const second = loadProfile(npub);
    expect(second).toBe(first);
    await vi.waitFor(() => expect(loadNostrProfile).toHaveBeenCalledTimes(1));
    expect(get(profileLoadingStates)[npub]).toBe(true);

    relayLoad.resolve(true);
    await expect(first).resolves.toEqual(baseProfile);
    expect(loadNostrProfile).toHaveBeenCalledTimes(1);
    expect(get(profileLoadingStates)[npub]).toBe(false);
    expect(get(profiles)[npub]).toEqual(baseProfile);
  });

  it('settles on the empty profile without throwing when relays have no Kind 0', async () => {
    vi.useFakeTimers();
    const emptyShell: NostrProfile = { ...baseProfile, name: '', display_name: '', avatar: '', banner: '', about: '' };
    vi.mocked(fetchNostrProfile).mockResolvedValue(emptyShell);
    vi.mocked(loadNostrProfile).mockResolvedValue(true);

    const pending = loadProfile(npub);
    await vi.advanceTimersByTimeAsync(3000);

    await expect(pending).resolves.toEqual(emptyShell);
    expect(loadNostrProfile).toHaveBeenCalledTimes(3);
    expect(get(profileLoadingStates)[npub]).toBe(false);
    vi.useRealTimers();
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
    vi.mocked(loadNostrProfile).mockResolvedValue(false);
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
      // init_finished is a fallback completion path (backend may never emit sync_finished
      // for an init-only run); it must carry the same watermark update as the real handler
      // so behind/stalled doesn't drift stale off a completion it never observed.
      expect(get(lastCatchUpSuccess)).not.toBeNull();
    });

    it('init_finished keeps a hydrated profile when the payload shell is empty', () => {
      const hydrated = { ...baseProfile, name: 'Iso', display_name: 'Iso', avatar: 'https://example.com/iso.png' };
      profiles.set({ [npub]: hydrated });
      const initHandler = handlers.get('init_finished');
      initHandler?.({
        payload: {
          profiles: [{ ...hydrated, name: '', display_name: '', avatar: '' }],
        },
      });
      expect(get(profiles)[npub]?.name).toBe('Iso');
      expect(get(profiles)[npub]?.avatar).toBe('https://example.com/iso.png');
    });

    it('mergeInitProfiles prefers incoming metadata for the same id', () => {
      const merged = mergeInitProfiles(
        {
          [npub]: { ...baseProfile, name: 'Iso', avatar: 'https://example.com/iso.png' },
        },
        [{ ...baseProfile, name: '', display_name: '', avatar: '' }]
      );
      expect(merged[npub]?.name).toBe('Iso');
    });

    it('mergeInitProfiles drops other-account rows on init', () => {
      const other = 'npub1bob';
      const incomingId = 'npub1iso';
      const merged = mergeInitProfiles(
        {
          [npub]: { ...baseProfile, name: 'Alice', blocked: true },
          [other]: { ...baseProfile, id: other, name: 'Bob', blocked: true },
        },
        [{ ...baseProfile, id: incomingId, name: '', display_name: '', avatar: '', blocked: false }]
      );
      expect(Object.keys(merged)).toEqual([incomingId]);
      expect(merged[incomingId]?.name).toBe('');
      expect(merged[npub]).toBeUndefined();
      expect(merged[other]).toBeUndefined();
    });

    it('init_finished rebuilds blocked from incoming ids only', () => {
      const previous = 'npub1alice';
      const incoming = 'npub1iso';
      profiles.set({
        [previous]: { ...baseProfile, id: previous, name: 'Alice', blocked: true },
      });
      const initHandler = handlers.get('init_finished');
      initHandler?.({
        payload: {
          profiles: [{ ...baseProfile, id: incoming, name: '', display_name: '', avatar: '', blocked: false }],
        },
      });
      expect(get(profiles)[previous]).toBeUndefined();
      expect(get(profiles)[incoming]?.id).toBe(incoming);
      expect(get(blockedDmNpubs).has(previous)).toBe(false);
      expect(get(blockedDmNpubs).size).toBe(0);
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
  });
});
