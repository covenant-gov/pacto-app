import { describe, it, expect, vi, beforeEach } from 'vitest';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getProfileDisplayName, getProfileAvatarSrc, getProfileBannerSrc } from './profile';
import type { NostrProfile } from '../api/nostr';

vi.mock('@tauri-apps/api/core');

const mockedConvertFileSrc = vi.mocked(convertFileSrc);

beforeEach(() => {
  mockedConvertFileSrc.mockReset();
  mockedConvertFileSrc.mockImplementation((path: string) => `asset://${path}`);
  vi.stubGlobal('window', {
    __TAURI__: undefined,
  });
});

function makeProfile(overrides?: Partial<NostrProfile>): NostrProfile {
  return {
    id: 'npub1abcdef',
    name: 'Name',
    display_name: 'Display',
    nickname: '',
    avatar: '',
    banner: '',
    avatar_cached: '',
    banner_cached: '',
    last_read: '',
    status: { title: '', purpose: '', url: '' },
    last_updated: 0,
    typing_until: 0,
    mine: false,
    lud06: '',
    lud16: '',
    about: '',
    website: '',
    nip05: '',
    muted: false,
    bot: false,
    ...overrides,
  };
}

describe('getProfileDisplayName', () => {
  it('returns Unknown for null/undefined', () => {
    expect(getProfileDisplayName(null)).toBe('Unknown');
    expect(getProfileDisplayName(undefined)).toBe('Unknown');
  });

  it('prefers nickname, then name, then display_name', () => {
    expect(getProfileDisplayName(makeProfile({ nickname: 'Nick' }))).toBe('Nick');
    expect(getProfileDisplayName(makeProfile({ name: 'Name', display_name: 'Display' }))).toBe('Name');
    expect(getProfileDisplayName(makeProfile({ display_name: 'Display', name: '' }))).toBe('Display');
  });

  it('falls back to short id then Unknown', () => {
    expect(getProfileDisplayName(makeProfile({ id: 'npub1xyz', name: '', display_name: '' }))).toBe('npub1xyz');
    expect(getProfileDisplayName(makeProfile({ id: '', name: '', display_name: '' }))).toBe('Unknown');
  });

  it('trims whitespace', () => {
    expect(getProfileDisplayName(makeProfile({ nickname: '  Nick  ' }))).toBe('Nick');
  });
});

describe('getProfileAvatarSrc', () => {
  it('returns null for null/undefined profile', () => {
    expect(getProfileAvatarSrc(null)).toBeNull();
    expect(getProfileAvatarSrc(undefined)).toBeNull();
  });

  it('prefers remote https avatar', () => {
    const profile = makeProfile({
      avatar: 'https://example.com/avatar.png',
      avatar_cached: '/cached/avatar.png',
    });
    expect(getProfileAvatarSrc(profile)).toBe('https://example.com/avatar.png');
  });

  it('ignores non-http avatar and uses cached path in Tauri', () => {
    vi.stubGlobal('window', { __TAURI__: {} });
    const profile = makeProfile({
      avatar: 'ftp://bad',
      avatar_cached: '/cached/avatar.png',
    });
    expect(getProfileAvatarSrc(profile)).toBe('asset:///cached/avatar.png');
    expect(mockedConvertFileSrc).toHaveBeenCalledWith('/cached/avatar.png');
  });

  it('returns null when avatar is a file path and not in Tauri', () => {
    const profile = makeProfile({ avatar: '/path/to/avatar.png' });
    expect(getProfileAvatarSrc(profile)).toBeNull();
  });
});

describe('getProfileBannerSrc', () => {
  it('returns null for null/undefined profile', () => {
    expect(getProfileBannerSrc(null)).toBeNull();
    expect(getProfileBannerSrc(undefined)).toBeNull();
  });

  it('prefers remote https banner', () => {
    const profile = makeProfile({
      banner: 'https://example.com/banner.png',
      banner_cached: '/cached/banner.png',
    });
    expect(getProfileBannerSrc(profile)).toBe('https://example.com/banner.png');
  });

  it('uses cached banner in Tauri when no remote http banner', () => {
    vi.stubGlobal('window', { __TAURI__: {} });
    const profile = makeProfile({ banner_cached: '/cached/banner.png' });
    expect(getProfileBannerSrc(profile)).toBe('asset:///cached/banner.png');
    expect(mockedConvertFileSrc).toHaveBeenCalledWith('/cached/banner.png');
  });
});
