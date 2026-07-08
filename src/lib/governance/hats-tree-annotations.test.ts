import { describe, expect, it } from 'vitest';
import {
  formatWearerDisplayLabel,
  memberHatByAddressFromAssignments,
  npubByEvmAddressFromSquadRoster,
  roleLabelByHatIdFromNaveDeployment,
  wearerAddressesByHatIdFromAssignments,
} from './hats-tree-annotations';

const deployment = {
  captainHatId: '100',
  crewHatId: '101',
  squadAdminHatId: '102',
  mutinyRoleHatId: '103',
  quartermasterRoleHatId: '104',
  treasuryAuthorityRoleHatId: '105',
};

describe('roleLabelByHatIdFromNaveDeployment', () => {
  it('maps registry role hat ids to Nave Pirata labels', () => {
    expect(roleLabelByHatIdFromNaveDeployment(deployment)).toEqual({
      '100': 'Captain',
      '101': 'Crew',
      '102': 'Squad Admin',
      '103': 'Mutiny Role',
      '104': 'Quartermaster Role',
      '105': 'Treasury Authority Role',
    });
  });
});

describe('wearerAddressesByHatIdFromAssignments', () => {
  it('inverts member assignments to hat id → lowercase addresses', () => {
    const wearers = wearerAddressesByHatIdFromAssignments([
      {
        address: '0x897aBcdEF1234567890AbCdEf1234567890ABcdEf',
        hats: [
          { hatId: '100', label: 'Captain' },
          { hatId: '102', label: 'Squad Admin' },
        ],
      },
      {
        address: '0x1234567890123456789012345678901234567890',
        hats: [{ hatId: '101', label: 'Crew' }],
      },
    ]);
    expect(wearers).toEqual({
      '100': ['0x897abcdef1234567890abcdef1234567890abcdef'],
      '101': ['0x1234567890123456789012345678901234567890'],
      '102': ['0x897abcdef1234567890abcdef1234567890abcdef'],
    });
  });
});

describe('npubByEvmAddressFromSquadRoster', () => {
  it('inverts squad member EVM roster to address → npub', () => {
    expect(
      npubByEvmAddressFromSquadRoster({
        npub1: '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12',
        npub2: '0x1234567890123456789012345678901234567890',
      }),
    ).toEqual({
      '0xabcdef1234567890abcdef1234567890abcdef12': 'npub1',
      '0x1234567890123456789012345678901234567890': 'npub2',
    });
  });
});

describe('formatWearerDisplayLabel', () => {
  const npubByAddress = {
    '0xabcdef1234567890abcdef1234567890abcdef12': 'npub-captain',
  };

  it('prefers profile display name when roster matches', () => {
    expect(
      formatWearerDisplayLabel(
        '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12',
        npubByAddress,
        () => 'Captain Ada',
      ),
    ).toBe('Captain Ada');
  });

  it('falls back to short address when no roster match', () => {
    expect(
      formatWearerDisplayLabel('0x9999999999999999999999999999999999999999', npubByAddress, () => ''),
    ).toBe('0x9999…9999');
  });
});

describe('memberHatByAddressFromAssignments', () => {
  it('builds address → role label map for Settings', () => {
    expect(
      memberHatByAddressFromAssignments([
        {
          address: '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12',
          hats: [
            { hatId: '100', label: 'Captain' },
            { hatId: '101', label: 'Crew' },
          ],
        },
      ]),
    ).toEqual({
      '0xabcdef1234567890abcdef1234567890abcdef12': 'Captain, Crew',
    });
  });
});
