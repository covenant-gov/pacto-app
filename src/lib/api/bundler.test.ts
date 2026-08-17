import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { getBundlerStatus } from './bundler';

vi.mock('@tauri-apps/api/core');

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockReset();
});

describe('getBundlerStatus', () => {
  it('sends get_bundler_status with network', async () => {
    mockedInvoke.mockResolvedValueOnce({ source: 'pimlico' });
    const result = await getBundlerStatus('sepolia');
    expect(mockedInvoke).toHaveBeenCalledWith('get_bundler_status', { network: 'sepolia' });
    expect(result).toEqual({ source: 'pimlico' });
  });

  it('maps unknown source to none', async () => {
    mockedInvoke.mockResolvedValueOnce({ source: 'nope' });
    const result = await getBundlerStatus('sepolia');
    expect(result).toEqual({ source: 'none' });
  });
});
