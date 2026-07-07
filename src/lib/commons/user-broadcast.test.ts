import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  cancelCommonsBroadcast,
  getLocalActiveCommonsBroadcast,
  publishCommonsBroadcast,
} from '../api/commons';
import { getInvokeErrorMessage } from '../utils/tauri-errors';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import {
  cancelUserCommonsBroadcast,
  commonsAudienceForFirstBroadcast,
  fetchActiveUserCommonsBroadcast,
  publishUserCommonsBroadcast,
} from './user-broadcast';
import { COMMONS_NEW_TAG } from './tags';
import { PACTO_COMMONS_BROADCASTED_PREFIX } from './first-broadcast';
import {
  getActiveCommonsBroadcastLocalState,
  PACTO_COMMONS_BROADCASTS_PREFIX,
  recordCommonsBroadcastLocalState,
} from './local-broadcast-state';
import type { CommonsBroadcastDto } from './types';

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

vi.mock('../api/commons');
vi.mock('../utils/tauri-errors', () => ({
  getInvokeErrorMessage: vi.fn((e: unknown, fallback: string) =>
    typeof e === 'string' && e ? e : fallback
  ),
}));

const npub = 'npub1user';
const nowSecs = Math.floor(Date.now() / 1000);

function makeDto(overrides: Partial<CommonsBroadcastDto> = {}): CommonsBroadcastDto {
  return {
    eventId: 'evt1',
    authorNpub: npub,
    subject: 'user',
    subjectId: npub,
    message: 'Hello Commons',
    durationHours: 24,
    expiresAt: nowSecs + 3600,
    tags: ['neo'],
    createdAt: 1,
    ...overrides,
  };
}

describe('commonsAudienceForFirstBroadcast', () => {
  it('treats the first broadcast ever as a new user', () => {
    expect(commonsAudienceForFirstBroadcast(true)).toBe('new_user');
  });

  it('treats any later broadcast as an active user', () => {
    expect(commonsAudienceForFirstBroadcast(false)).toBe('active_user');
  });
});

describe('fetchActiveUserCommonsBroadcast', () => {
  beforeEach(() => {
    stubLocalStorage();
    setCurrentNpubForPersistence(npub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    setCurrentNpubForPersistence(null);
  });

  it('returns local cache hit without calling the backend', async () => {
    const dto = makeDto();
    recordCommonsBroadcastLocalState(dto);

    const result = await fetchActiveUserCommonsBroadcast(npub);

    expect(result?.message).toBe('Hello Commons');
    expect(getLocalActiveCommonsBroadcast).not.toHaveBeenCalled();
  });

  it('records and returns a DTO from the backend', async () => {
    const dto = makeDto();
    vi.mocked(getLocalActiveCommonsBroadcast).mockResolvedValueOnce(dto);

    const result = await fetchActiveUserCommonsBroadcast(npub);

    expect(getLocalActiveCommonsBroadcast).toHaveBeenCalledWith('user', npub);
    expect(result?.eventId).toBe('evt1');
    expect(getActiveCommonsBroadcastLocalState('user', npub, nowSecs)).toEqual(
      expect.objectContaining({ subjectId: npub, eventId: 'evt1' })
    );
  });

  it('returns null on backend error', async () => {
    vi.mocked(getLocalActiveCommonsBroadcast).mockRejectedValueOnce(new Error('db locked'));

    const result = await fetchActiveUserCommonsBroadcast(npub);

    expect(result).toBeNull();
  });
});

describe('cancelUserCommonsBroadcast', () => {
  beforeEach(() => {
    stubLocalStorage();
    setCurrentNpubForPersistence(npub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    setCurrentNpubForPersistence(null);
  });

  it('clears local state on success', async () => {
    recordCommonsBroadcastLocalState(makeDto());
    vi.mocked(cancelCommonsBroadcast).mockResolvedValueOnce(undefined);

    const result = await cancelUserCommonsBroadcast(npub);

    expect(result).toEqual({ ok: true });
    expect(cancelCommonsBroadcast).toHaveBeenCalledWith('user', npub);
    expect(getActiveCommonsBroadcastLocalState('user', npub, nowSecs)).toBeNull();
  });

  it('returns an error when the backend fails', async () => {
    vi.mocked(cancelCommonsBroadcast).mockRejectedValueOnce('cancel failed');

    const result = await cancelUserCommonsBroadcast(npub);

    expect(result).toEqual({ ok: false, error: 'cancel failed' });
    expect(getInvokeErrorMessage).toHaveBeenCalled();
  });
});

describe('publishUserCommonsBroadcast', () => {
  beforeEach(() => {
    stubLocalStorage();
    setCurrentNpubForPersistence(npub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    setCurrentNpubForPersistence(null);
  });
  beforeEach(() => {
    stubLocalStorage();
    setCurrentNpubForPersistence(npub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    setCurrentNpubForPersistence(null);
  });

  it('rejects an empty message', async () => {
    const result = await publishUserCommonsBroadcast({
      npub,
      message: '   ',
      durationHours: 24,
      tags: ['neo'],
    });

    expect(result).toEqual({ ok: false, error: 'Message is required.' });
  });

  it('rejects when no tags are provided', async () => {
    const result = await publishUserCommonsBroadcast({
      npub,
      message: 'hello',
      durationHours: 24,
      tags: [],
    });

    expect(result).toEqual({ ok: false, error: 'Add at least one tag.' });
  });

  it('blocks while an active broadcast is still cached', async () => {
    recordCommonsBroadcastLocalState(makeDto());

    const result = await publishUserCommonsBroadcast({
      npub,
      message: 'hello',
      durationHours: 24,
      tags: ['neo'],
    });

    expect(result).toEqual({
      ok: false,
      error: 'A broadcast is still active. Wait until it expires.',
    });
    expect(publishCommonsBroadcast).not.toHaveBeenCalled();
  });

  it('publishes a first-ever broadcast as a new user with the #new tag', async () => {
    vi.mocked(getLocalActiveCommonsBroadcast).mockResolvedValueOnce(null);
    const dto = makeDto({ tags: ['neo', COMMONS_NEW_TAG], audience: 'new_user' });
    vi.mocked(publishCommonsBroadcast).mockResolvedValueOnce(dto);

    const result = await publishUserCommonsBroadcast({
      npub,
      message: 'hello',
      durationHours: 24,
      tags: ['neo'],
    });

    expect(result).toEqual({ ok: true });
    expect(publishCommonsBroadcast).toHaveBeenCalledWith({
      subject: 'user',
      message: 'hello',
      durationHours: 24,
      tags: ['neo', COMMONS_NEW_TAG],
      audience: 'new_user',
    });
    expect(localStorage.getItem(`${PACTO_COMMONS_BROADCASTED_PREFIX}_${npub}`)).toBe('1');
    expect(getActiveCommonsBroadcastLocalState('user', npub, nowSecs)).toEqual(
      expect.objectContaining({ tags: ['neo', COMMONS_NEW_TAG], audience: 'new_user' })
    );
  });

  it('publishes later broadcasts as active users without the #new tag', async () => {
    localStorage.setItem(`${PACTO_COMMONS_BROADCASTED_PREFIX}_${npub}`, '1');
    vi.mocked(getLocalActiveCommonsBroadcast).mockResolvedValueOnce(null);
    const dto = makeDto({ audience: 'active_user' });
    vi.mocked(publishCommonsBroadcast).mockResolvedValueOnce(dto);

    const result = await publishUserCommonsBroadcast({
      npub,
      message: 'hello again',
      durationHours: 48,
      tags: ['neo'],
    });

    expect(result).toEqual({ ok: true });
    expect(publishCommonsBroadcast).toHaveBeenCalledWith({
      subject: 'user',
      message: 'hello again',
      durationHours: 48,
      tags: ['neo'],
      audience: 'active_user',
    });
    expect(localStorage.getItem(`${PACTO_COMMONS_BROADCASTS_PREFIX}_${npub}`)).toBeTruthy();
  });

  it('returns an error when publishing fails', async () => {
    vi.mocked(getLocalActiveCommonsBroadcast).mockResolvedValueOnce(null);
    vi.mocked(publishCommonsBroadcast).mockRejectedValueOnce('pub failed');

    const result = await publishUserCommonsBroadcast({
      npub,
      message: 'hello',
      durationHours: 24,
      tags: ['neo'],
    });

    expect(result).toEqual({ ok: false, error: 'pub failed' });
    expect(localStorage.getItem(`${PACTO_COMMONS_BROADCASTS_PREFIX}_${npub}`)).toBeNull();
    expect(localStorage.getItem(`${PACTO_COMMONS_BROADCASTED_PREFIX}_${npub}`)).toBeNull();
  });
});
