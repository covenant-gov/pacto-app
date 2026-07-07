import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  listEvmAccounts,
  addEvmAccountRow,
  importEvmAccountRow,
  updateEvmAccountRow,
  setActiveEvmAccount,
  setDefaultSharedEvmAccount,
  setActiveAdvancedEvmAccount,
  advancedEvmAccounts,
  evmAccountPurposeLabel,
  evmAccountSchemeLabel,
  getActiveAdvancedEvmSignerAddress,
  getActiveEvmSignerAddress,
  getActiveSquadEvmSignerAddress,
  isAdvancedPurposeAccount,
  isSquadPurposeAccount,
  squadEvmAccounts,
  type EvmAccountRow,
} from '../wallet/evm-accounts';

vi.mock('@tauri-apps/api/core');

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockReset();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('evm account purpose helpers', () => {
  const rows: EvmAccountRow[] = [
    {
      id: 's1',
      scheme: 'bip44_v1',
      hdIndex: 0,
      address: '0x1111111111111111111111111111111111111111',
      label: 'Squad',
      purpose: 'squad',
      isActive: true,
      isDefaultShared: true,
      isActiveAdvanced: false,
    },
    {
      id: 'a1',
      scheme: 'imported_private_key',
      hdIndex: null,
      address: '0x2222222222222222222222222222222222222222',
      label: '',
      purpose: 'advanced',
      isActive: false,
      isDefaultShared: false,
      isActiveAdvanced: true,
    },
  ];

  it('filters squad and advanced lists', () => {
    expect(squadEvmAccounts(rows)).toHaveLength(1);
    expect(advancedEvmAccounts(rows)).toHaveLength(1);
    expect(squadEvmAccounts(null)).toEqual([]);
    expect(advancedEvmAccounts(undefined)).toEqual([]);
  });

  it('classifies purpose flags', () => {
    expect(isSquadPurposeAccount(rows[0])).toBe(true);
    expect(isAdvancedPurposeAccount(rows[1])).toBe(true);
  });
});

describe('evm account label helpers', () => {
  it('labels the known schemes', () => {
    expect(evmAccountSchemeLabel('bip44_v1')).toBe('Derived');
    expect(evmAccountSchemeLabel('imported_private_key')).toBe('Imported');
    expect(evmAccountSchemeLabel('other')).toBe('other');
  });

  it('labels squad and advanced purposes', () => {
    expect(evmAccountPurposeLabel('squad')).toBe('Squad');
    expect(evmAccountPurposeLabel('advanced')).toBe('Advanced');
  });
});

describe('active evm signer address', () => {
  it('resolves the active squad signer address', async () => {
    vi.stubGlobal('window', { __TAURI__: {} });
    mockedInvoke.mockResolvedValueOnce([
      {
        id: 'a1',
        scheme: 'bip44_v1',
        hdIndex: 0,
        address: '  0xSquadActive  ',
        label: 'Squad',
        purpose: 'squad',
        isActive: true,
        isDefaultShared: true,
        isActiveAdvanced: false,
      },
      {
        id: 'a2',
        scheme: 'bip44_v1',
        hdIndex: 1,
        address: '0xAdvancedActive',
        label: 'Advanced',
        purpose: 'advanced',
        isActive: false,
        isDefaultShared: false,
        isActiveAdvanced: true,
      },
    ]);
    const address = await getActiveSquadEvmSignerAddress();
    expect(address).toBe('0xSquadActive');
  });

  it('resolves the active advanced signer address', async () => {
    vi.stubGlobal('window', { __TAURI__: {} });
    mockedInvoke.mockResolvedValueOnce([
      {
        id: 'a1',
        scheme: 'bip44_v1',
        hdIndex: 0,
        address: '0xSquadActive',
        label: 'Squad',
        purpose: 'squad',
        isActive: true,
        isDefaultShared: true,
        isActiveAdvanced: false,
      },
      {
        id: 'a2',
        scheme: 'imported_private_key',
        hdIndex: null,
        address: '  0xAdvancedActive  ',
        label: 'Advanced',
        purpose: 'advanced',
        isActive: false,
        isDefaultShared: false,
        isActiveAdvanced: true,
      },
    ]);
    const address = await getActiveAdvancedEvmSignerAddress();
    expect(address).toBe('0xAdvancedActive');
  });

  it('returns null when there is no active signer', async () => {
    vi.stubGlobal('window', { __TAURI__: {} });
    mockedInvoke.mockResolvedValueOnce([]);
    expect(await getActiveSquadEvmSignerAddress()).toBeNull();
    expect(await getActiveAdvancedEvmSignerAddress()).toBeNull();
  });

  it('deprecated getActiveEvmSignerAddress delegates to squad signer', async () => {
    vi.stubGlobal('window', { __TAURI__: {} });
    mockedInvoke.mockResolvedValueOnce([
      {
        id: 'a1',
        scheme: 'bip44_v1',
        hdIndex: 0,
        address: '0xSquadActive',
        label: 'Squad',
        purpose: 'squad',
        isActive: true,
        isDefaultShared: true,
        isActiveAdvanced: false,
      },
    ]);
    expect(await getActiveEvmSignerAddress()).toBe('0xSquadActive');
  });
});

describe('evm-accounts command wrappers', () => {
  it('listEvmAccounts returns null when not running inside Tauri', async () => {
    vi.stubGlobal('window', undefined);
    const result = await listEvmAccounts();
    expect(result).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it('listEvmAccounts sends list_evm_accounts when Tauri is present', async () => {
    vi.stubGlobal('window', { __TAURI__: {} });
    mockedInvoke.mockResolvedValueOnce([]);
    const result = await listEvmAccounts();
    expect(mockedInvoke).toHaveBeenCalledWith('list_evm_accounts');
    expect(result).toEqual([]);
  });

  it('addEvmAccountRow sends add_evm_account with defaults', async () => {
    const row = {
      id: '1',
      scheme: 'bip44_v1',
      hdIndex: 0,
      address: '0xabc',
      label: 'Squad',
      purpose: 'squad',
      isActive: true,
      isDefaultShared: true,
      isActiveAdvanced: false,
    };
    mockedInvoke.mockResolvedValueOnce(row);
    const result = await addEvmAccountRow({
      label: 'Squad',
      setActiveSigner: true,
      setDefaultShared: true,
    });
    expect(mockedInvoke).toHaveBeenCalledWith('add_evm_account', {
      label: 'Squad',
      setActiveSigner: true,
      setDefaultShared: true,
      purpose: 'squad',
    });
    expect(result).toEqual(row);
  });

  it('importEvmAccountRow sends import_evm_account with private key', async () => {
    const row = {
      id: '2',
      scheme: 'imported_private_key',
      hdIndex: null,
      address: '0xdef',
      label: 'Imported',
      purpose: 'squad',
      isActive: false,
      isDefaultShared: false,
      isActiveAdvanced: false,
    };
    mockedInvoke.mockResolvedValueOnce(row);
    const result = await importEvmAccountRow('0xkey');
    expect(mockedInvoke).toHaveBeenCalledWith('import_evm_account', {
      privateKeyHex: '0xkey',
      setActiveSigner: false,
    });
    expect(result).toEqual(row);
  });

  it('updateEvmAccountRow sends update_evm_account with all fields', async () => {
    const row = {
      id: '1',
      scheme: 'bip44_v1',
      hdIndex: 0,
      address: '0xabc',
      label: 'Updated',
      purpose: 'squad',
      isActive: true,
      isDefaultShared: false,
      isActiveAdvanced: false,
    };
    mockedInvoke.mockResolvedValueOnce(row);
    const result = await updateEvmAccountRow({
      accountId: '1',
      label: 'Updated',
      setActiveSigner: true,
      setDefaultShared: false,
    });
    expect(mockedInvoke).toHaveBeenCalledWith('update_evm_account', {
      accountId: '1',
      label: 'Updated',
      setActiveSigner: true,
      setDefaultShared: false,
    });
    expect(result).toEqual(row);
  });

  it('setActiveEvmAccount sends set_active_evm_account', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await setActiveEvmAccount('1');
    expect(mockedInvoke).toHaveBeenCalledWith('set_active_evm_account', { accountId: '1' });
  });

  it('setDefaultSharedEvmAccount sends set_default_shared_evm_account', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await setDefaultSharedEvmAccount('1');
    expect(mockedInvoke).toHaveBeenCalledWith('set_default_shared_evm_account', { accountId: '1' });
  });

  it('setActiveAdvancedEvmAccount sends set_active_advanced_evm_account', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await setActiveAdvancedEvmAccount('1');
    expect(mockedInvoke).toHaveBeenCalledWith('set_active_advanced_evm_account', { accountId: '1' });
  });
});
