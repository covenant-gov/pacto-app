import { describe, expect, it } from 'vitest';
import {
  MAX_GOV_DELAY_SECS,
  MIN_GOV_DELAY_SECS,
  PRODUCTION_SQUAD_PARAMS,
  WAR_GAME_SQUAD_PARAMS,
  squadParamsIfCustomized,
  squadParamsToInvoke,
  validateSquadParams,
} from './squad-params';

describe('validateSquadParams', () => {
  it('accepts production defaults', () => {
    expect(validateSquadParams(PRODUCTION_SQUAD_PARAMS)).toBeNull();
  });

  it('accepts war-game 5-minute defaults', () => {
    expect(validateSquadParams(WAR_GAME_SQUAD_PARAMS)).toBeNull();
  });

  it('rejects delay below 1 minute', () => {
    expect(
      validateSquadParams({ ...PRODUCTION_SQUAD_PARAMS, crewChangeDelaySecs: MIN_GOV_DELAY_SECS - 1 }),
    ).toMatch(/1 minute/);
  });

  it('rejects delay above 60 days', () => {
    expect(
      validateSquadParams({ ...PRODUCTION_SQUAD_PARAMS, proposalExpirySecs: MAX_GOV_DELAY_SECS + 1 }),
    ).toMatch(/60 days/);
  });

  it('rejects quorum outside 500–10000', () => {
    expect(validateSquadParams({ ...PRODUCTION_SQUAD_PARAMS, quorumBps: 499 })).toMatch(/quorumBps/);
    expect(validateSquadParams({ ...PRODUCTION_SQUAD_PARAMS, quorumBps: 10_001 })).toMatch(
      /quorumBps/,
    );
  });
});

describe('squadParamsToInvoke', () => {
  it('passes camelCase fields through', () => {
    expect(squadParamsToInvoke(WAR_GAME_SQUAD_PARAMS)).toEqual({
      crewChangeDelaySecs: 300,
      proposalExpirySecs: 300,
      crewVoteMode: 'majority',
      quorumBps: 3000,
    });
  });
});

describe('squadParamsIfCustomized', () => {
  it('returns null when customize is closed', () => {
    expect(squadParamsIfCustomized(false, PRODUCTION_SQUAD_PARAMS)).toBeNull();
  });

  it('returns the draft when customize is open', () => {
    expect(squadParamsIfCustomized(true, WAR_GAME_SQUAD_PARAMS)).toEqual(WAR_GAME_SQUAD_PARAMS);
  });
});
