/** On-chain RangeValidator bounds for SquadParams delays. */
export const MIN_GOV_DELAY_SECS = 60;
export const MAX_GOV_DELAY_SECS = 60 * 24 * 3600;

export const MIN_QUORUM_BPS = 500;
export const MAX_QUORUM_BPS = 10_000;

export const PRODUCTION_CREW_CHANGE_DELAY_SECS = 7 * 24 * 3600;
export const PRODUCTION_PROPOSAL_EXPIRY_SECS = 7 * 24 * 3600;
export const PRODUCTION_QUORUM_BPS = 3000;

export type CrewVoteMode = 'majority' | 'quorum';

export type SquadParamsInput = {
  crewChangeDelaySecs: number;
  proposalExpirySecs: number;
  crewVoteMode: CrewVoteMode;
  quorumBps: number;
};

export const PRODUCTION_SQUAD_PARAMS: SquadParamsInput = {
  crewChangeDelaySecs: PRODUCTION_CREW_CHANGE_DELAY_SECS,
  proposalExpirySecs: PRODUCTION_PROPOSAL_EXPIRY_SECS,
  crewVoteMode: 'majority',
  quorumBps: PRODUCTION_QUORUM_BPS,
};

export const WAR_GAME_SQUAD_PARAMS: SquadParamsInput = {
  crewChangeDelaySecs: 5 * 60,
  proposalExpirySecs: 5 * 60,
  crewVoteMode: 'majority',
  quorumBps: PRODUCTION_QUORUM_BPS,
};

export function isCrewVoteMode(value: string | null | undefined): value is CrewVoteMode {
  return value === 'majority' || value === 'quorum';
}

export function validateSquadParams(params: SquadParamsInput): string | null {
  if (
    params.crewChangeDelaySecs < MIN_GOV_DELAY_SECS ||
    params.crewChangeDelaySecs > MAX_GOV_DELAY_SECS
  ) {
    return 'crewChangeDelay must be between 1 minute and 60 days';
  }
  if (
    params.proposalExpirySecs < MIN_GOV_DELAY_SECS ||
    params.proposalExpirySecs > MAX_GOV_DELAY_SECS
  ) {
    return 'proposalExpiry must be between 1 minute and 60 days';
  }
  if (params.quorumBps < MIN_QUORUM_BPS || params.quorumBps > MAX_QUORUM_BPS) {
    return 'quorumBps must be between 500 and 10000';
  }
  if (!isCrewVoteMode(params.crewVoteMode)) {
    return 'crewVoteMode must be majority or quorum';
  }
  return null;
}

/** Wire shape for `deploy_nave_pirata_for_parent` / war-game deploy. */
export function squadParamsToInvoke(params: SquadParamsInput): {
  crewChangeDelaySecs: number;
  proposalExpirySecs: number;
  crewVoteMode: CrewVoteMode;
  quorumBps: number;
} {
  return {
    crewChangeDelaySecs: params.crewChangeDelaySecs,
    proposalExpirySecs: params.proposalExpirySecs,
    crewVoteMode: params.crewVoteMode,
    quorumBps: params.quorumBps,
  };
}

/** Closed customize disclosure → omit (backend production defaults). */
export function squadParamsIfCustomized(
  customizing: boolean,
  draft: SquadParamsInput,
): SquadParamsInput | null {
  if (!customizing) return null;
  return { ...draft };
}
