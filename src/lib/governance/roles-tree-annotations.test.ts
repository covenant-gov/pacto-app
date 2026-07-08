import { describe, expect, it } from 'vitest';
import type { HatTreeNodeDto } from './api';
import {
  collectAnnotatedRolesTreeNodes,
  formatWearerDisplayLabel,
  mergeRolesTreeAnnotationMaps,
  npubByEvmAddressFromSquadRoster,
} from './hats-tree-annotations';

/** Sepolia-like top hat from live deploy smoke (tree id 3519). */
const TOP_HAT_ID = '3519';

const deployment = {
  captainHatId: `${TOP_HAT_ID}.1.1`,
  crewHatId: `${TOP_HAT_ID}.1.2`,
  squadAdminHatId: `${TOP_HAT_ID}.1.3`,
  mutinyRoleHatId: `${TOP_HAT_ID}.1.4`,
  quartermasterRoleHatId: `${TOP_HAT_ID}.1.5`,
  treasuryAuthorityRoleHatId: `${TOP_HAT_ID}.1.6`,
};

const captainAddress = '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa';
const crewAddress = '0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb';

const assignments = [
  {
    address: captainAddress,
    hats: [{ hatId: deployment.captainHatId, label: 'Captain' }],
  },
  {
    address: crewAddress,
    hats: [{ hatId: deployment.crewHatId, label: 'Crew' }],
  },
];

function hatNode(id: string, children: HatTreeNodeDto[] = []): HatTreeNodeDto {
  return {
    hatId: id,
    details: id === TOP_HAT_ID ? 'Nave Pirata' : 'Role hat',
    maxSupply: 1,
    supply: 1,
    active: true,
    children,
  };
}

describe('mergeRolesTreeAnnotationMaps', () => {
  it('merges registry hat ids and member wears into annotation maps', () => {
    const maps = mergeRolesTreeAnnotationMaps(deployment, assignments);
    expect(maps.roleLabelByHatId[deployment.captainHatId]).toBe('Captain');
    expect(maps.roleLabelByHatId[deployment.crewHatId]).toBe('Crew');
    expect(maps.wearerAddressesByHatId[deployment.captainHatId]).toEqual([
      captainAddress.toLowerCase(),
    ]);
    expect(maps.wearerAddressesByHatId[deployment.crewHatId]).toEqual([crewAddress.toLowerCase()]);
  });
});

describe('collectAnnotatedRolesTreeNodes', () => {
  it('finds labeled nodes with wearers in a nested on-chain tree', () => {
    const tree = hatNode(TOP_HAT_ID, [
      hatNode(deployment.captainHatId),
      hatNode(deployment.crewHatId),
      hatNode(deployment.squadAdminHatId),
    ]);
    const maps = mergeRolesTreeAnnotationMaps(deployment, assignments);
    expect(collectAnnotatedRolesTreeNodes(tree, maps)).toEqual([
      {
        hatId: deployment.captainHatId,
        roleLabel: 'Captain',
        wearerAddresses: [captainAddress.toLowerCase()],
      },
      {
        hatId: deployment.crewHatId,
        roleLabel: 'Crew',
        wearerAddresses: [crewAddress.toLowerCase()],
      },
      {
        hatId: deployment.squadAdminHatId,
        roleLabel: 'Squad Admin',
        wearerAddresses: [],
      },
    ]);
  });
});

describe('roles tree wearer display', () => {
  it('resolves captain and crew profile names from inverted squad roster', () => {
    const roster = {
      'npub-captain': captainAddress,
      'npub-crew': crewAddress,
    };
    const npubByAddress = npubByEvmAddressFromSquadRoster(roster);
    const displayNameForNpub = (npub: string) =>
      ({ 'npub-captain': 'Captain Ada', 'npub-crew': 'Crew Bob' })[npub] ?? '';

    expect(formatWearerDisplayLabel(captainAddress, npubByAddress, displayNameForNpub)).toBe(
      'Captain Ada',
    );
    expect(formatWearerDisplayLabel(crewAddress, npubByAddress, displayNameForNpub)).toBe('Crew Bob');
  });
});
