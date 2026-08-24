import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { resolveWriterReplicaTarget } from './gov-replica-writer';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveWriterReplicaTarget', () => {
  it('prefers an active war-game stack over live nave', async () => {
    mockedInvoke.mockResolvedValueOnce([
      {
        infraType: 'pacto_gov',
        chain: 'sepolia',
        canonicalRef: '1',
        providerPayload: JSON.stringify({ mutinyModule: '0xlive' }),
      },
      {
        infraType: 'pacto_gov_wargame',
        chain: 'sepolia',
        canonicalRef: '2',
        providerPayload: JSON.stringify({ status: 'active', round: '3', mutinyModule: '0xgame' }),
      },
    ]);
    const target = await resolveWriterReplicaTarget('g1');
    expect(target?.stack).toBe('pacto_gov_wargame');
    expect(target?.round).toBe('3');
    expect(target?.mutinyModule).toBe('0xgame');
  });

  it('uses live nave when the war-game stack is retired', async () => {
    mockedInvoke.mockResolvedValueOnce([
      {
        infraType: 'pacto_gov',
        chain: 'sepolia',
        canonicalRef: '1',
        providerPayload: JSON.stringify({ mutinyModule: '0xlive' }),
      },
      {
        infraType: 'pacto_gov_wargame',
        chain: 'sepolia',
        canonicalRef: '2',
        providerPayload: JSON.stringify({ status: 'retired', round: '3' }),
      },
    ]);
    const target = await resolveWriterReplicaTarget('g1');
    expect(target?.stack).toBe('pacto_gov');
    expect(target?.round).toBe('');
    expect(target?.mutinyModule).toBe('0xlive');
  });
});
