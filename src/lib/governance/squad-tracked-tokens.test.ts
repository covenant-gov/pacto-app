import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { sendDmMessage } from '../api/nostr';
import {
  buildTrackedTokenAnnouncePayload,
  formatTrackedTokenAnnounceMessage,
  getEvmErc20Balance,
  listSquadTrackedTokens,
  publishSquadTrackedTokenAnnounce,
  removeSquadTrackedToken,
  squadTrackedTokenEntryId,
  upsertSquadTrackedToken,
  type SquadTrackedTokenRow,
} from './squad-tracked-tokens';

vi.mock('@tauri-apps/api/core');
vi.mock('../api/nostr', () => ({
  sendDmMessage: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedSendDmMessage = vi.mocked(sendDmMessage);

const PARENT = 'test-parent-mls-id';
const ROW: SquadTrackedTokenRow = {
  id: squadTrackedTokenEntryId(PARENT, 'sepolia', '0x1111111111111111111111111111111111111111'),
  parentId: PARENT,
  chain: 'sepolia',
  tokenAddress: '0x1111111111111111111111111111111111111111',
  symbol: 'USDC',
  decimals: 6,
  addedByNpub: 'npub1test',
  createdAtMs: 1,
  updatedAtMs: 1,
};

beforeEach(() => {
  vi.stubGlobal('window', { __TAURI__: {} });
  mockedInvoke.mockReset();
  mockedSendDmMessage.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('squad tracked tokens', () => {
  it('builds stable entry ids', () => {
    expect(squadTrackedTokenEntryId(PARENT, 'sepolia', '0xAAA')).toContain('tracked-');
    expect(squadTrackedTokenEntryId(PARENT, 'SEPOLIA', '0xaaa')).toContain('0xaaa');
  });

  it('formats announce wire message', () => {
    const payload = buildTrackedTokenAnnouncePayload({ parentId: PARENT, action: 'upsert', row: ROW });
    const raw = formatTrackedTokenAnnounceMessage(payload);
    const parsed = JSON.parse(raw) as { type: string; pacto_virtual_bucket: string };
    expect(parsed.type).toBe('squad_tracked_tokens_updated');
    expect(parsed.pacto_virtual_bucket).toBe('inbox');
  });

  it('lists tracked tokens via invoke', async () => {
    mockedInvoke.mockResolvedValueOnce([ROW]);
    await expect(listSquadTrackedTokens(PARENT)).resolves.toEqual([ROW]);
    expect(mockedInvoke).toHaveBeenCalledWith('list_squad_tracked_tokens', { parentId: PARENT });
  });

  it('upserts and removes via invoke', async () => {
    mockedInvoke.mockResolvedValueOnce(ROW);
    await upsertSquadTrackedToken({
      parentId: PARENT,
      chain: 'sepolia',
      tokenAddress: ROW.tokenAddress,
      symbol: 'USDC',
      decimals: 6,
    });
    expect(mockedInvoke).toHaveBeenCalledWith('upsert_squad_tracked_token', {
      parentId: PARENT,
      chain: 'sepolia',
      tokenAddress: ROW.tokenAddress,
      symbol: 'USDC',
      decimals: 6,
    });

    mockedInvoke.mockResolvedValueOnce(undefined);
    await removeSquadTrackedToken(PARENT, ROW.id);
    expect(mockedInvoke).toHaveBeenCalledWith('remove_squad_tracked_token', {
      parentId: PARENT,
      id: ROW.id,
    });
  });

  it('publishes announce to announcements MLS group', async () => {
    const payload = buildTrackedTokenAnnouncePayload({ parentId: PARENT, action: 'upsert', row: ROW });
    await publishSquadTrackedTokenAnnounce('announcements-gid', payload);
    expect(mockedSendDmMessage).toHaveBeenCalledWith(
      'announcements-gid',
      expect.stringContaining('squad_tracked_tokens_updated'),
      '',
      { virtualBucket: 'inbox' },
    );
  });

  it('reads erc20 balance via invoke', async () => {
    mockedInvoke.mockResolvedValueOnce({
      balanceRaw: '1000',
      balanceDecimal: '0.001',
      symbol: 'USDC',
      decimals: 6,
    });
    const result = await getEvmErc20Balance('sepolia', ROW.tokenAddress, '0xabc');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.balance.symbol).toBe('USDC');
  });
});
