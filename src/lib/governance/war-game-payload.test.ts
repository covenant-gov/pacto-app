import { describe, expect, it } from 'vitest';
import { parseWarGameSponsorAddress, parseWarGameStackMeta, warGameRoundSponsorRow } from './war-game-payload';
import type { SquadInfraDto } from './api';

const SPONSOR = '0x5555555555555555555555555555555555555555';

function wargameRow(overrides: Partial<SquadInfraDto> = {}): SquadInfraDto {
  return {
    id: 'pgw-1',
    parentId: 'parent-1',
    infraType: 'pacto_gov_wargame',
    chain: 'sepolia',
    canonicalRef: '3655',
    providerPayload: JSON.stringify({
      status: 'active',
      round: '4',
      sponsor: SPONSOR,
    }),
    createdAtMs: 1,
    updatedAtMs: 2,
    ...overrides,
  };
}

describe('parseWarGameStackMeta', () => {
  it('defaults to active with no round', () => {
    expect(parseWarGameStackMeta(null)).toEqual({ status: 'active', round: '' });
    expect(parseWarGameStackMeta('')).toEqual({ status: 'active', round: '' });
    expect(parseWarGameStackMeta('{')).toEqual({ status: 'active', round: '' });
  });

  it('reads active and retired status', () => {
    expect(parseWarGameStackMeta(JSON.stringify({ status: 'active', round: '3' }))).toEqual({
      status: 'active',
      round: '3',
    });
    expect(parseWarGameStackMeta(JSON.stringify({ status: 'retired', round: 4 }))).toEqual({
      status: 'retired',
      round: '4',
    });
  });
});

describe('parseWarGameSponsorAddress', () => {
  it('reads a round-clone address from the payload', () => {
    expect(parseWarGameSponsorAddress(JSON.stringify({ sponsor: SPONSOR }))).toBe(SPONSOR);
  });

  it('rejects missing or invalid values', () => {
    expect(parseWarGameSponsorAddress(null)).toBe('');
    expect(parseWarGameSponsorAddress('')).toBe('');
    expect(parseWarGameSponsorAddress('{')).toBe('');
    expect(parseWarGameSponsorAddress(JSON.stringify({ sponsor: 'not-an-address' }))).toBe('');
    expect(parseWarGameSponsorAddress(JSON.stringify({ sponsor: '0x123' }))).toBe('');
  });
});

describe('warGameRoundSponsorRow', () => {
  it('points canonicalRef at the round clone without changing infraType', () => {
    const row = warGameRoundSponsorRow(wargameRow());
    expect(row?.canonicalRef).toBe(SPONSOR);
    expect(row?.infraType).toBe('pacto_gov_wargame');
    expect(row?.chain).toBe('sepolia');
  });

  it('returns null when the row is not wargame or has no sponsor', () => {
    expect(warGameRoundSponsorRow(null)).toBeNull();
    expect(
      warGameRoundSponsorRow(wargameRow({ infraType: 'sponsor', canonicalRef: SPONSOR })),
    ).toBeNull();
    expect(warGameRoundSponsorRow(wargameRow({ providerPayload: '{}' }))).toBeNull();
  });
});
