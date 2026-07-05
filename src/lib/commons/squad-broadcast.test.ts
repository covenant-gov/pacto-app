import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { getLocalActiveCommonsBroadcast, publishCommonsBroadcast } from '../api/commons';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import {
  fetchActiveSquadCommonsBroadcast,
  formatBroadcastCooldownRemaining,
  publishSquadCommonsBroadcast,
} from './squad-broadcast';
import { getActiveCommonsBroadcastLocalState, recordCommonsBroadcastLocalState } from './local-broadcast-state';
import type { CommonsBroadcastDto } from './types';

vi.mock('../api/commons');
vi.mock('../utils/tauri-errors', () => ({
  getInvokeErrorMessage: vi.fn((e: unknown, fallback: string) =>
    typeof e === 'string' && e ? e : fallback
  ),
}));

const squadId = 'squad1';
const nowSecs = Math.floor(Date.now() / 1000);

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

function makeSquad(overrides: { visibility?: 'public' | 'private'; commonsTags?: string[]; kind?: 'squad' | 'squad-pair' } = {}) {
  return {
    id: squadId,
    name: 'Neo Builders',
    kind: 'squad' as const,
    visibility: 'public' as const,
    commonsTags: ['neo'],
    ...overrides,
  };
}

function makeDto(overrides: Partial<CommonsBroadcastDto> = {}): CommonsBroadcastDto {
  return {
    eventId: 'evt1',
    authorNpub: 'npub1author',
    subject: 'squad',
    subjectId: squadId,
    message: 'Hello Commons',
    durationHours: 24,
    expiresAt: nowSecs + 3600,
    tags: ['neo'],
    createdAt: 1,
    ...overrides,
  };
}

describe('formatBroadcastCooldownRemaining', () => {
  it('formats hours and minutes', () => {
    expect(formatBroadcastCooldownRemaining(7200, 0)).toBe('2h 0m');
  });

  it('formats minutes only when less than an hour remains', () => {
    expect(formatBroadcastCooldownRemaining(1000, 0)).toBe('16m');
  });

  it('returns "under 1m" when less than a minute remains', () => {
    expect(formatBroadcastCooldownRemaining(59, 0)).toBe('under 1m');
  });

  it('returns empty when expired', () => {
    expect(formatBroadcastCooldownRemaining(100, 200)).toBe('');
  });
});

describe('fetchActiveSquadCommonsBroadcast', () => {
  beforeEach(() => {
    stubLocalStorage();
    setCurrentNpubForPersistence('npub1test');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    setCurrentNpubForPersistence(null);
  });

  it('returns local cache hit without calling the backend', async () => {
    recordCommonsBroadcastLocalState(makeDto());

    const result = await fetchActiveSquadCommonsBroadcast(squadId);

    expect(result?.message).toBe('Hello Commons');
    expect(getLocalActiveCommonsBroadcast).not.toHaveBeenCalled();
  });

  it('records and returns a DTO from the backend', async () => {
    const dto = makeDto();
    vi.mocked(getLocalActiveCommonsBroadcast).mockResolvedValueOnce(dto);

    const result = await fetchActiveSquadCommonsBroadcast(squadId);

    expect(getLocalActiveCommonsBroadcast).toHaveBeenCalledWith('squad', squadId);
    expect(result?.eventId).toBe('evt1');
    expect(getActiveCommonsBroadcastLocalState('squad', squadId, nowSecs)).toEqual(
      expect.objectContaining({ subjectId: squadId, eventId: 'evt1' })
    );
  });

  it('returns null on backend error', async () => {
    vi.mocked(getLocalActiveCommonsBroadcast).mockRejectedValueOnce(new Error('db locked'));

    const result = await fetchActiveSquadCommonsBroadcast(squadId);

    expect(result).toBeNull();
  });
});

describe('publishSquadCommonsBroadcast', () => {
  beforeEach(() => {
    stubLocalStorage();
    setCurrentNpubForPersistence('npub1test');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    setCurrentNpubForPersistence(null);
  });

  it('rejects non-public squads', async () => {
    const result = await publishSquadCommonsBroadcast(makeSquad({ visibility: 'private' }), {
      message: 'hello',
      durationHours: 24,
    });

    expect(result).toEqual({ ok: false, error: 'Only public squads with tags can broadcast.' });
  });

  it('rejects an empty message', async () => {
    const result = await publishSquadCommonsBroadcast(makeSquad(), {
      message: '   ',
      durationHours: 24,
    });

    expect(result).toEqual({ ok: false, error: 'Message is required.' });
  });

  it('rejects while an active broadcast is still cached', async () => {
    recordCommonsBroadcastLocalState(makeDto());

    const result = await publishSquadCommonsBroadcast(makeSquad(), {
      message: 'hello',
      durationHours: 24,
    });

    expect(result).toEqual({ ok: false, error: 'A broadcast is still active for this squad.' });
  });

  it('skips publishing when skipIfActive is set', async () => {
    recordCommonsBroadcastLocalState(makeDto());

    const result = await publishSquadCommonsBroadcast(makeSquad(), {
      message: 'hello',
      durationHours: 24,
      skipIfActive: true,
    });

    expect(result).toEqual({ ok: true, skipped: true });
    expect(publishCommonsBroadcast).not.toHaveBeenCalled();
  });

  it('publishes a public squad broadcast with tags and squad metadata', async () => {
    vi.mocked(getLocalActiveCommonsBroadcast).mockResolvedValueOnce(null);
    const dto = makeDto({ tags: ['neo', 'new'] });
    vi.mocked(publishCommonsBroadcast).mockResolvedValueOnce(dto);

    const result = await publishSquadCommonsBroadcast(
      makeSquad({ commonsTags: ['neo'] }),
      {
        message: 'hello',
        durationHours: 72,
        extraTags: ['new'],
      }
    );

    expect(result).toEqual({ ok: true });
    expect(publishCommonsBroadcast).toHaveBeenCalledWith({
      subject: 'squad',
      message: 'hello',
      durationHours: 72,
      tags: ['neo', 'new'],
      squad: {
        id: squadId,
        name: 'Neo Builders',
        kind: 'squad',
        iconUrl: undefined,
      },
    });
    expect(getActiveCommonsBroadcastLocalState('squad', squadId, nowSecs)).toEqual(
      expect.objectContaining({ tags: ['neo', 'new'] })
    );
  });

  it('returns an error when publishing fails', async () => {
    vi.mocked(getLocalActiveCommonsBroadcast).mockResolvedValueOnce(null);
    vi.mocked(publishCommonsBroadcast).mockRejectedValueOnce('pub failed');

    const result = await publishSquadCommonsBroadcast(makeSquad(), {
      message: 'hello',
      durationHours: 24,
    });

    expect(result).toEqual({ ok: false, error: 'pub failed' });
    expect(getActiveCommonsBroadcastLocalState('squad', squadId, nowSecs)).toBeNull();
  });
});
