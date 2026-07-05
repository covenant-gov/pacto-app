import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  login,
  loginWithRecoveryPhrase,
  createAccount,
  connect,
  checkAnyAccountExists,
  getCurrentAccount,
  getEvmAddress,
  setEvmAddress,
  signEvmHash,
  listAllAccounts,
  exportRecoveryPhrase,
  exportEvmAccountKeyPlaintext,
} from './auth';

vi.mock('@tauri-apps/api/core');
vi.mock('../utils/dm-debug', () => ({
  dmLog: vi.fn(),
  dmWarn: vi.fn(),
  dmError: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockReset();
});

describe('auth command wrappers', () => {
  it('login sends login with importKey', async () => {
    mockedInvoke.mockResolvedValueOnce({ public: 'npub', private: 'nsec' });
    const result = await login('nsec1');
    expect(mockedInvoke).toHaveBeenCalledWith('login', { importKey: 'nsec1' });
    expect(result).toEqual({ public: 'npub', private: 'nsec' });
  });

  it('loginWithRecoveryPhrase sends login_with_recovery_phrase with mnemonic', async () => {
    mockedInvoke.mockResolvedValueOnce({ public: 'npub', private: 'nsec' });
    const result = await loginWithRecoveryPhrase('abandon abandon ... art');
    expect(mockedInvoke).toHaveBeenCalledWith('login_with_recovery_phrase', {
      mnemonic: 'abandon abandon ... art',
    });
    expect(result).toEqual({ public: 'npub', private: 'nsec' });
  });

  it('createAccount sends create_account', async () => {
    mockedInvoke.mockResolvedValueOnce({ public: 'npub', private: 'nsec' });
    const result = await createAccount();
    expect(mockedInvoke).toHaveBeenCalledWith('create_account');
    expect(result).toEqual({ public: 'npub', private: 'nsec' });
  });

  it('connect sends connect', async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    const result = await connect();
    expect(mockedInvoke).toHaveBeenCalledWith('connect');
    expect(result).toBe(true);
  });

  it('checkAnyAccountExists sends check_any_account_exists', async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    const result = await checkAnyAccountExists();
    expect(mockedInvoke).toHaveBeenCalledWith('check_any_account_exists');
    expect(result).toBe(true);
  });

  it('getCurrentAccount sends get_current_account', async () => {
    mockedInvoke.mockResolvedValueOnce('npub1');
    const result = await getCurrentAccount();
    expect(mockedInvoke).toHaveBeenCalledWith('get_current_account');
    expect(result).toBe('npub1');
  });

  it('getEvmAddress sends get_evm_address', async () => {
    mockedInvoke.mockResolvedValueOnce('0xabc');
    const result = await getEvmAddress();
    expect(mockedInvoke).toHaveBeenCalledWith('get_evm_address');
    expect(result).toBe('0xabc');
  });

  it('setEvmAddress sends set_evm_address then updates profile', async () => {
    mockedInvoke
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    await setEvmAddress('0xabc');
    expect(mockedInvoke).toHaveBeenCalledWith('set_evm_address', { address: '0xabc' });
    expect(mockedInvoke).toHaveBeenCalledWith('update_profile', {
      name: '',
      avatar: '',
      banner: '',
      about: '',
    });
  });

  it('signEvmHash sends sign_evm_hash with hashHex', async () => {
    mockedInvoke.mockResolvedValueOnce('0xsignature');
    const result = await signEvmHash('0xdeadbeef');
    expect(mockedInvoke).toHaveBeenCalledWith('sign_evm_hash', { hashHex: '0xdeadbeef' });
    expect(result).toBe('0xsignature');
  });

  it('listAllAccounts sends list_all_accounts', async () => {
    mockedInvoke.mockResolvedValueOnce(['npub1', 'npub2']);
    const result = await listAllAccounts();
    expect(mockedInvoke).toHaveBeenCalledWith('list_all_accounts');
    expect(result).toEqual(['npub1', 'npub2']);
  });

  it('exportRecoveryPhrase sends get_seed and returns trimmed seed', async () => {
    mockedInvoke.mockResolvedValueOnce('  seed phrase  ');
    const result = await exportRecoveryPhrase();
    expect(mockedInvoke).toHaveBeenCalledWith('get_seed');
    expect(result).toBe('seed phrase');
  });

  it('exportRecoveryPhrase throws when seed is empty', async () => {
    mockedInvoke.mockResolvedValueOnce(null);
    await expect(exportRecoveryPhrase()).rejects.toThrow(
      'No recovery phrase is stored for this account'
    );
  });

  it('exportEvmAccountKeyPlaintext sends export_evm_account_key_plaintext with accountId', async () => {
    mockedInvoke.mockResolvedValueOnce('0xkey');
    const result = await exportEvmAccountKeyPlaintext('acc-1');
    expect(mockedInvoke).toHaveBeenCalledWith('export_evm_account_key_plaintext', {
      accountId: 'acc-1',
    });
    expect(result).toBe('0xkey');
  });
});
