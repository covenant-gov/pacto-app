import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { sendDmMessage } from '../api/nostr';
import {
  buildAllowlistAnnouncePayload,
  evmSendSquadAllowlistedContractCall,
  findAllowlistLabel,
  formatAllowlistAnnounceMessage,
  listSquadContractAllowlist,
  publishSquadAllowlistAnnounce,
  removeSquadContractAllowlist,
  squadAllowlistEntryId,
  type SquadContractAllowlistRow,
  type SquadAllowlistedSendOutcome,
  upsertSquadContractAllowlist,
} from './squad-allowlist';

vi.mock('@tauri-apps/api/core');
vi.mock('../api/nostr', () => ({
  sendDmMessage: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedSendDmMessage = vi.mocked(sendDmMessage);

function failureMessage(outcome: SquadAllowlistedSendOutcome): string {
  if (outcome.ok) throw new Error('expected failure outcome');
  return outcome.message;
}

const PARENT = 'test-parent-mls-id';
const ROW: SquadContractAllowlistRow = {
  id: squadAllowlistEntryId(PARENT, 'sepolia', '0x1111111111111111111111111111111111111111'),
  parentId: PARENT,
  chain: 'sepolia',
  contractAddress: '0x1111111111111111111111111111111111111111',
  label: 'Test protocol',
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

describe('squad allowlist helpers', () => {
  it('builds stable entry ids', () => {
    expect(squadAllowlistEntryId(PARENT, 'sepolia', '0xAAA')).toContain('allowlist-');
    expect(squadAllowlistEntryId(PARENT, 'sepolia', '0xaaa')).toContain('0xaaa');
  });

  it('formats announce wire message', () => {
    const payload = buildAllowlistAnnouncePayload({ parentId: PARENT, action: 'upsert', row: ROW });
    const raw = formatAllowlistAnnounceMessage(payload);
    const parsed = JSON.parse(raw) as { type: string; pacto_virtual_bucket: string };
    expect(parsed.type).toBe('squad_contract_allowlist_updated');
    expect(parsed.pacto_virtual_bucket).toBe('inbox');
  });

  it('finds label for matching target', () => {
    expect(findAllowlistLabel([ROW], 'sepolia', ROW.contractAddress)).toBe('Test protocol');
    expect(findAllowlistLabel([ROW], 'mainnet', ROW.contractAddress)).toBeNull();
  });

  it('findAllowlistLabel is case-insensitive for chain and address', () => {
    expect(findAllowlistLabel([ROW], 'SEPOLIA', '0x1111111111111111111111111111111111111111')).toBe(
      'Test protocol',
    );
  });

  it('findAllowlistLabel returns null when rows are empty', () => {
    expect(findAllowlistLabel([], 'sepolia', ROW.contractAddress)).toBeNull();
  });

  it('findAllowlistLabel returns null when label is missing or whitespace', () => {
    const row = { ...ROW, label: '  ' };
    expect(findAllowlistLabel([row], 'sepolia', ROW.contractAddress)).toBeNull();
  });

  it('buildAllowlistAnnouncePayload returns minimal payload for remove action', () => {
    const payload = buildAllowlistAnnouncePayload({ parentId: PARENT, action: 'remove', row: ROW });
    expect(payload).toEqual({
      parent_id: PARENT,
      entry_id: ROW.id,
      action: 'remove',
    });
    expect(payload.chain).toBeUndefined();
  });
});

describe('squad allowlist command wrappers', () => {
  it('listSquadContractAllowlist sends list_squad_contract_allowlist', async () => {
    mockedInvoke.mockResolvedValueOnce([ROW]);
    await listSquadContractAllowlist(PARENT);
    expect(mockedInvoke).toHaveBeenCalledWith('list_squad_contract_allowlist', { parentId: PARENT });
  });

  it('listSquadContractAllowlist returns empty array when not in Tauri', async () => {
    vi.unstubAllGlobals();
    await expect(listSquadContractAllowlist(PARENT)).resolves.toEqual([]);
  });

  it('listSquadContractAllowlist returns empty array when parentId is empty', async () => {
    mockedInvoke.mockResolvedValueOnce([ROW]);
    await expect(listSquadContractAllowlist('  ')).resolves.toEqual([]);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it('upsertSquadContractAllowlist sends upsert_squad_contract_allowlist with trimmed fields', async () => {
    mockedInvoke.mockResolvedValueOnce(ROW);
    await upsertSquadContractAllowlist({
      parentId: ` ${PARENT} `,
      chain: ' sepolia ',
      contractAddress: ' 0x2222222222222222222222222222222222222222 ',
      label: 'Protocol',
      abiRef: '  abi-1  ',
      notes: '  note  ',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('upsert_squad_contract_allowlist', {
      parentId: PARENT,
      chain: 'sepolia',
      contractAddress: '0x2222222222222222222222222222222222222222',
      label: 'Protocol',
      abiRef: 'abi-1',
      notes: 'note',
    });
  });

  it('upsertSquadContractAllowlist normalizes empty abiRef and notes to null', async () => {
    mockedInvoke.mockResolvedValueOnce(ROW);
    await upsertSquadContractAllowlist({
      parentId: PARENT,
      chain: 'sepolia',
      contractAddress: '0x2222222222222222222222222222222222222222',
      label: 'Protocol',
      abiRef: '  ',
      notes: '',
    });
    expect(mockedInvoke).toHaveBeenCalledWith(
      'upsert_squad_contract_allowlist',
      expect.objectContaining({ abiRef: null, notes: null }),
    );
  });

  it('removeSquadContractAllowlist sends remove_squad_contract_allowlist with trimmed inputs', async () => {
    await removeSquadContractAllowlist(` ${PARENT} `, ` ${ROW.id} `);
    expect(mockedInvoke).toHaveBeenCalledWith('remove_squad_contract_allowlist', {
      parentId: PARENT,
      id: ROW.id,
    });
  });

  it('evmSendSquadAllowlistedContractCall sends allowlisted send with defaults', async () => {
    mockedInvoke.mockResolvedValueOnce({
      txHash: '0xabc',
      network: 'sepolia',
      chainId: 11155111,
    });
    const result = await evmSendSquadAllowlistedContractCall({
      parentId: PARENT,
      network: 'sepolia',
      to: '0x2222222222222222222222222222222222222222',
      valueWei: '1000',
      dataHex: '0x1234',
    });
    expect(result.ok).toBe(true);
    expect(mockedInvoke).toHaveBeenCalledWith('evm_send_squad_allowlisted_contract_call', {
      parentId: PARENT,
      network: 'sepolia',
      to: '0x2222222222222222222222222222222222222222',
      valueWei: '1000',
      dataHex: '0x1234',
      waitForConfirmation: false,
    });
  });

  it('evmSendSquadAllowlistedContractCall normalizes empty value and data', async () => {
    mockedInvoke.mockResolvedValueOnce({
      txHash: '0xabc',
      network: 'sepolia',
      chainId: 11155111,
    });
    await evmSendSquadAllowlistedContractCall({
      parentId: PARENT,
      network: 'sepolia',
      to: '0x2222222222222222222222222222222222222222',
      valueWei: '  ',
      dataHex: '  ',
      waitForConfirmation: true,
    });
    expect(mockedInvoke).toHaveBeenCalledWith(
      'evm_send_squad_allowlisted_contract_call',
      expect.objectContaining({ valueWei: '0', dataHex: '0x', waitForConfirmation: true }),
    );
  });

  it('evmSendSquadAllowlistedContractCall returns desktop-only message outside Tauri', async () => {
    vi.unstubAllGlobals();
    const result = await evmSendSquadAllowlistedContractCall({
      parentId: PARENT,
      network: 'sepolia',
      to: '0x2222222222222222222222222222222222222222',
      valueWei: '0',
      dataHex: '0x',
    });
    expect(result.ok).toBe(false);
    expect(failureMessage(result)).toContain('desktop app');
  });

  it('evmSendSquadAllowlistedContractCall parses wallet errors on failure', async () => {
    mockedInvoke.mockRejectedValueOnce(new Error('User rejected'));
    const result = await evmSendSquadAllowlistedContractCall({
      parentId: PARENT,
      network: 'sepolia',
      to: '0x2222222222222222222222222222222222222222',
      valueWei: '0',
      dataHex: '0x',
    });
    expect(result.ok).toBe(false);
    expect(failureMessage(result)).toBeTruthy();
  });

  it('evmSendSquadAllowlistedContractCall handles string rejection', async () => {
    mockedInvoke.mockRejectedValueOnce('User rejected');
    const result = await evmSendSquadAllowlistedContractCall({
      parentId: PARENT,
      network: 'sepolia',
      to: '0x2222222222222222222222222222222222222222',
      valueWei: '0',
      dataHex: '0x',
    });
    expect(result.ok).toBe(false);
    expect(failureMessage(result)).toBe('User rejected');
  });

  it('evmSendSquadAllowlistedContractCall handles non-Error object rejection', async () => {
    mockedInvoke.mockRejectedValueOnce({ code: 1 });
    const result = await evmSendSquadAllowlistedContractCall({
      parentId: PARENT,
      network: 'sepolia',
      to: '0x2222222222222222222222222222222222222222',
      valueWei: '0',
      dataHex: '0x',
    });
    expect(result.ok).toBe(false);
    expect(failureMessage(result)).toBe('Squad allowlisted send failed.');
  });
});

describe('publishSquadAllowlistAnnounce', () => {
  it('sends a DM when announcements group id is present', async () => {
    const payload = buildAllowlistAnnouncePayload({ parentId: PARENT, action: 'upsert', row: ROW });
    await publishSquadAllowlistAnnounce('announcements-group', payload);
    expect(mockedSendDmMessage).toHaveBeenCalledWith(
      'announcements-group',
      formatAllowlistAnnounceMessage(payload),
      '',
      { virtualBucket: 'inbox' },
    );
  });

  it('is a no-op when announcements group id is empty', async () => {
    const payload = buildAllowlistAnnouncePayload({ parentId: PARENT, action: 'upsert', row: ROW });
    await publishSquadAllowlistAnnounce('  ', payload);
    expect(mockedSendDmMessage).not.toHaveBeenCalled();
  });
});
