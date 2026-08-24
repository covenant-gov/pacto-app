import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import {
  addressesWithHatLabel,
  govMemberOptions,
  labeledRosterWearerOptions,
  mergeWearerAddresses,
} from './gov-member-options';

const A = getAddress('0x1111111111111111111111111111111111111111');
const B = getAddress('0x2222222222222222222222222222222222222222');
const C = getAddress('0x3333333333333333333333333333333333333333');
const MODULE = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

const roster = [
  { address: A, label: 'alice' },
  { address: B.toLowerCase(), label: 'bravo' },
  { address: C, label: 'charlie' },
];

describe('addressesWithHatLabel', () => {
  it('parses Crew-tab comma-separated hat labels', () => {
    expect(
      addressesWithHatLabel(
        {
          [A.toLowerCase()]: 'Captain, Crew',
          [B.toLowerCase()]: 'Crew',
          [C.toLowerCase()]: 'Captain',
        },
        'Crew',
      ),
    ).toEqual([A, B]);
  });

  it('skips junk addresses', () => {
    expect(addressesWithHatLabel({ nope: 'Crew', [B]: 'Crew Lead' }, 'Crew')).toEqual([]);
  });
});

describe('mergeWearerAddresses', () => {
  it('unions, checksums, and keeps first-seen order', () => {
    expect(mergeWearerAddresses([A.toLowerCase(), 'nope'], [B, A], [C])).toEqual([A, B, C]);
  });
});

describe('govMemberOptions', () => {
  it('intersects roster with crew wearers and drops protocol modules', () => {
    expect(
      govMemberOptions({
        roster,
        crewWearers: [B, MODULE, A.toLowerCase()],
        preset: 'crewWearers',
      }),
    ).toEqual([
      { address: A, label: 'alice' },
      { address: B, label: 'bravo' },
    ]);
  });

  it('excludes self from crew wearers', () => {
    expect(
      govMemberOptions({
        roster,
        crewWearers: [A, B],
        excludeAddresses: [A.toLowerCase()],
        preset: 'crewWearers',
      }),
    ).toEqual([{ address: B, label: 'bravo' }]);
  });

  it('returns the Status roster for squadRoster', () => {
    expect(govMemberOptions({ roster, preset: 'squadRoster' })).toEqual([
      { address: A, label: 'alice' },
      { address: B, label: 'bravo' },
      { address: C, label: 'charlie' },
    ]);
  });

  it('lists add-crew candidates as roster minus crew', () => {
    expect(
      govMemberOptions({
        roster,
        crewWearers: [A, B],
        preset: 'squadNotCrew',
      }),
    ).toEqual([{ address: C, label: 'charlie' }]);
  });

  it('dedupes roster rows', () => {
    expect(
      govMemberOptions({
        roster: [
          { address: A.toLowerCase(), label: 'alice' },
          { address: A, label: 'Alice Dup' },
        ],
        preset: 'squadRoster',
      }),
    ).toEqual([{ address: A, label: 'alice' }]);
  });
});

describe('labeledRosterWearerOptions', () => {
  it('is the crewWearers preset', () => {
    expect(labeledRosterWearerOptions([B, MODULE], roster)).toEqual([
      { address: B, label: 'bravo' },
    ]);
  });
});
