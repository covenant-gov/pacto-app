import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  hasStoredKey,
  encryptAndSaveKey,
  encryptAndSaveEvmKey,
  loadAndDecryptKey,
  clearStoredKey,
} from './encryption';

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

describe('encryption / key storage command wrappers', () => {
  it('hasStoredKey returns true for non-empty key', async () => {
    mockedInvoke.mockResolvedValueOnce('encrypted-key');
    const result = await hasStoredKey();
    expect(mockedInvoke).toHaveBeenCalledWith('get_pkey');
    expect(result).toBe(true);
  });

  it('hasStoredKey returns false when key is empty', async () => {
    mockedInvoke.mockResolvedValueOnce('');
    const result = await hasStoredKey();
    expect(result).toBe(false);
  });

  it('hasStoredKey returns false on invoke error', async () => {
    mockedInvoke.mockRejectedValueOnce(new Error('backend failure'));
    const result = await hasStoredKey();
    expect(result).toBe(false);
  });

  it('encryptAndSaveKey encrypts then stores pkey', async () => {
    mockedInvoke
      .mockResolvedValueOnce('encrypted-private-key')
      .mockResolvedValueOnce(undefined);
    await encryptAndSaveKey('private-key', '123456');
    expect(mockedInvoke).toHaveBeenCalledWith('encrypt', {
      input: 'private-key',
      password: '123456',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('set_pkey', {
      pkey: 'encrypted-private-key',
    });
  });

  it('encryptAndSaveEvmKey encrypts, stores evm pkey, and sets evm address', async () => {
    mockedInvoke
      .mockResolvedValueOnce('encrypted-evm-key')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    await encryptAndSaveEvmKey('evm-private-key', '0xabc', '123456');
    expect(mockedInvoke).toHaveBeenCalledWith('encrypt', {
      input: 'evm-private-key',
      password: '123456',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('set_evm_pkey', {
      evmPkey: 'encrypted-evm-key',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('set_evm_address', {
      address: '0xabc',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('update_profile', {
      name: '',
      avatar: '',
      banner: '',
      about: '',
    });
  });

  it('loadAndDecryptKey returns decrypted key when PIN is correct', async () => {
    mockedInvoke
      .mockResolvedValueOnce('encrypted-key')
      .mockResolvedValueOnce('decrypted-key');
    const result = await loadAndDecryptKey('123456');
    expect(mockedInvoke).toHaveBeenCalledWith('get_pkey');
    expect(mockedInvoke).toHaveBeenCalledWith('decrypt', {
      ciphertext: 'encrypted-key',
      password: '123456',
    });
    expect(result).toBe('decrypted-key');
  });

  it('loadAndDecryptKey throws when no key is stored', async () => {
    mockedInvoke.mockResolvedValueOnce(null);
    await expect(loadAndDecryptKey('123456')).rejects.toThrow('No stored key found');
  });

  it('loadAndDecryptKey throws Incorrect PIN on decrypt failure', async () => {
    mockedInvoke
      .mockResolvedValueOnce('encrypted-key')
      .mockRejectedValueOnce(new Error('bad pin'));
    await expect(loadAndDecryptKey('000000')).rejects.toThrow('Incorrect PIN');
  });

  it('clearStoredKey sends set_pkey with empty string', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await clearStoredKey();
    expect(mockedInvoke).toHaveBeenCalledWith('set_pkey', { pkey: '' });
  });
});
