import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../evm/on-chain-background', () => ({
  runOnChainInBackground: vi.fn((opts: { job: () => Promise<unknown>; onSuccess?: (r: unknown) => unknown }) => {
    void opts.job().then((r) => opts.onSuccess?.(r));
  }),
}));
vi.mock('../../stores/toast', () => ({ showToast: vi.fn() }));
vi.mock('./war-game-announce', () => ({
  announceWarGameUpdated: vi.fn().mockResolvedValue(undefined),
}));

import { invoke } from '@tauri-apps/api/core';
import { startWarGameDeploy } from './start-war-game-deploy';
import { runOnChainInBackground } from '../evm/on-chain-background';
import { announceWarGameUpdated } from './war-game-announce';

const mockedInvoke = vi.mocked(invoke);
const mockedRun = vi.mocked(runOnChainInBackground);

const PARENT = 'parent-1';
const CAPTAIN = '0x1111111111111111111111111111111111111111';

describe('startWarGameDeploy', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedRun.mockClear();
    vi.mocked(announceWarGameUpdated).mockClear();
  });

  it('rejects missing captain', () => {
    expect(
      startWarGameDeploy({
        parentId: PARENT,
        captain: '',
        initialDepositWei: '1000',
        onComplete: vi.fn(),
      }),
    ).toBe(false);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it('rejects zero deposit', () => {
    expect(
      startWarGameDeploy({
        parentId: PARENT,
        captain: CAPTAIN,
        initialDepositWei: '0',
        onComplete: vi.fn(),
      }),
    ).toBe(false);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it('invokes deploy_war_game_for_parent on sepolia', async () => {
    mockedInvoke.mockResolvedValueOnce({
      txHash: '0xabc',
      chain: 'sepolia',
      chainId: 11155111,
      topHatId: '1',
      safeAddress: '0x2',
      quartermaster: '0x3',
      mutinyModule: '0x4',
      treasuryAuthority: '0x5',
      squadAdminProxy: '0x6',
      round: '1',
      gameSquadId: '0x7',
      sponsorAddress: '0x8',
      retiredSponsor: null,
      providerPayload: '{}',
      infraRowId: 'pacto-gov-wargame-parent-1',
    });
    const onComplete = vi.fn();
    expect(
      startWarGameDeploy({
        parentId: PARENT,
        captain: CAPTAIN,
        initialDepositWei: '1000',
        onComplete,
      }),
    ).toBe(true);
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(announceWarGameUpdated).toHaveBeenCalled();
    expect(mockedInvoke).toHaveBeenCalledWith(
      'deploy_war_game_for_parent',
      expect.objectContaining({
        network: 'sepolia',
        parentId: PARENT,
        captain: CAPTAIN,
        signerWallet: 'default',
        initialDepositWei: '1000',
        metadataUri: `pacto://squad/${PARENT}/wargame`,
      }),
    );
  });
});
