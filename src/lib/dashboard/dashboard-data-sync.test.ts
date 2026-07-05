import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { currentUser } from '../../stores/auth';
import {
  squadMemberEvmByParentId,
  treasurySafesByParentId,
  squadInfraByParentId,
  type TreasurySafeEntry,
} from '../../stores/squads';
import {
  treasurySafesFetchMetaByParentId,
  squadInfraFetchMetaByParentId,
  clearDashboardFetchMetaStores,
} from './dashboard-fetch-meta';
import { listParentTreasurySafes } from '../api/nostr';
import { listSquadInfra } from '../governance/api';
import { fetchSquadMemberEvmByNpub } from './parent-dashboard-loaders';
import {
  syncTreasurySafesForParent,
  syncSquadInfraForParent,
  syncSquadMemberEvmForParent,
  resetDashboardDataSyncInflight,
} from './dashboard-data-sync';
import { TREASURY_SAFES_CACHE_PREFIX } from './treasury-safes-cache';
import { SQUAD_INFRA_CACHE_PREFIX } from './squad-infra-cache';
import { SQUAD_MEMBER_EVM_CACHE_PREFIX } from './squad-member-evm-cache';
import type { SquadInfraDto } from '../governance/api';

vi.mock('../api/nostr');
vi.mock('../governance/api');
vi.mock('./parent-dashboard-loaders');

const mockedListParentTreasurySafes = vi.mocked(listParentTreasurySafes);
const mockedListSquadInfra = vi.mocked(listSquadInfra);
const mockedFetchSquadMemberEvmByNpub = vi.mocked(fetchSquadMemberEvmByNpub);

const npub = 'npub1testdashboardsyncxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const parentId = 'parent-1';

let storage: Map<string, string>;

function mockStorage() {
  storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => {
      storage.set(k, v);
    },
    removeItem: (k: string) => {
      storage.delete(k);
    },
    clear: () => storage.clear(),
    key: (i: number) => [...storage.keys()][i] ?? null,
    get length() {
      return storage.size;
    },
  } as Storage);
}

beforeEach(() => {
  mockStorage();
  vi.clearAllMocks();
  currentUser.set({ npub, pubkey: '0000' });
});

afterEach(() => {
  currentUser.set(null);
  treasurySafesByParentId.set({});
  squadInfraByParentId.set({});
  squadMemberEvmByParentId.set({});
  clearDashboardFetchMetaStores();
  vi.unstubAllGlobals();
});

const treasuryRows: TreasurySafeEntry[] = [
  {
    id: 't1',
    parentId,
    safeAddress: '0xSafe1',
    chain: 'sepolia',
    label: 'Main',
    createdAtMs: 1,
  },
];

const infraRows: SquadInfraDto[] = [
  {
    id: 'infra-1',
    parentId,
    infraType: 'pacto_gov',
    chain: 'sepolia',
    canonicalRef: '0xRef',
    createdAtMs: 1,
    updatedAtMs: 1,
  },
];

const evmMap: Record<string, string> = { npub1: '0xABC' };

describe('syncTreasurySafesForParent', () => {
  it('returns early when parentId is empty', async () => {
    await syncTreasurySafesForParent('');
    expect(mockedListParentTreasurySafes).not.toHaveBeenCalled();
  });

  it('dedupes concurrent calls', async () => {
    let resolve!: (value: TreasurySafeEntry[]) => void;
    const promise = new Promise<TreasurySafeEntry[]>((r) => {
      resolve = r;
    });
    mockedListParentTreasurySafes.mockReturnValueOnce(promise);

    const a = syncTreasurySafesForParent(parentId);
    const b = syncTreasurySafesForParent(parentId);

    expect(mockedListParentTreasurySafes).toHaveBeenCalledTimes(1);
    resolve(treasuryRows);
    await Promise.all([a, b]);

    expect(get(treasurySafesByParentId)[parentId]).toEqual(treasuryRows);
  });

  it('updates the store and persists cache when the user is logged in', async () => {
    mockedListParentTreasurySafes.mockResolvedValueOnce(treasuryRows);

    await syncTreasurySafesForParent(parentId);

    expect(get(treasurySafesByParentId)[parentId]).toEqual(treasuryRows);
    const raw = storage.get(`${TREASURY_SAFES_CACHE_PREFIX}_${npub}`);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.byParentId[parentId]).toEqual(treasuryRows);
  });

  it('sets loading and final fetch meta', async () => {
    mockedListParentTreasurySafes.mockResolvedValueOnce(treasuryRows);

    const loadingPromise = syncTreasurySafesForParent(parentId);
    expect(get(treasurySafesFetchMetaByParentId)[parentId]?.loading).toBe(true);
    await loadingPromise;

    const meta = get(treasurySafesFetchMetaByParentId)[parentId];
    expect(meta.loading).toBe(false);
    expect(meta.error).toBeNull();
    expect(typeof meta.fetchedAtMs).toBe('number');
  });

  it('sets error meta when the fetch fails', async () => {
    mockedListParentTreasurySafes.mockRejectedValueOnce(new Error('fetch failed'));

    await syncTreasurySafesForParent(parentId);

    const meta = get(treasurySafesFetchMetaByParentId)[parentId];
    expect(meta.loading).toBe(false);
    expect(meta.error).toBe('fetch failed');
  });

  it('sets error meta without cache timestamp when the user is not logged in', async () => {
    currentUser.set(null);
    mockedListParentTreasurySafes.mockRejectedValueOnce(new Error('auth failed'));

    await syncTreasurySafesForParent(parentId);

    const meta = get(treasurySafesFetchMetaByParentId)[parentId];
    expect(meta.loading).toBe(false);
    expect(meta.error).toBe('auth failed');
    expect(meta.fetchedAtMs).toBeNull();
  });

  it('does not persist cache when the user is not logged in', async () => {
    currentUser.set(null);
    mockedListParentTreasurySafes.mockResolvedValueOnce(treasuryRows);

    await syncTreasurySafesForParent(parentId);

    expect(get(treasurySafesByParentId)[parentId]).toEqual(treasuryRows);
    expect(storage.get(`${TREASURY_SAFES_CACHE_PREFIX}_${npub}`)).toBeUndefined();
    const meta = get(treasurySafesFetchMetaByParentId)[parentId];
    expect(meta.loading).toBe(false);
    expect(typeof meta.fetchedAtMs).toBe('number');
  });
});

describe('syncSquadInfraForParent', () => {
  it('returns early when parentId is empty', async () => {
    await syncSquadInfraForParent('');
    expect(mockedListSquadInfra).not.toHaveBeenCalled();
  });

  it('dedupes concurrent calls', async () => {
    let resolve!: (value: SquadInfraDto[]) => void;
    const promise = new Promise<SquadInfraDto[]>((r) => {
      resolve = r;
    });
    mockedListSquadInfra.mockReturnValueOnce(promise);

    const a = syncSquadInfraForParent(parentId);
    const b = syncSquadInfraForParent(parentId);

    expect(mockedListSquadInfra).toHaveBeenCalledTimes(1);
    resolve(infraRows);
    await Promise.all([a, b]);

    expect(get(squadInfraByParentId)[parentId]).toEqual(infraRows);
  });

  it('updates the store and persists cache when the user is logged in', async () => {
    mockedListSquadInfra.mockResolvedValueOnce(infraRows);

    await syncSquadInfraForParent(parentId);

    expect(get(squadInfraByParentId)[parentId]).toEqual(infraRows);
    const raw = storage.get(`${SQUAD_INFRA_CACHE_PREFIX}_${npub}`);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.byParentId[parentId]).toEqual(infraRows);
  });

  it('sets loading and final fetch meta', async () => {
    mockedListSquadInfra.mockResolvedValueOnce(infraRows);

    const loadingPromise = syncSquadInfraForParent(parentId);
    expect(get(squadInfraFetchMetaByParentId)[parentId]?.loading).toBe(true);
    await loadingPromise;

    const meta = get(squadInfraFetchMetaByParentId)[parentId];
    expect(meta.loading).toBe(false);
    expect(meta.error).toBeNull();
    expect(typeof meta.fetchedAtMs).toBe('number');
  });

  it('does not persist cache when the user is not logged in', async () => {
    currentUser.set(null);
    mockedListSquadInfra.mockResolvedValueOnce(infraRows);

    await syncSquadInfraForParent(parentId);

    expect(get(squadInfraByParentId)[parentId]).toEqual(infraRows);
    expect(storage.get(`${SQUAD_INFRA_CACHE_PREFIX}_${npub}`)).toBeUndefined();
    const meta = get(squadInfraFetchMetaByParentId)[parentId];
    expect(meta.loading).toBe(false);
    expect(typeof meta.fetchedAtMs).toBe('number');
  });

  it('sets error meta when the fetch fails', async () => {
    mockedListSquadInfra.mockRejectedValueOnce(new Error('infra failed'));

    await syncSquadInfraForParent(parentId);

    const meta = get(squadInfraFetchMetaByParentId)[parentId];
    expect(meta.loading).toBe(false);
    expect(meta.error).toBe('infra failed');
  });

  it('sets error meta without cache timestamp when the user is not logged in', async () => {
    currentUser.set(null);
    mockedListSquadInfra.mockRejectedValueOnce(new Error('auth failed'));

    await syncSquadInfraForParent(parentId);

    const meta = get(squadInfraFetchMetaByParentId)[parentId];
    expect(meta.loading).toBe(false);
    expect(meta.error).toBe('auth failed');
    expect(meta.fetchedAtMs).toBeNull();
  });
});

describe('syncSquadMemberEvmForParent', () => {
  it('returns early when parentId is empty', async () => {
    await syncSquadMemberEvmForParent('', null);
    expect(mockedFetchSquadMemberEvmByNpub).not.toHaveBeenCalled();
  });

  it('dedupes concurrent calls', async () => {
    let resolve!: (value: Record<string, string>) => void;
    const promise = new Promise<Record<string, string>>((r) => {
      resolve = r;
    });
    mockedFetchSquadMemberEvmByNpub.mockReturnValueOnce(promise);

    const a = syncSquadMemberEvmForParent(parentId, 'group-1');
    const b = syncSquadMemberEvmForParent(parentId, 'group-1');

    expect(mockedFetchSquadMemberEvmByNpub).toHaveBeenCalledTimes(1);
    resolve(evmMap);
    await Promise.all([a, b]);

    expect(get(squadMemberEvmByParentId)[parentId]).toEqual(evmMap);
  });

  it('updates the store and persists cache', async () => {
    mockedFetchSquadMemberEvmByNpub.mockResolvedValueOnce(evmMap);

    await syncSquadMemberEvmForParent(parentId, 'group-1');

    expect(mockedFetchSquadMemberEvmByNpub).toHaveBeenCalledWith(parentId, 'group-1');
    expect(get(squadMemberEvmByParentId)[parentId]).toEqual(evmMap);
    const raw = storage.get(`${SQUAD_MEMBER_EVM_CACHE_PREFIX}_${npub}`);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.byParentId[parentId]).toEqual([evmMap]);
  });
});

describe('resetDashboardDataSyncInflight', () => {
  it('clears in-flight maps so a new call fetches again', async () => {
    let resolve!: (value: TreasurySafeEntry[]) => void;
    const promise = new Promise<TreasurySafeEntry[]>((r) => {
      resolve = r;
    });
    mockedListParentTreasurySafes.mockReturnValueOnce(promise);

    const a = syncTreasurySafesForParent(parentId);
    resetDashboardDataSyncInflight();
    resolve([]);
    await a;

    mockedListParentTreasurySafes.mockResolvedValueOnce([]);
    await syncTreasurySafesForParent(parentId);
    expect(mockedListParentTreasurySafes).toHaveBeenCalledTimes(2);
  });
});
