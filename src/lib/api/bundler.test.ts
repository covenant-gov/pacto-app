import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  classifyPimlicoApiKey,
  clearPimlicoApiKey,
  getBundlerStatus,
  setPimlicoApiKey,
} from './bundler';

vi.mock('@tauri-apps/api/core');

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockReset();
});

describe('getBundlerStatus', () => {
  it('sends get_bundler_status with network', async () => {
    mockedInvoke.mockResolvedValueOnce({ source: 'pimlico', hasStoredKey: true });
    const result = await getBundlerStatus('sepolia');
    expect(mockedInvoke).toHaveBeenCalledWith('get_bundler_status', { network: 'sepolia' });
    expect(result).toEqual({ source: 'pimlico', hasStoredKey: true });
  });

  it('maps unknown source to none and missing hasStoredKey to false', async () => {
    mockedInvoke.mockResolvedValueOnce({ source: 'nope' });
    const result = await getBundlerStatus('sepolia');
    expect(result).toEqual({ source: 'none', hasStoredKey: false });
  });
});

describe('setPimlicoApiKey', () => {
  it('sends set_pimlico_api_key with key', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await setPimlicoApiKey('pim_test');
    expect(mockedInvoke).toHaveBeenCalledWith('set_pimlico_api_key', { key: 'pim_test' });
  });
});

describe('clearPimlicoApiKey', () => {
  it('sends clear_pimlico_api_key', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await clearPimlicoApiKey();
    expect(mockedInvoke).toHaveBeenCalledWith('clear_pimlico_api_key');
  });
});

describe('classifyPimlicoApiKey', () => {
  it('accepts a trimmed pim_ key', () => {
    expect(classifyPimlicoApiKey('  pim_abc123  ')).toEqual({ ok: true, key: 'pim_abc123' });
  });

  it('rejects empty or whitespace', () => {
    expect(classifyPimlicoApiKey('')).toEqual({ ok: false, error: 'empty' });
    expect(classifyPimlicoApiKey('   ')).toEqual({ ok: false, error: 'empty' });
    expect(classifyPimlicoApiKey('pim_has space')).toEqual({ ok: false, error: 'empty' });
  });

  it('rejects URLs and Alchemy hosts', () => {
    expect(classifyPimlicoApiKey('https://api.pimlico.io/v2/11155111/rpc?apikey=x')).toEqual({
      ok: false,
      error: 'url',
    });
    expect(classifyPimlicoApiKey('https://eth-sepolia.g.alchemy.com/v2/test-key')).toEqual({
      ok: false,
      error: 'url',
    });
  });
});
