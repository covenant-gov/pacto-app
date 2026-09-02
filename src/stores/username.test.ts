import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  computeUsernameVerified,
  claimedUsernameFromState,
  resetUsernameState,
  usernameState,
  isUsernameVerified,
  claimedUsername,
  hasPendingUsernameTransfer,
  isValidUsernameFormat,
  type UsernameState,
} from './username';
import { currentUser } from './auth';

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

const EVM = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';

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
  it('accepts lowercase 3–32 a-z', () => {
    expect(isValidUsernameFormat('dao')).toBe(true);
    expect(isValidUsernameFormat('daopunk')).toBe(true);
  });

  it('rejects invalid shapes', () => {
    expect(isValidUsernameFormat('ab')).toBe(false);
    expect(isValidUsernameFormat('Dao')).toBe(false);
    expect(isValidUsernameFormat('dao1')).toBe(false);
    expect(isValidUsernameFormat('a'.repeat(33))).toBe(false);
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
    usernameState.set({
      status: 'ready',
      cached: {
        npub: 'npub1',
        username: 'alice',
        npubHash: '0xab',
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
    });
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
