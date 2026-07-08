import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRolesTreeAnnotations } from './parent-dashboard-loaders';

const getNavePirataDeployment = vi.fn();
const getMemberHatWearers = vi.fn();
const getSquadAdminExecutorRoles = vi.fn();

vi.mock('../governance/api', () => ({
  getHatsTree: vi.fn(),
  getMemberHatWearers: (...args: unknown[]) => getMemberHatWearers(...args),
  getNavePirataDeployment: (...args: unknown[]) => getNavePirataDeployment(...args),
  getSquadAdminExecutorRoles: (...args: unknown[]) => getSquadAdminExecutorRoles(...args),
  listTreasuryProposals: vi.fn(),
  treasuryProposalHasVoted: vi.fn(),
}));

vi.mock('../evm/read-plane-limiter', () => ({
  withReadPlaneLimit: (fn: () => Promise<unknown>) => fn(),
}));

const deployment = {
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
    vi.clearAllMocks();
    getNavePirataDeployment.mockResolvedValue(deployment);
    getMemberHatWearers.mockResolvedValue([
      {
        address: captainAddress,
        hats: [{ hatId: deployment.captainHatId, label: 'Captain' }],
      },
      {
        address: crewAddress,
        hats: [{ hatId: deployment.crewHatId, label: 'Crew' }],
      },
    ]);
    getSquadAdminExecutorRoles.mockResolvedValue({
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
      squadAdminProxy: deployment.squadAdminProxy,
      squadAdminChain: 'sepolia',
    });

    expect(result.error).toBe('');
    expect(result.roleLabelByHatId[deployment.captainHatId]).toBe('Captain');
    expect(result.roleLabelByHatId[deployment.crewHatId]).toBe('Crew');
    expect(result.wearerAddressesByHatId[deployment.captainHatId]).toEqual([
      captainAddress.toLowerCase(),
    ]);
    expect(result.wearerAddressesByHatId[deployment.crewHatId]).toEqual([crewAddress.toLowerCase()]);
    expect(result.executorRolesByAddress[captainAddress.toLowerCase()]).toBe('Treasury');
    expect(getNavePirataDeployment).toHaveBeenCalledWith({ network: 'sepolia', topHatId: '3519' });
    expect(getMemberHatWearers).toHaveBeenCalled();
    expect(getSquadAdminExecutorRoles).toHaveBeenCalledTimes(2);
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
    expect(getNavePirataDeployment).not.toHaveBeenCalled();
  });
});
