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
vi.mock('../squad/squad-roster-binding', () => ({
  resolveSquadRosterEvmAddress: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { maybeBootstrapWarGameCrew, startWarGameDeploy } from './start-war-game-deploy';
import { runOnChainInBackground } from '../evm/on-chain-background';
import { announceWarGameUpdated } from './war-game-announce';
import { resolveSquadRosterEvmAddress } from '../squad/squad-roster-binding';
import { getAddress } from 'viem';

const mockedInvoke = vi.mocked(invoke);
const mockedRun = vi.mocked(runOnChainInBackground);

const PARENT = 'parent-1';
const CAPTAIN = '0x1111111111111111111111111111111111111111';
const CREW = '0x2222222222222222222222222222222222222222';
const QM = '0x3333333333333333333333333333333333333333';

describe('startWarGameDeploy', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedRun.mockClear();
    vi.mocked(announceWarGameUpdated).mockClear();
    vi.mocked(resolveSquadRosterEvmAddress).mockReset();
    vi.mocked(resolveSquadRosterEvmAddress).mockResolvedValue(CAPTAIN);
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
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });

  it('bootstraps remaining roster when the starter is captain', async () => {
    mockedInvoke
      .mockResolvedValueOnce({
        txHash: '0xabc',
        chain: 'sepolia',
        chainId: 11155111,
        topHatId: '1',
        safeAddress: '0x2',
        quartermaster: QM,
        mutinyModule: '0x4',
        treasuryAuthority: '0x5',
        squadAdminProxy: '0x6',
        round: '1',
        gameSquadId: '0x7',
        sponsorAddress: '0x8',
        retiredSponsor: null,
        providerPayload: '{}',
        infraRowId: 'pacto-gov-wargame-parent-1',
      })
      .mockResolvedValueOnce({ txHash: '0xboot' });
    const onComplete = vi.fn();
    startWarGameDeploy({
      parentId: PARENT,
      captain: CAPTAIN,
      initialDepositWei: '1000',
      memberOptions: [{ address: CAPTAIN }, { address: CREW }],
      onComplete,
    });
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(mockedInvoke).toHaveBeenCalledWith(
      'quartermaster_bootstrap_crew',
      expect.objectContaining({
        network: 'sepolia',
        parentId: PARENT,
        quartermaster: QM,
        candidates: [getAddress(CREW)],
      }),
    );
  });
});

describe('maybeBootstrapWarGameCrew', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    vi.mocked(resolveSquadRosterEvmAddress).mockReset();
  });

  it('skips when the starter is not the captain', async () => {
    vi.mocked(resolveSquadRosterEvmAddress).mockResolvedValue(CREW);
    await expect(
      maybeBootstrapWarGameCrew({
        parentId: PARENT,
        captain: CAPTAIN,
        quartermaster: QM,
        memberOptions: [{ address: CAPTAIN }, { address: CREW }],
      }),
    ).resolves.toBe('skipped');
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});
