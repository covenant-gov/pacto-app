import { describe, expect, it, vi } from 'vitest';
import { getAddress } from 'viem';
import { buildCaptainMemberOptions, startPactoGovDeploy } from './start-pacto-gov-deploy';

vi.mock('../evm/on-chain-background', () => ({
  runOnChainInBackground: vi.fn(),
}));

const addrMe = getAddress('0x897aae53a87e2d69000000000000000000000000');
const addrPeer = getAddress('0xdbe38ac51289df3714cb3e4a104aeb71920af98a');

describe('buildCaptainMemberOptions', () => {
  it('lists every squad member with a shared roster EVM address', () => {
    const opts = buildCaptainMemberOptions(
      {
        'npub-me': addrMe,
        'npub-peer': addrPeer,
      },
      'npub-me',
      (npub) => ({ 'npub-me': 'Alpha', 'npub-peer': 'Beta' })[npub] ?? '',
    );
    expect(opts).toHaveLength(2);
    expect(opts[0].label).toBe('Alpha (you)');
    expect(opts[1].label).toBe('Beta');
    expect(opts[0].address).toBe(addrMe);
  });

  it('skips invalid addresses', () => {
    expect(
      buildCaptainMemberOptions({ 'npub-a': 'not-an-address' }, null, () => ''),
    ).toEqual([]);
  });
});

describe('startPactoGovDeploy', () => {
  it('returns false when squad network is unset', () => {
    const onReject = vi.fn();
    expect(
      startPactoGovDeploy({
        parentId: 'parent-1',
        squadNetwork: null,
        captain: addrMe,
        onComplete: async () => {},
        onReject,
      }),
    ).toBe(false);
    expect(onReject).toHaveBeenCalled();
  });
});
