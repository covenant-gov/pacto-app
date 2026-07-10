import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { publishCommonsBroadcast } from '../api/commons';
import { showToast } from '../../stores/toast';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import {
  defaultPublicSquadBroadcastMessage,
  isPublicSquadForCommonsBroadcast,
  publishPublicSquadCreateBroadcast,
  schedulePublicSquadCreateBroadcast,
} from './squad-create-broadcast';
import { COMMONS_NEW_TAG } from './tags';
import { getActiveCommonsBroadcastLocalState } from './local-broadcast-state';
import type { CommonsBroadcastDto } from './types';
import type { PublicSquadBroadcastTarget } from './squad-create-broadcast';

vi.mock('../api/commons');
vi.mock('../utils/tauri-errors', () => ({
  getInvokeErrorMessage: vi.fn((e: unknown, fallback: string) =>
    typeof e === 'string' && e ? e : fallback
  ),
}));
vi.mock('../../stores/toast', () => ({
  showToast: vi.fn(),
}));
vi.mock('../squad/squad-bot', () => ({
  ensureSquadBot: vi.fn().mockResolvedValue({
    squadId: 'squad1',
    botNpub: 'npub1bot',
    holders: [],
    keyEpoch: 0,
    updatedAt: 0,
    hasLocalSecret: true,
    iAmHolder: true,
  }),
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

function makeSquad(overrides: Partial<PublicSquadBroadcastTarget> = {}): PublicSquadBroadcastTarget {
  return {
    id: squadId,
    name: 'Neo Builders',
    kind: 'squad',
    visibility: 'public',
    commonsTags: ['neo', 'builders', 'community'],
    ...overrides,
  };
}

function makeDto(overrides: Partial<CommonsBroadcastDto> = {}): CommonsBroadcastDto {
  return {
    eventId: 'evt1',
    authorNpub: 'npub1author',
    subject: 'squad',
    subjectId: squadId,
    message: 'New squad: Neo Builders',
    durationHours: 72,
    expiresAt: nowSecs + 3600 * 72,
    tags: ['neo', 'builders', 'community', COMMONS_NEW_TAG],
    createdAt: 1,
    ...overrides,
  };
}

describe('isPublicSquadForCommonsBroadcast', () => {
  it('requires public visibility', () => {
    expect(
      isPublicSquadForCommonsBroadcast({
        id: 'g1',
        name: 'Alpha',
        kind: 'squad',
        visibility: 'private',
        commonsTags: ['neo'],
      })
    ).toBe(false);
    expect(
      isPublicSquadForCommonsBroadcast({
        id: 'g1',
        name: 'Alpha',
        kind: 'squad',
        visibility: 'public',
      })
    ).toBe(true);
    expect(
      isPublicSquadForCommonsBroadcast({
        id: 'g1',
        name: 'Alpha',
        kind: 'squad',
        visibility: 'public',
        commonsTags: ['neo'],
      })
    ).toBe(true);
  });
});

describe('defaultPublicSquadBroadcastMessage', () => {
  it('uses squad name in default copy', () => {
    expect(defaultPublicSquadBroadcastMessage('Neo Builders')).toBe('New squad: Neo Builders');
  });
});

describe('publishPublicSquadCreateBroadcast', () => {
  beforeEach(() => {
    stubLocalStorage();
    setCurrentNpubForPersistence('npub1test');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    setCurrentNpubForPersistence(null);
  });

  it('returns ok for non-public squads without publishing', async () => {
    const result = await publishPublicSquadCreateBroadcast(makeSquad({ visibility: 'private' }));

    expect(result).toEqual({ ok: true });
    expect(publishCommonsBroadcast).not.toHaveBeenCalled();
  });

  it('publishes a public squad broadcast with the default message and #new tag', async () => {
    vi.mocked(publishCommonsBroadcast).mockResolvedValueOnce(makeDto());

    const result = await publishPublicSquadCreateBroadcast(makeSquad());

    expect(result).toEqual({ ok: true });
    expect(publishCommonsBroadcast).toHaveBeenCalledWith({
      subject: 'squad',
      message: 'New squad: Neo Builders',
      durationHours: 72,
      tags: ['neo', 'builders', 'community', COMMONS_NEW_TAG],
      squad: {
        id: squadId,
        name: 'Neo Builders',
        kind: 'squad',
        iconUrl: undefined,
      },
    });
    expect(getActiveCommonsBroadcastLocalState('squad', squadId, nowSecs)).toEqual(
      expect.objectContaining({ tags: ['neo', 'builders', 'community', COMMONS_NEW_TAG] })
    );
  });

  it('returns an error when the broadcast fails', async () => {
    vi.mocked(publishCommonsBroadcast).mockRejectedValueOnce('pub failed');

    const result = await publishPublicSquadCreateBroadcast(makeSquad());

    expect(result).toEqual({ ok: false, error: 'pub failed' });
    expect(getActiveCommonsBroadcastLocalState('squad', squadId, nowSecs)).toBeNull();
  });
});

describe('schedulePublicSquadCreateBroadcast', () => {
  beforeEach(() => {
    stubLocalStorage();
    setCurrentNpubForPersistence('npub1test');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    setCurrentNpubForPersistence(null);
  });

  it('does nothing when the resolved squad id does not match', async () => {
    schedulePublicSquadCreateBroadcast('other', () => makeSquad());
    await vi.waitFor(() => expect(publishCommonsBroadcast).not.toHaveBeenCalled());
    await vi.waitFor(() => expect(showToast).not.toHaveBeenCalled());
  });

  it('does nothing for non-public squads', async () => {
    schedulePublicSquadCreateBroadcast(squadId, () => makeSquad({ visibility: 'private' }));
    await vi.waitFor(() => expect(publishCommonsBroadcast).not.toHaveBeenCalled());
    await vi.waitFor(() => expect(showToast).not.toHaveBeenCalled());
  });

  it('publishes for a public squad', async () => {
    vi.mocked(publishCommonsBroadcast).mockResolvedValueOnce(makeDto());

    schedulePublicSquadCreateBroadcast(squadId, () => makeSquad());

    await vi.waitFor(() =>
      expect(publishCommonsBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'squad',
          message: 'New squad: Neo Builders',
          durationHours: 72,
          tags: ['neo', 'builders', 'community', COMMONS_NEW_TAG],
        })
      )
    );
    expect(showToast).not.toHaveBeenCalled();
  });

  it('shows a retry toast when the broadcast fails', async () => {
    vi.mocked(publishCommonsBroadcast).mockRejectedValueOnce('pub failed');

    schedulePublicSquadCreateBroadcast(squadId, () => makeSquad());

    await vi.waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining('Commons broadcast failed for Neo Builders'),
        undefined,
        expect.objectContaining({ label: 'Retry broadcast' })
      )
    );
  });

  it('retry action republishes the broadcast', async () => {
    vi.mocked(publishCommonsBroadcast)
      .mockRejectedValueOnce('pub failed')
      .mockResolvedValueOnce(makeDto());

    schedulePublicSquadCreateBroadcast(squadId, () => makeSquad());

    await vi.waitFor(() => expect(showToast).toHaveBeenCalled());
    const retry = vi.mocked(showToast).mock.calls[0][2];
    expect(retry).toBeDefined();
    retry!.action();

    await vi.waitFor(() => expect(publishCommonsBroadcast).toHaveBeenCalledTimes(2));
  });
});
