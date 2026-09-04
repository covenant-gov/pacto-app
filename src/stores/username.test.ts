import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  computeUsernameVerified,
  claimedUsernameFromState,
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
import { currentUser } from './auth';
import {
  usernameGetCachedClaim,
  usernameRecordOf,
  usernameIsPendingTransfer,
  usernameClaim,
} from '../lib/api/username';
import { getActiveSquadEvmSignerAddress } from '../lib/wallet/evm-accounts';
import { npubHashFromPubkey } from '../lib/evm/sponsor/nostr_claim_link';

vi.mock('../lib/api/username', () => ({
  usernameGetCachedClaim: vi.fn(),
  usernameRecordOf: vi.fn(),
  usernameIsPendingTransfer: vi.fn(),
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

const mockGetCached = vi.mocked(usernameGetCachedClaim);
const mockRecordOf = vi.mocked(usernameRecordOf);
const mockPending = vi.mocked(usernameIsPendingTransfer);
const mockActiveEvm = vi.mocked(getActiveSquadEvmSignerAddress);
const mockClaim = vi.mocked(usernameClaim);
const mockNpubHash = vi.mocked(npubHashFromPubkey);

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
      /got npub/,
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

describe('refreshUsernameState', () => {
  beforeEach(() => {
    resetUsernameState();
    currentUser.set({
      pubkey: 'aa'.repeat(32),
      npub: 'npub1test',
    } as never);
    mockGetCached.mockReset();
    mockRecordOf.mockReset();
    mockPending.mockReset();
    mockActiveEvm.mockReset();
  });

  afterEach(() => {
    resetUsernameState();
    currentUser.set(null);
  });

  it('a stale refresh does not clobber a newer one', async () => {
    const { promise, resolve: resolveFirst } = Promise.withResolvers<{
      name: string;
      evmAddress: string;
      pendingAddress: string;
      tokenId: string;
    }>();

    mockGetCached.mockResolvedValue({
      npub: 'npub1',
      username: 'alice',
      npubHash: NPUB_HASH,
      tokenId: '1',
      linkEventId: 'evt1',
      policyVersion: 3,
      network: 'sepolia',
      updatedAtMs: 1,
    });
    mockActiveEvm.mockResolvedValue(EVM);
    mockPending.mockResolvedValue(false);

    let recordCalls = 0;
    mockRecordOf.mockImplementation(() => {
      recordCalls += 1;
      if (recordCalls === 1) return promise;
      return Promise.resolve({
        name: 'alice',
        evmAddress: OTHER,
        pendingAddress: '0x0000000000000000000000000000000000000000',
        tokenId: '1',
      });
    });

    const first = refreshUsernameState();
    // Let the first refresh pass cache/EVM awaits and park on recordOf.
    await Promise.resolve();
    await Promise.resolve();

    await refreshUsernameState();
    expect(get(usernameState).record?.evmAddress).toBe(OTHER);

    resolveFirst({
      name: 'alice',
      evmAddress: EVM,
      pendingAddress: '0x0000000000000000000000000000000000000000',
      tokenId: '1',
    });
    await first;
    expect(get(usernameState).record?.evmAddress).toBe(OTHER);
  });

  it('preserves last-known record when chain reads fail', async () => {
    usernameState.set(readyState());
    mockGetCached.mockResolvedValue({
      npub: 'npub1',
      username: 'alice',
      npubHash: NPUB_HASH,
      tokenId: '1',
      linkEventId: 'evt1',
      policyVersion: 3,
      network: 'sepolia',
      updatedAtMs: 1,
    });
    mockActiveEvm.mockResolvedValue(EVM);
    mockRecordOf.mockRejectedValueOnce(new Error('rpc down'));
    mockPending.mockRejectedValueOnce(new Error('rpc down'));

    await refreshUsernameState();
    expect(get(usernameState).status).toBe('ready');
    expect(get(usernameState).record?.evmAddress).toBe(EVM);
    expect(get(usernameState).record?.name).toBe('alice');
  });

  it('errors when session pubkey is bech32 npub and cache has no hash', async () => {
    currentUser.set({
      pubkey: 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
      npub: 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
    } as never);
    mockGetCached.mockResolvedValue(null);
    mockActiveEvm.mockResolvedValue(EVM);

    await refreshUsernameState();
    expect(get(usernameState).status).toBe('error');
    expect(get(usernameState).error).toMatch(/pubkey must be 32 bytes hex/);
    expect(mockNpubHash).not.toHaveBeenCalled();
  });

  it('hashes hex pubkey when cache has no npubHash', async () => {
    const hex = 'cc'.repeat(32);
    currentUser.set({ pubkey: hex, npub: 'npub1test' } as never);
    mockGetCached.mockResolvedValue(null);
    mockActiveEvm.mockResolvedValue(EVM);
    mockRecordOf.mockResolvedValue({
      name: '',
      evmAddress: '0x0000000000000000000000000000000000000000',
      pendingAddress: '0x0000000000000000000000000000000000000000',
      tokenId: '0',
    });
    mockPending.mockResolvedValue(false);

    await refreshUsernameState();
    expect(get(usernameState).status).toBe('ready');
    expect(mockNpubHash).toHaveBeenCalledWith(`0x${hex}`);
  });
});

describe('claimUsername', () => {
  beforeEach(() => {
    resetUsernameState();
    currentUser.set({
      pubkey: 'aa'.repeat(32),
      npub: 'npub1test',
    } as never);
    mockGetCached.mockReset();
    mockRecordOf.mockReset();
    mockPending.mockReset();
    mockActiveEvm.mockReset();
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
    mockGetCached.mockResolvedValue(null);
    mockActiveEvm.mockResolvedValue(EVM);
    mockRecordOf.mockResolvedValue({
      name: 'Dao',
      evmAddress: EVM,
      pendingAddress: '0x0000000000000000000000000000000000000000',
      tokenId: '1',
    });
    mockPending.mockResolvedValue(false);

    await claimUsername('  Dao  ');
    expect(mockClaim).toHaveBeenCalledWith('sepolia', 'Dao');
  });
});
