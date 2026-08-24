import { describe, expect, it } from 'vitest';
import {
  formatWearerDisplayLabel,
  hatChecksForRolesTree,
  memberHatByAddressFromAssignments,
  memberHatByAddressFromWearerMaps,
  npubByEvmAddressFromSquadRoster,
  protocolWearerCandidateAddresses,
  protocolWearerLabelByAddress,
  roleLabelByHatIdFromNaveDeployment,
  wearerAddressesByHatIdFromAssignments,
  isAddressWearingHat,
  wearersForRoleLabel,
} from './hats-tree-annotations';
import { hatIdToHex } from './pretty-hat-id';

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

describe('protocolWearerCandidateAddresses', () => {
  it('dedupes valid module addresses from payload', () => {
    expect(
      protocolWearerCandidateAddresses({
        safe: '0x1111111111111111111111111111111111111111',
        treasuryAuthority: '0x2222222222222222222222222222222222222222',
        mutinyModule: '0x1111111111111111111111111111111111111111',
        quartermaster: 'not-an-address',
      }),
    ).toEqual([
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ]);
  });
});

describe('protocolWearerLabelByAddress', () => {
  it('labels known protocol modules', () => {
    expect(
      protocolWearerLabelByAddress({
        treasuryAuthority: '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12',
      })['0xabcdef1234567890abcdef1234567890abcdef12'],
    ).toBe('Treasury Authority');
  });
});

describe('hatChecksForRolesTree', () => {
  it('prepends top hat when missing from role checks', () => {
    const checks = hatChecksForRolesTree(deployment, '99');
    expect(checks[0]).toEqual({ hatId: '99', label: 'Top hat' });
    expect(checks.some((c) => c.hatId === '100')).toBe(true);
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

  it('uses known protocol labels before short address', () => {
    expect(
      formatWearerDisplayLabel(
        '0x9999999999999999999999999999999999999999',
        npubByAddress,
        () => '',
        { '0x9999999999999999999999999999999999999999': 'Treasury Authority' },
      ),
    ).toBe('Treasury Authority');
  });

  it('falls back to short address when no roster match', () => {
    expect(
      formatWearerDisplayLabel('0x9999999999999999999999999999999999999999', npubByAddress, () => ''),
    ).toBe('0x999999…999999');
  });
});

describe('wearersForRoleLabel', () => {
  const charlie = '0xcccccccccccccccccccccccccccccccccccccccc';
  const bravo = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const alpha = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  it('returns empty when maps are empty', () => {
    expect(wearersForRoleLabel({}, {}, 'Crew')).toEqual([]);
  });

  it('lists crew-hat wearers from matching maps', () => {
    expect(
      wearersForRoleLabel(
        { '3659.1.1': 'Captain', '3659.2.1': 'Crew' },
        { '3659.1.1': [alpha], '3659.2.1': [charlie, bravo] },
        'Crew',
      ),
    ).toEqual([charlie, bravo]);
  });

  it('joins pretty label ids to decimal or hex wearer keys', () => {
    const pretty = '15.2.5.10.1';
    const hex = hatIdToHex(pretty);
    expect(hex).toBeTruthy();
    const decimal = BigInt(hex as string).toString(10);
    expect(
      wearersForRoleLabel({ [pretty]: 'Crew' }, { [decimal]: [charlie] }, 'Crew'),
    ).toEqual([charlie]);
    expect(
      wearersForRoleLabel({ [pretty]: 'Crew' }, { [hex as string]: [bravo] }, 'Crew'),
    ).toEqual([bravo]);
  });

  it('concatenates wearers from every hat labeled Crew', () => {
    expect(
      wearersForRoleLabel(
        { a: 'Crew', b: 'Captain', c: 'Crew' },
        { a: [charlie], b: [alpha], c: [bravo, charlie] },
        'Crew',
      ),
    ).toEqual([charlie, bravo]);
  });
});

describe('isAddressWearingHat', () => {
  const charlie = '0xcccccccccccccccccccccccccccccccccccccccc';
  const bravo = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const pretty = '15.2.5.10.1';
  const hex = hatIdToHex(pretty);
  const decimal = BigInt(hex as string).toString(10);

  it('matches pretty hat id against decimal and hex wearer keys', () => {
    expect(hex).toBeTruthy();
    expect(isAddressWearingHat({ [decimal]: [charlie] }, pretty, charlie)).toBe(true);
    expect(isAddressWearingHat({ [hex as string]: [bravo] }, pretty, bravo)).toBe(true);
  });

  it('matches address case-insensitively', () => {
    expect(
      isAddressWearingHat({ [pretty]: [charlie] }, pretty, charlie.toUpperCase()),
    ).toBe(true);
  });

  it('returns false for empty address or missing hat', () => {
    expect(isAddressWearingHat({ [pretty]: [charlie] }, pretty, '')).toBe(false);
    expect(isAddressWearingHat({ [pretty]: [charlie] }, '99.1', charlie)).toBe(false);
    expect(isAddressWearingHat({}, pretty, charlie)).toBe(false);
  });

  it('returns true for each hat the address wears', () => {
    const wearers = { [pretty]: [charlie], '3659.1.1': [charlie, bravo] };
    expect(isAddressWearingHat(wearers, pretty, charlie)).toBe(true);
    expect(isAddressWearingHat(wearers, '3659.1.1', charlie)).toBe(true);
    expect(isAddressWearingHat(wearers, pretty, bravo)).toBe(false);
  });
});

describe('memberHatByAddressFromWearerMaps', () => {
  it('inverts hat wearers and skips the top-hat label', () => {
    expect(
      memberHatByAddressFromWearerMaps(
        { '100': 'Captain', '101': 'Crew', '1': 'Top hat' },
        { '100': ['0xAa'], '101': ['0xAa', '0xBb'], '1': ['0xCc'] },
      ),
    ).toEqual({
      '0xaa': 'Captain, Crew',
      '0xbb': 'Crew',
    });
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
