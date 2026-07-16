import { describe, expect, it } from 'vitest';
import {
  allMembersShareEvmAddress,
  allMembersShareEvmState,
  checklistGlyph,
  isHatsSponsoredAddress,
  mintCrewHatsState,
  permittedByAddressFromExtStatus,
} from './squad-sponsor-crew';
import { bootstrapCrewCandidates } from './start-pacto-gov-and-sponsor-deploy';

describe('checklistGlyph', () => {
  it('maps three states', () => {
    expect(checklistGlyph('not_started')).toBe('○');
    expect(checklistGlyph('pending')).toBe('⏳');
    expect(checklistGlyph('done')).toBe('✓');
  });
});

describe('allMembersShareEvmState', () => {
  it('is not_started with no members or no shares', () => {
    expect(allMembersShareEvmState([], { a: '0x1' })).toBe('not_started');
    expect(allMembersShareEvmState(['npub1'], {})).toBe('not_started');
  });

  it('is pending when some share', () => {
    expect(allMembersShareEvmState(['npub1', 'npub2'], { npub1: '0xabc' })).toBe('pending');
  });

  it('is done when all share', () => {
    expect(
      allMembersShareEvmState(['npub1', 'npub2'], { npub1: '0xabc', npub2: '  0xdef  ' }),
    ).toBe('done');
    expect(
      allMembersShareEvmAddress(['npub1', 'npub2'], { npub1: '0xabc', npub2: '0xdef' }),
    ).toBe(true);
  });
});

describe('mintCrewHatsState', () => {
  const members = ['a', 'b'];
  const roster = { a: '0xAAA', b: '0xBBB' };

  it('not_started without governance', () => {
    expect(
      mintCrewHatsState({
        hasGovernance: false,
        channelMembers: members,
        squadMemberEvmByNpub: roster,
        captainWearers: ['0xaaa'],
        crewWearers: [],
      }),
    ).toBe('not_started');
  });

  it('pending when some wear hats', () => {
    expect(
      mintCrewHatsState({
        hasGovernance: true,
        channelMembers: members,
        squadMemberEvmByNpub: roster,
        captainWearers: ['0xAAA'],
        crewWearers: [],
      }),
    ).toBe('pending');
  });

  it('done when all shared EVMs wear captain or crew', () => {
    expect(
      mintCrewHatsState({
        hasGovernance: true,
        channelMembers: members,
        squadMemberEvmByNpub: roster,
        captainWearers: ['0xaaa'],
        crewWearers: ['0xbbb'],
      }),
    ).toBe('done');
  });
});

describe('permittedByAddressFromExtStatus', () => {
  it('maps permitted flags', () => {
    expect(
      permittedByAddressFromExtStatus([
        { address: '0xAbC', permitted: true },
        { address: '0xdef', permitted: false },
      ]),
    ).toEqual({ '0xabc': true, '0xdef': false });
  });
});

describe('isHatsSponsoredAddress', () => {
  it('true for captain or crew wearers', () => {
    expect(isHatsSponsoredAddress('0xAaA', ['0xaaa'], [])).toBe(true);
    expect(isHatsSponsoredAddress('0xbbb', [], ['0xBBB'])).toBe(true);
    expect(isHatsSponsoredAddress('0xccc', ['0xaaa'], ['0xbbb'])).toBe(false);
  });
});

describe('bootstrapCrewCandidates', () => {
  it('excludes captain and duplicates', () => {
    expect(
      bootstrapCrewCandidates(
        [
          { address: '0x1111111111111111111111111111111111111111' },
          { address: '0x2222222222222222222222222222222222222222' },
          { address: '0x1111111111111111111111111111111111111111' },
        ],
        '0x1111111111111111111111111111111111111111',
      ),
    ).toEqual(['0x2222222222222222222222222222222222222222']);
  });
});
