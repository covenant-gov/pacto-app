import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  fetchSquadMemberEvmByNpub,
  fetchDashboardChannelMembers,
  fetchTreasuryProposalVoteMap,
  fetchTreasuryProposals,
  fetchHatsTree,
  fetchSettingsChainMemberMaps,
  fetchRolesTreeAnnotations,
  isSupersededLoaderKey,
} from './parent-dashboard-loaders';
import { getMlsGroupMembers, type MlsGroupMembers } from '../api/nostr';
import {
  getHatsTree,
  getMemberHatWearers,
  getNavePirataDeployment,
  getSquadAdminExecutorRoles,
  listTreasuryProposals,
  treasuryProposalHasVoted,
} from '../governance/api';
import { withReadPlaneLimit } from '../evm/read-plane-limiter';
import type { TreasuryProposalDto } from '../governance/api';

vi.mock('@tauri-apps/api/core');
vi.mock('../api/nostr');
vi.mock('../governance/api');
vi.mock('../evm/read-plane-limiter', () => ({
  withReadPlaneLimit: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedGetMlsGroupMembers = vi.mocked(getMlsGroupMembers);
const mockedListTreasuryProposals = vi.mocked(listTreasuryProposals);
const mockedTreasuryProposalHasVoted = vi.mocked(treasuryProposalHasVoted);
const mockedGetHatsTree = vi.mocked(getHatsTree);
const mockedGetNavePirataDeployment = vi.mocked(getNavePirataDeployment);
const mockedGetMemberHatWearers = vi.mocked(getMemberHatWearers);
const mockedGetSquadAdminExecutorRoles = vi.mocked(getSquadAdminExecutorRoles);
const mockedWithReadPlaneLimit = vi.mocked(withReadPlaneLimit);

beforeEach(() => {
  vi.clearAllMocks();
});

const baseProposal: TreasuryProposalDto = {
  proposalId: '1',
  proposer: '0x1',
  to: '0x2',
  valueWei: '0',
  operation: '0',
  dataHex: '0x',
  deadline: 1,
  snapshot: 1,
  yeas: 1,
  nays: 0,
  captainApproved: false,
  captainDefeated: false,
  executed: false,
  status: 'active',
};

describe('fetchSquadMemberEvmByNpub', () => {
  it('returns empty map when both args are absent', async () => {
    expect(await fetchSquadMemberEvmByNpub(undefined, null)).toEqual({});
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it('invokes list_squad_member_evm with the expected payload shape and keys by npub', async () => {
    mockedInvoke.mockResolvedValueOnce([
      { memberNpub: 'npub-a', evmAddress: '0xAAA', updatedAtMs: 1 },
      { memberNpub: 'npub-b', evmAddress: '0xBBB', updatedAtMs: 2 },
    ]);

    const result = await fetchSquadMemberEvmByNpub('parent-1', 'group-1');

    expect(mockedInvoke).toHaveBeenCalledWith('list_squad_member_evm', {
      parentId: 'group-1',
      altParentId: 'parent-1',
    });
    expect(result).toEqual({ 'npub-a': '0xAAA', 'npub-b': '0xBBB' });
  });

  it('returns empty map when invoke fails', async () => {
    mockedInvoke.mockRejectedValueOnce(new Error('network'));
    expect(await fetchSquadMemberEvmByNpub('parent-1', null)).toEqual({});
  });

  it('returns empty map when the resolved parent id is empty', async () => {
    expect(await fetchSquadMemberEvmByNpub('   ', null)).toEqual({});
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});

describe('fetchDashboardChannelMembers', () => {
  it('returns empty array when groupId is null', async () => {
    expect(await fetchDashboardChannelMembers(null)).toEqual([]);
    expect(mockedGetMlsGroupMembers).not.toHaveBeenCalled();
  });

  it('returns members from getMlsGroupMembers', async () => {
    mockedGetMlsGroupMembers.mockResolvedValueOnce({
      group_id: 'group-1',
      members: ['npub-1', 'npub-2'],
      admins: [],
    });
    expect(await fetchDashboardChannelMembers('group-1')).toEqual(['npub-1', 'npub-2']);
    expect(mockedGetMlsGroupMembers).toHaveBeenCalledWith('group-1');
  });

  it('falls back to empty array when members is missing', async () => {
    mockedGetMlsGroupMembers.mockResolvedValueOnce({
      group_id: 'group-1',
      members: undefined,
      admins: [],
    } as unknown as MlsGroupMembers);
    expect(await fetchDashboardChannelMembers('group-1')).toEqual([]);
  });

  it('returns empty array on error', async () => {
    mockedGetMlsGroupMembers.mockRejectedValueOnce(new Error('mls'));
    expect(await fetchDashboardChannelMembers('group-1')).toEqual([]);
  });
});

describe('fetchTreasuryProposalVoteMap', () => {
  const baseProposals: TreasuryProposalDto[] = [
    baseProposal,
    { ...baseProposal, proposalId: '2', status: 'executed' },
  ];

  it('returns empty map when no proposals are active', async () => {
    const inactive: TreasuryProposalDto = { ...baseProposal, status: 'expired' };
    const result = await fetchTreasuryProposalVoteMap({
      network: 'sepolia',
      treasuryAuthority: '0xAuth',
      proposals: [inactive],
      voterAddress: '0xVoter',
    });
    expect(result).toEqual({});
    expect(mockedWithReadPlaneLimit).not.toHaveBeenCalled();
    expect(mockedTreasuryProposalHasVoted).not.toHaveBeenCalled();
  });

  it('queries each active proposal through the read plane limiter and returns a map', async () => {
    mockedTreasuryProposalHasVoted.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const result = await fetchTreasuryProposalVoteMap({
      network: 'sepolia',
      treasuryAuthority: '0xAuth',
      proposals: baseProposals,
      voterAddress: '0xVoter',
    });

    expect(mockedWithReadPlaneLimit).toHaveBeenCalledTimes(1);
    expect(mockedTreasuryProposalHasVoted).toHaveBeenCalledWith({
      network: 'sepolia',
      treasuryAuthority: '0xAuth',
      proposalId: '1',
      voter: '0xVoter',
    });
    expect(result).toEqual({ '1': true });
  });
});

describe('fetchTreasuryProposals', () => {
  it('sorts proposals by proposalId descending', async () => {
    const rows: TreasuryProposalDto[] = [
      { ...baseProposal, proposalId: '5' },
      { ...baseProposal, proposalId: '10' },
      { ...baseProposal, proposalId: '7' },
    ];
    mockedListTreasuryProposals.mockResolvedValueOnce(rows);

    const result = await fetchTreasuryProposals({ network: 'sepolia', treasuryAuthority: '0xAuth' });

    expect(mockedListTreasuryProposals).toHaveBeenCalledWith({
      network: 'sepolia',
      treasuryAuthority: '0xAuth',
    });
    expect(result.proposals.map((p) => p.proposalId)).toEqual(['10', '7', '5']);
    expect(result.error).toBe('');
  });

  it('returns an error message on failure', async () => {
    mockedListTreasuryProposals.mockRejectedValueOnce(new Error('rpc down'));

    const result = await fetchTreasuryProposals({ network: 'sepolia', treasuryAuthority: '0xAuth' });

    expect(result.proposals).toEqual([]);
    expect(result.error).toBe('rpc down');
  });
});

describe('fetchHatsTree', () => {
  it('returns the tree on success', async () => {
    const tree = {
      hatId: '0x1',
      details: 'Top',
      maxSupply: 1,
      supply: 1,
      active: true,
      children: [],
    };
    mockedGetHatsTree.mockResolvedValueOnce(tree);

    const result = await fetchHatsTree({ network: 'sepolia', topHatId: '0x1' });

    expect(result.tree).toEqual(tree);
    expect(result.error).toBe('');
  });

  it('returns an error message on failure', async () => {
    mockedGetHatsTree.mockRejectedValueOnce(new Error('hats failed'));

    const result = await fetchHatsTree({ network: 'sepolia', topHatId: '0x1' });

    expect(result.tree).toBeNull();
    expect(result.error).toBe('hats failed');
  });
});

describe('fetchSettingsChainMemberMaps', () => {
  const naveDeployment = {
    chain: 'sepolia',
    chainId: 11155111,
    topHatId: '0xTop',
    safe: '0xSafe',
    quartermaster: '0xQm',
    mutinyModule: '0xMutiny',
    treasuryAuthority: '0xAuth',
    squadAdminProxy: '0xAdmin',
    captainHatId: '0xCaptainHat',
    crewHatId: '0xCrewHat',
    squadAdminHatId: '0xAdminHat',
    mutinyRoleHatId: '0xMutinyRoleHat',
    quartermasterRoleHatId: '0xQmRoleHat',
    treasuryAuthorityRoleHatId: '0xTaRoleHat',
    deployedAt: 1,
    deployer: '0xDeployer',
  };

  it('returns empty maps when there are no EVM addresses', async () => {
    const result = await fetchSettingsChainMemberMaps({
      network: 'sepolia',
      topHatId: '0xTop',
      squadAdminProxy: '0xAdmin',
      squadAdminChain: 'sepolia',
      squadMemberEvmByNpub: {},
    });

    expect(result).toEqual({
      memberHatByAddress: {},
      memberRolesByAddress: {},
      error: '',
    });
  });

  it('loads hats when topHatId is provided', async () => {
    mockedGetNavePirataDeployment.mockResolvedValueOnce(naveDeployment);
    mockedGetMemberHatWearers.mockResolvedValueOnce([
      {
        address: '0xabc',
        hats: [{ hatId: '0xCaptainHat', label: 'Captain' }],
      },
    ]);

    const result = await fetchSettingsChainMemberMaps({
      network: 'sepolia',
      topHatId: '0xTop',
      squadAdminProxy: null,
      squadAdminChain: null,
      squadMemberEvmByNpub: { npub1: '0xABC' },
    });

    expect(mockedGetNavePirataDeployment).toHaveBeenCalledWith({ network: 'sepolia', topHatId: '0xTop' });
    expect(result.memberHatByAddress).toEqual({ '0xabc': 'Captain' });
    expect(result.memberRolesByAddress).toEqual({});
    expect(result.error).toBe('');
  });

  it('loads roles when squadAdminProxy is provided', async () => {
    mockedGetSquadAdminExecutorRoles.mockResolvedValueOnce({
      address: '0xabc',
      fullPermission: true,
      paused: false,
      roles: [],
    });

    const result = await fetchSettingsChainMemberMaps({
      network: 'sepolia',
      topHatId: null,
      squadAdminProxy: '0xAdmin',
      squadAdminChain: 'arbitrum',
      squadMemberEvmByNpub: { npub1: '0xABC' },
    });

    expect(mockedGetSquadAdminExecutorRoles).toHaveBeenCalledWith({
      network: 'arbitrum',
      squadAdminProxy: '0xAdmin',
      executorAddress: '0xABC',
    });
    expect(result.memberHatByAddress).toEqual({});
    expect(result.memberRolesByAddress).toEqual({ '0xabc': 'Full' });
    expect(result.error).toBe('');
  });

  it('loads both hats and roles when both ids are provided', async () => {
    mockedGetNavePirataDeployment.mockResolvedValueOnce(naveDeployment);
    mockedGetMemberHatWearers.mockResolvedValueOnce([
      { address: '0xabc', hats: [{ hatId: '0xCrewHat', label: 'Crew' }] },
    ]);
    mockedGetSquadAdminExecutorRoles.mockResolvedValueOnce({
      address: '0xabc',
      fullPermission: false,
      paused: false,
      roles: [{ role: 'Treasurer', enabled: true }],
    });

    const result = await fetchSettingsChainMemberMaps({
      network: 'sepolia',
      topHatId: '0xTop',
      squadAdminProxy: '0xAdmin',
      squadAdminChain: null,
      squadMemberEvmByNpub: { npub1: '0xABC' },
    });

    expect(result.memberHatByAddress).toEqual({ '0xabc': 'Crew' });
    expect(result.memberRolesByAddress).toEqual({ '0xabc': 'Treasurer' });
  });

  it('returns an error message when the on-chain calls fail', async () => {
    mockedGetNavePirataDeployment.mockRejectedValueOnce(new Error('chain error'));

    const result = await fetchSettingsChainMemberMaps({
      network: 'sepolia',
      topHatId: '0xTop',
      squadAdminProxy: null,
      squadAdminChain: null,
      squadMemberEvmByNpub: { npub1: '0xABC' },
    });

    expect(result.memberHatByAddress).toEqual({});
    expect(result.memberRolesByAddress).toEqual({});
    expect(result.error).toBe('chain error');
  });
});

const rolesTreeDeployment = {
  chain: 'sepolia',
  chainId: 11155111,
  topHatId: '3519',
  safe: '0x1111111111111111111111111111111111111111',
  quartermaster: '0x2222222222222222222222222222222222222222',
  mutinyModule: '0x3333333333333333333333333333333333333333',
  treasuryAuthority: '0x4444444444444444444444444444444444444444',
  squadAdminProxy: '0x5555555555555555555555555555555555555555',
  captainHatId: '3519.1.1',
  crewHatId: '3519.1.2',
  squadAdminHatId: '3519.1.3',
  mutinyRoleHatId: '3519.1.4',
  quartermasterRoleHatId: '3519.1.5',
  treasuryAuthorityRoleHatId: '3519.1.6',
  deployedAt: 1,
  deployer: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
};

const captainAddress = '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa';
const crewAddress = '0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb';

describe('fetchRolesTreeAnnotations', () => {
  beforeEach(() => {
    mockedGetNavePirataDeployment.mockResolvedValue(rolesTreeDeployment);
    mockedGetMemberHatWearers.mockResolvedValue([
      {
        address: captainAddress,
        hats: [{ hatId: rolesTreeDeployment.captainHatId, label: 'Captain' }],
      },
      {
        address: crewAddress,
        hats: [{ hatId: rolesTreeDeployment.crewHatId, label: 'Crew' }],
      },
    ]);
    mockedGetSquadAdminExecutorRoles.mockResolvedValue({
      address: captainAddress,
      fullPermission: false,
      paused: false,
      roles: [{ role: 'Treasury', enabled: true }],
    });
  });

  it('loads merged annotation maps and executor roles for squad members', async () => {
    const result = await fetchRolesTreeAnnotations({
      network: 'sepolia',
      topHatId: '3519',
      squadMemberEvmByNpub: {
        'npub-captain': captainAddress,
        'npub-crew': crewAddress,
      },
      squadAdminProxy: rolesTreeDeployment.squadAdminProxy,
      squadAdminChain: 'sepolia',
    });

    expect(result.error).toBe('');
    expect(result.roleLabelByHatId[rolesTreeDeployment.captainHatId]).toBe('Captain');
    expect(result.roleLabelByHatId[rolesTreeDeployment.crewHatId]).toBe('Crew');
    expect(result.wearerAddressesByHatId[rolesTreeDeployment.captainHatId]).toEqual([
      captainAddress.toLowerCase(),
    ]);
    expect(result.wearerAddressesByHatId[rolesTreeDeployment.crewHatId]).toEqual([crewAddress.toLowerCase()]);
    expect(result.executorRolesByAddress[captainAddress.toLowerCase()]).toBe('Treasury');
    expect(mockedGetNavePirataDeployment).toHaveBeenCalledWith({ network: 'sepolia', topHatId: '3519' });
    expect(mockedGetMemberHatWearers).toHaveBeenCalled();
    expect(mockedGetSquadAdminExecutorRoles).toHaveBeenCalledTimes(2);
  });

  it('returns empty maps when no squad member EVM addresses are shared', async () => {
    const result = await fetchRolesTreeAnnotations({
      network: 'sepolia',
      topHatId: '3519',
      squadMemberEvmByNpub: {},
    });
    expect(result).toEqual({
      roleLabelByHatId: {},
      wearerAddressesByHatId: {},
      executorRolesByAddress: {},
      error: '',
    });
    expect(mockedGetNavePirataDeployment).not.toHaveBeenCalled();
  });
});

describe('isSupersededLoaderKey', () => {
  it('detects superseded loader keys', () => {
    expect(isSupersededLoaderKey('active', 'captured')).toBe(true);
    expect(isSupersededLoaderKey('same', 'same')).toBe(false);
  });
});
