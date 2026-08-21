import { describe, expect, it } from 'vitest';
import {
  isWarGameArchiveView,
  parseWarGameDelaySecs,
  parseWarGamePriorRounds,
  parseWarGameRoundNumber,
  parseWarGameSponsorAddress,
  parseWarGameStackMeta,
  warGameDelayMinutes,
  warGameRoundSponsorRow,
  warGameVisibleRounds,
} from './war-game-payload';
import type { SquadInfraDto } from './api';
import { WAR_GAME_SQUAD_PARAMS } from './squad-params';

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
    expect(parseWarGameStackMeta(JSON.stringify({ status: 'pending_sponsor' }))).toEqual({
      status: 'pending_sponsor',
      round: '',
    });
  });
});

describe('round history helpers', () => {
  it('parses round numbers and visible 1..=active range', () => {
    expect(parseWarGameRoundNumber(null)).toBe(0);
    expect(parseWarGameRoundNumber(JSON.stringify({ round: '3' }))).toBe(3);
    expect(warGameVisibleRounds(JSON.stringify({ round: '3' }))).toEqual([1, 2, 3]);
    expect(warGameVisibleRounds('{}')).toEqual([1]);
  });

  it('treats a viewed older round as archive', () => {
    expect(isWarGameArchiveView(1, 3)).toBe(true);
    expect(isWarGameArchiveView(3, 3)).toBe(false);
    expect(isWarGameArchiveView(0, 3)).toBe(false);
  });

  it('reads priorRounds snapshots', () => {
    expect(
      parseWarGamePriorRounds(
        JSON.stringify({
          round: '3',
          priorRounds: [
            { round: '1', sponsor: SPONSOR, gameSquadId: '0xaa' },
            { round: 2 },
          ],
        }),
      ),
    ).toEqual([
      { round: '1', sponsor: SPONSOR, gameSquadId: '0xaa' },
      { round: '2' },
    ]);
  });

  it('uses payload delay when present, otherwise the wargame default', () => {
    expect(parseWarGameDelaySecs(null)).toBe(WAR_GAME_SQUAD_PARAMS.crewChangeDelaySecs);
    expect(warGameDelayMinutes(null)).toBe(5);
    expect(parseWarGameDelaySecs(JSON.stringify({ crewChangeDelaySecs: 120 }))).toBe(120);
    expect(warGameDelayMinutes(JSON.stringify({ crewChangeDelaySecs: 120 }))).toBe(2);
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
