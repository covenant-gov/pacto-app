import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { persistenceKey } from '../../stores/persistence-context';
import {
  clearCommonsBroadcastLocalState,
  getActiveCommonsBroadcastLocalState,
  localStateFromDto,
  PACTO_COMMONS_BROADCASTS_PREFIX,
  recordCommonsBroadcastLocalState,
} from './local-broadcast-state';
import type { CommonsBroadcastDto } from './types';

vi.mock('../../stores/persistence-context', () => ({
  persistenceKey: vi.fn((prefix: string) => `${prefix}_testkey`),
}));

const localStorageStore = new Map<string, string>();

function stubLocalStorage(): void {
  localStorageStore.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => localStorageStore.get(k) ?? null,
    setItem: (k: string, v: string) => {
      localStorageStore.set(k, v);
    },
    removeItem: (k: string) => {
      localStorageStore.delete(k);
    },
    clear: () => {
      localStorageStore.clear();
    },
  });
}

function makeDto(overrides: Partial<CommonsBroadcastDto> = {}): CommonsBroadcastDto {
  return {
    eventId: 'evt1',
    authorNpub: 'npub1author',
    subject: 'user',
    subjectId: 'npub1author',
    message: 'Hello',
    durationHours: 24,
    expiresAt: 1_000_000,
    tags: ['neo'],
    createdAt: 1,
    ...overrides,
  };
}

function storedKey(): string {
  return `${PACTO_COMMONS_BROADCASTS_PREFIX}_testkey`;
}

describe('local-broadcast-state', () => {
  beforeEach(() => {
    stubLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('localStateFromDto mirrors the DTO fields', () => {
    const dto = makeDto({ audience: 'active_user' });
    expect(localStateFromDto(dto)).toEqual({
      subject: 'user',
      subjectId: 'npub1author',
      eventId: 'evt1',
      expiresAt: 1_000_000,
      durationHours: 24,
      tags: ['neo'],
      message: 'Hello',
      audience: 'active_user',
    });
  });

  it('recordCommonsBroadcastLocalState writes a keyed map to localStorage', () => {
    const dto = makeDto();
    recordCommonsBroadcastLocalState(dto);

    const raw = localStorage.getItem(storedKey());
    expect(raw).toBeTruthy();
    const map = JSON.parse(raw!);
    expect(map['user:npub1author']).toEqual(localStateFromDto(dto));
  });

  it('clearCommonsBroadcastLocalState removes the keyed entry', () => {
    const dto = makeDto();
    recordCommonsBroadcastLocalState(dto);
    clearCommonsBroadcastLocalState('user', 'npub1author');

    const map = JSON.parse(localStorage.getItem(storedKey()) ?? '{}');
    expect('user:npub1author' in map).toBe(false);
  });

  it('getActiveCommonsBroadcastLocalState returns the state when not expired', () => {
    const dto = makeDto({ expiresAt: 2_000_000 });
    recordCommonsBroadcastLocalState(dto);

    expect(getActiveCommonsBroadcastLocalState('user', 'npub1author', 1_000_000)).toEqual(
      localStateFromDto(dto)
    );
  });

  it('getActiveCommonsBroadcastLocalState returns null when expired', () => {
    const dto = makeDto({ expiresAt: 500_000 });
    recordCommonsBroadcastLocalState(dto);

    expect(getActiveCommonsBroadcastLocalState('user', 'npub1author', 1_000_000)).toBeNull();
  });

  it('getActiveCommonsBroadcastLocalState returns null when missing', () => {
    expect(getActiveCommonsBroadcastLocalState('user', 'npub1missing', 1)).toBeNull();
  });

  it('returns null and does not throw when localStorage is undefined', () => {
    vi.unstubAllGlobals();
    expect(getActiveCommonsBroadcastLocalState('user', 'npub1test', 1)).toBeNull();
    expect(() => recordCommonsBroadcastLocalState(makeDto())).not.toThrow();
    expect(() => clearCommonsBroadcastLocalState('user', 'npub1test')).not.toThrow();
  });

  it('returns null when the persistence key is empty', () => {
    vi.mocked(persistenceKey).mockReturnValueOnce(null);
    expect(getActiveCommonsBroadcastLocalState('user', 'npub1test', 1)).toBeNull();
  });

  it('ignores malformed stored JSON', () => {
    localStorage.setItem(storedKey(), 'not-json');
    expect(getActiveCommonsBroadcastLocalState('user', 'npub1test', 1)).toBeNull();
  });

  it('ignores non-object stored JSON', () => {
    localStorage.setItem(storedKey(), JSON.stringify(['array']));
    expect(getActiveCommonsBroadcastLocalState('user', 'npub1test', 1)).toBeNull();
  });

  it('does not throw when localStorage setItem fails', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
      clear: () => {},
    });
    expect(() => recordCommonsBroadcastLocalState(makeDto())).not.toThrow();
  });
});
