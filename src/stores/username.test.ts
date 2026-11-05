import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  computeUsernameVerified,
  claimedUsernameFromState,
  showEvmDashGas,
  resetUsernameState,
  refreshUsernameState,
  usernameState,
  isUsernameVerified,
  claimedUsername,
  hasPendingUsernameTransfer,
  isValidUsernameFormat,
  ensurePubkeyHex,
  normalizeUsernameInput,
  claimUsername,
  type UsernameState,
} from './username';
import { currentUser } from './auth-session';
import { usernameClaim, usernameSyncAccountState, type UsernameAccountState } from '../lib/api/username';
import { getActiveSquadEvmSignerAddress } from '../lib/wallet/evm-accounts';

vi.mock('../lib/api/username', () => ({
  usernameSyncAccountState: vi.fn(),
  usernameClaim: vi.fn(),
  usernameInitiateAddressTransfer: vi.fn(),
  usernameClaimAddressTransfer: vi.fn(),
  usernameCancelAddressTransfer: vi.fn(),
  usernameNameAvailable: vi.fn(),
}));

vi.mock('../lib/wallet/evm-accounts', () => ({
  getActiveSquadEvmSignerAddress: vi.fn(),
}));

vi.mock('../lib/evm/sponsor/nostr_claim_link', () => ({
  npubHashFromPubkey: vi.fn(() => '0x' + 'ab'.repeat(32)),
}));

const mockSync = vi.mocked(usernameSyncAccountState);
const mockActiveEvm = vi.mocked(getActiveSquadEvmSignerAddress);
const mockClaim = vi.mocked(usernameClaim);

const ZERO = '0x0000000000000000000000000000000000000000';
const EVM = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const NPUB_HASH = '0x' + 'ab'.repeat(32);

function readyState(overrides: Partial<UsernameState> = {}): UsernameState {
  return {
    status: 'ready',
    cached: {
      npub: 'npub1',
      username: 'alice',
      npubHash: NPUB_HASH,
      tokenId: '1',
      linkEventId: 'evt1',
      policyVersion: 3,
      network: 'sepolia',
      updatedAtMs: 1,
    },
    record: {
      name: 'alice',
      evmAddress: EVM,
      pendingAddress: '0x0000000000000000000000000000000000000000',
      tokenId: '1',
    },
    pendingTransfer: false,
    activeEvm: EVM,
    busy: false,
    error: null,
    ...overrides,
  };
}

describe('computeUsernameVerified', () => {
  it('requires linkEventId, non-zero token, name, and matching evm', () => {
    expect(
      computeUsernameVerified({
        linkEventId: 'evt1',
        record: {
          name: 'alice',
          evmAddress: EVM,
          pendingAddress: '0x0000000000000000000000000000000000000000',
          tokenId: '1',
        },
        activeEvm: EVM,
      }),
    ).toBe(true);
  });

  it('fails without linkEventId', () => {
    expect(
      computeUsernameVerified({
        linkEventId: null,
        record: {
          name: 'alice',
          evmAddress: EVM,
          pendingAddress: '0x0000000000000000000000000000000000000000',
          tokenId: '1',
        },
        activeEvm: EVM,
      }),
    ).toBe(false);
  });

  it('fails when evm mismatches', () => {
    expect(
      computeUsernameVerified({
        linkEventId: 'evt1',
        record: {
          name: 'alice',
          evmAddress: EVM,
          pendingAddress: '0x0000000000000000000000000000000000000000',
          tokenId: '1',
        },
        activeEvm: OTHER,
      }),
    ).toBe(false);
  });

  it('fails when tokenId is zero', () => {
    expect(
      computeUsernameVerified({
        linkEventId: 'evt1',
        record: {
          name: 'alice',
          evmAddress: EVM,
          pendingAddress: '0x0000000000000000000000000000000000000000',
          tokenId: '0',
        },
        activeEvm: EVM,
      }),
    ).toBe(false);
  });

  it('matches evm case-insensitively', () => {
    expect(
      computeUsernameVerified({
        linkEventId: 'evt1',
        record: {
          name: 'alice',
          evmAddress: EVM.toUpperCase(),
          pendingAddress: '0x0000000000000000000000000000000000000000',
          tokenId: '7',
        },
        activeEvm: EVM,
      }),
    ).toBe(true);
  });

  it('is unverified after rotation until a fresh linkEventId is present', () => {
    expect(
      computeUsernameVerified({
        linkEventId: null,
        record: {
          name: 'alice',
          evmAddress: OTHER,
          pendingAddress: '0x0000000000000000000000000000000000000000',
          tokenId: '1',
        },
        activeEvm: OTHER,
      }),
    ).toBe(false);
    expect(
      computeUsernameVerified({
        linkEventId: 'evt-after-rotation',
        record: {
          name: 'alice',
          evmAddress: OTHER,
          pendingAddress: '0x0000000000000000000000000000000000000000',
          tokenId: '1',
        },
        activeEvm: OTHER,
      }),
    ).toBe(true);
  });
});

describe('claimedUsernameFromState', () => {
  it('prefers on-chain record name', () => {
    const state: UsernameState = {
      status: 'ready',
      cached: {
        npub: 'npub1',
        username: 'cached',
        npubHash: '0xab',
        tokenId: '1',
        linkEventId: 'e',
        policyVersion: 3,
        network: 'sepolia',
        updatedAtMs: 1,
      },
      record: {
        name: 'onchain',
        evmAddress: EVM,
        pendingAddress: '0x0000000000000000000000000000000000000000',
        tokenId: '1',
      },
      pendingTransfer: false,
      activeEvm: EVM,
      busy: false,
      error: null,
    };
    expect(claimedUsernameFromState(state)).toBe('onchain');
  });
});

describe('isValidUsernameFormat', () => {
  it('accepts any non-empty trimmed string up to 64 bytes', () => {
    expect(isValidUsernameFormat('dao')).toBe(true);
    expect(isValidUsernameFormat('Dao-Punk_1')).toBe(true);
    expect(isValidUsernameFormat('ab')).toBe(true);
  });

  it('trims without lowercasing', () => {
    expect(isValidUsernameFormat('  DaoPunk  ')).toBe(true);
    expect(normalizeUsernameInput('  DaoPunk  ')).toBe('DaoPunk');
  });

  it('rejects empty or oversized', () => {
    expect(isValidUsernameFormat('')).toBe(false);
    expect(isValidUsernameFormat('   ')).toBe(false);
    expect(isValidUsernameFormat('a'.repeat(65))).toBe(false);
  });
});

describe('ensurePubkeyHex', () => {
  it('accepts 64 hex with or without 0x', () => {
    const hex = 'aa'.repeat(32);
    expect(ensurePubkeyHex(hex)).toBe(`0x${hex}`);
    expect(ensurePubkeyHex(`0x${hex}`)).toBe(`0x${hex}`);
  });

  it('rejects bech32 npub', () => {
    expect(() => ensurePubkeyHex('npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq')).toThrow(
      /got npub|pubkey|hex/i,
    );
  });
});

describe('username derived stores', () => {
  beforeEach(() => {
    resetUsernameState();
    currentUser.set(null);
  });

  afterEach(() => {
    resetUsernameState();
    currentUser.set(null);
  });

  it('isUsernameVerified tracks state', () => {
    expect(get(isUsernameVerified)).toBe(false);
    usernameState.set(readyState());
    expect(get(isUsernameVerified)).toBe(true);
    expect(get(claimedUsername)).toBe('alice');
    expect(get(hasPendingUsernameTransfer)).toBe(false);
  });

  it('hasPendingUsernameTransfer from flag or pendingAddress', () => {
    usernameState.update((s) => ({
      ...s,
      status: 'ready',
      pendingTransfer: true,
    }));
    expect(get(hasPendingUsernameTransfer)).toBe(true);

    usernameState.update((s) => ({
      ...s,
      pendingTransfer: false,
      record: {
        name: 'alice',
        evmAddress: EVM,
        pendingAddress: OTHER,
        tokenId: '1',
      },
    }));
    expect(get(hasPendingUsernameTransfer)).toBe(true);
  });
});

function syncState(overrides: Partial<UsernameAccountState> = {}): UsernameAccountState {
  return {
    cached: null,
    record: {
      name: '',
      evmAddress: ZERO,
      pendingAddress: ZERO,
      tokenId: '0',
    },
    pendingTransfer: false,
    chainError: null,
    ...overrides,
  };
}

describe('showEvmDashGas', () => {
  it('uses the chain record when this pass read one', () => {
    const cached = readyState().cached;
    expect(
      showEvmDashGas({
        ...readyState(),
        cached,
        record: {
          name: '',
          evmAddress: ZERO,
          pendingAddress: ZERO,
          tokenId: '0',
        },
      }),
    ).toBe(false);
    expect(
      showEvmDashGas({
        ...readyState(),
        cached: null,
        record: readyState().record,
      }),
    ).toBe(true);
  });

  it('falls back to cache only when the chain record is absent', () => {
    expect(showEvmDashGas({ ...readyState(), record: null })).toBe(true);
    expect(showEvmDashGas({ ...readyState(), record: null, cached: null })).toBe(false);
  });
});

describe('refreshUsernameState', () => {
  beforeEach(() => {
    resetUsernameState();
    currentUser.set({
      pubkey: 'aa'.repeat(32),
      npub: 'npub1test',
    } as never);
    mockSync.mockReset();
    mockActiveEvm.mockReset();
    mockActiveEvm.mockResolvedValue(EVM);
    mockSync.mockResolvedValue(syncState());
  });

  afterEach(() => {
    resetUsernameState();
    currentUser.set(null);
  });

  it('a stale refresh does not clobber a newer one', async () => {
    const { promise, resolve: resolveFirst } = Promise.withResolvers<UsernameAccountState>();
    let calls = 0;
    mockSync.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return promise;
      return Promise.resolve(
        syncState({
          record: {
            name: 'alice',
            evmAddress: OTHER,
            pendingAddress: ZERO,
            tokenId: '1',
          },
        }),
      );
    });

    const first = refreshUsernameState();
    await Promise.resolve();
    await Promise.resolve();

    await refreshUsernameState();
    expect(get(usernameState).record?.evmAddress).toBe(OTHER);

    resolveFirst(
      syncState({
        record: {
          name: 'alice',
          evmAddress: EVM,
          pendingAddress: ZERO,
          tokenId: '1',
        },
      }),
    );
    await first;
    expect(get(usernameState).record?.evmAddress).toBe(OTHER);
  });

  it('preserves last-known record when the chain read fails', async () => {
    usernameState.set(readyState());
    mockSync.mockResolvedValue(
      syncState({
        cached: readyState().cached,
        record: null,
        chainError: 'rpc down',
      }),
    );

    await refreshUsernameState();
    expect(get(usernameState).status).toBe('ready');
    expect(get(usernameState).record?.evmAddress).toBe(EVM);
    expect(get(usernameState).record?.name).toBe('alice');
    expect(get(usernameState).pendingTransfer).toBe(false);
  });

  it('surfaces a sync rejection as an error', async () => {
    mockSync.mockRejectedValueOnce(new Error('db down'));
    await refreshUsernameState();
    expect(get(usernameState).status).toBe('error');
    expect(get(usernameState).error).toMatch(/db down/i);
  });

  it('applies the synced claim row for an on-chain holder', async () => {
    mockSync.mockResolvedValue(
      syncState({
        cached: {
          npub: 'npub1',
          username: 'alice',
          npubHash: NPUB_HASH,
          tokenId: '7',
          linkEventId: null,
          policyVersion: 3,
          network: 'sepolia',
          updatedAtMs: 2,
        },
        record: {
          name: 'alice',
          evmAddress: EVM,
          pendingAddress: ZERO,
          tokenId: '7',
        },
      }),
    );

    await refreshUsernameState();
    expect(mockSync).toHaveBeenCalledWith('sepolia');
    expect(get(usernameState).cached?.username).toBe('alice');
    expect(get(usernameState).cached?.linkEventId).toBeNull();
    expect(get(usernameState).cached?.tokenId).toBe('7');
    expect(showEvmDashGas(get(usernameState))).toBe(true);
  });

  it('keeps an empty chain record instead of a stale cache for the dash', async () => {
    mockSync.mockResolvedValue(
      syncState({
        cached: readyState().cached,
      }),
    );

    await refreshUsernameState();
    expect(get(usernameState).record?.name).toBe('');
    expect(showEvmDashGas(get(usernameState))).toBe(false);
  });

  it('applies an existing link id returned by sync', async () => {
    mockSync.mockResolvedValue(
      syncState({
        cached: readyState().cached,
        record: readyState().record,
      }),
    );

    await refreshUsernameState();
    expect(get(usernameState).cached?.linkEventId).toBe('evt1');
  });
});

describe('claimUsername', () => {
  beforeEach(() => {
    resetUsernameState();
    currentUser.set({
      pubkey: 'aa'.repeat(32),
      npub: 'npub1test',
    } as never);
    mockSync.mockReset();
    mockSync.mockResolvedValue(syncState());
    mockActiveEvm.mockReset();
    mockActiveEvm.mockResolvedValue(EVM);
    mockClaim.mockReset();
  });

  afterEach(() => {
    resetUsernameState();
    currentUser.set(null);
  });

  it('trims the name before invoke without lowercasing', async () => {
    mockClaim.mockResolvedValue({
      network: 'sepolia',
      chainId: 11155111,
      path: 'bootstrap',
      username: 'Dao',
      npubHash: NPUB_HASH,
      tokenId: '1',
      linkEventId: 'evt',
      userOpHash: '0x1',
      evmAddress: EVM,
      policyVersion: 1,
    });
    await claimUsername('  Dao  ');
    expect(mockClaim).toHaveBeenCalledWith('sepolia', 'Dao');
  });
});
