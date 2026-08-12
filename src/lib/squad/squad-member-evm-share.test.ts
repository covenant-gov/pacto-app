import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke, sendDmMessage, listEvmAccounts, listEvmAccountSquadBindings } =
  vi.hoisted(() => ({
    invoke: vi.fn(),
    sendDmMessage: vi.fn(),
    listEvmAccounts: vi.fn(),
    listEvmAccountSquadBindings: vi.fn(),
  }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

vi.mock('../api/nostr', () => ({
  sendDmMessage: (...args: unknown[]) => sendDmMessage(...args),
}));

vi.mock('../wallet/evm-accounts', () => ({
  listEvmAccounts: (...args: unknown[]) => listEvmAccounts(...args),
}));

vi.mock('./evm-account-squad-bindings', () => ({
  listEvmAccountSquadBindings: (...args: unknown[]) => listEvmAccountSquadBindings(...args),
}));

import {
  healSquadMemberEvmShareIfDiverged,
  publishSquadMemberEvmShare,
  resolveSquadMemberEvmShareAddress,
} from './squad-member-evm-share';

const BOUND = '0xd5936993106c0263000000000000000000000001';
const DEFAULT = '0x897aae53c0255b02eff66bf2d623b19fa87e2d69';
const PARENT = 'ann-gid';

describe('resolveSquadMemberEvmShareAddress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listEvmAccountSquadBindings.mockResolvedValue([]);
    listEvmAccounts.mockResolvedValue([]);
  });

  it('prefers explicit address', async () => {
    await expect(
      resolveSquadMemberEvmShareAddress(PARENT, { evmAddress: BOUND }),
    ).resolves.toBe(BOUND);
    expect(listEvmAccountSquadBindings).not.toHaveBeenCalled();
  });

  it('prefers bound squad address', async () => {
    listEvmAccountSquadBindings.mockResolvedValueOnce([
      { evmAccountId: 'acc-bound', parentId: PARENT },
    ]);
    listEvmAccounts.mockResolvedValueOnce([
      { id: 'acc-bound', address: BOUND, isActive: false, purpose: 'squad' },
      { id: 'acc-default', address: DEFAULT, isActive: true, purpose: 'squad' },
    ]);
    await expect(resolveSquadMemberEvmShareAddress(PARENT)).resolves.toBe(BOUND);
  });

  it('returns null when unbound (no active Default invent)', async () => {
    await expect(resolveSquadMemberEvmShareAddress(PARENT)).resolves.toBeNull();
  });
});

describe('publishSquadMemberEvmShare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listEvmAccountSquadBindings.mockResolvedValue([
      { evmAccountId: 'acc-bound', parentId: PARENT },
    ]);
    listEvmAccounts.mockResolvedValue([
      { id: 'acc-bound', address: BOUND, isActive: false, purpose: 'squad' },
    ]);
    sendDmMessage.mockResolvedValue(undefined);
    invoke.mockResolvedValue(undefined);
  });

  it('publishes the bound address when active Default differs', async () => {
    await expect(publishSquadMemberEvmShare(PARENT)).resolves.toBe(true);
    expect(sendDmMessage).toHaveBeenCalledWith(
      PARENT,
      expect.stringContaining(BOUND),
      '',
      { virtualBucket: 'announcements' },
    );
    expect(invoke).toHaveBeenCalledWith('upsert_squad_member_evm', {
      parentId: PARENT,
      evmAddress: BOUND,
    });
  });

  it('does not publish when unbound', async () => {
    listEvmAccountSquadBindings.mockResolvedValueOnce([]);
    await expect(publishSquadMemberEvmShare(PARENT)).resolves.toBe(false);
    expect(sendDmMessage).not.toHaveBeenCalled();
  });
});

describe('healSquadMemberEvmShareIfDiverged', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listEvmAccountSquadBindings.mockResolvedValue([
      { evmAccountId: 'acc-bound', parentId: PARENT },
    ]);
    listEvmAccounts.mockResolvedValue([
      { id: 'acc-bound', address: BOUND, isActive: false, purpose: 'squad' },
    ]);
    sendDmMessage.mockResolvedValue(undefined);
    invoke.mockResolvedValue(undefined);
  });

  it('republishes when share row is Default and binding is squad key', async () => {
    const ok = await healSquadMemberEvmShareIfDiverged(
      PARENT,
      { npub1me: DEFAULT },
      'npub1me',
    );
    expect(ok).toBe(true);
    expect(sendDmMessage).toHaveBeenCalledWith(
      PARENT,
      expect.stringContaining(BOUND),
      '',
      { virtualBucket: 'announcements' },
    );
  });

  it('no-ops when share already matches binding', async () => {
    const ok = await healSquadMemberEvmShareIfDiverged(
      PARENT,
      { npub1me: BOUND },
      'npub1me',
    );
    expect(ok).toBe(false);
    expect(sendDmMessage).not.toHaveBeenCalled();
  });
});
