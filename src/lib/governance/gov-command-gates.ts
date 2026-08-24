import type { MutinyStatusDto, QuartermasterStatusDto } from './api';
import { isCrewOffboardActive } from './crew-offboard';
import {
  gateBlockedByMutinyMode,
  gatePermissionlessSigner,
  gateRequiresCaptain,
  gateRequiresCaptainOrCrew,
  gateRequiresCrew,
  type CtaGate,
  type GovernancePrivilege,
} from './governance-privilege';
import { isMutinyActive } from './gov-proposal-lists';
import {
  labeledWearerOptions,
  randomizeCaptainCandidates,
  type MemberEvmOption,
} from './war-game-captain';

export const PENDING_GATE: CtaGate = { enabled: false, reason: 'governance.status.loading' };

export type GovCommandGates = {
  treasury: CtaGate;
  crew: CtaGate;
  captain: CtaGate;
  startMutiny: CtaGate;
  proposeOffboard: CtaGate;
  qmRoster: CtaGate;
  exec: CtaGate;
  resign: CtaGate;
  randomize: CtaGate;
  bootstrap: CtaGate;
  mutinyActive: boolean;
  offboardActive: boolean;
  bootstrapAvailable: boolean;
};

export function buildGovCommandGates(input: {
  privilege: GovernancePrivilege;
  capabilitiesPending: boolean;
  mutinyStatus?: MutinyStatusDto | null;
  qmStatus?: QuartermasterStatusDto | null;
  captainWearers?: string[];
  crewWearers?: string[];
  memberEvmOptions?: MemberEvmOption[];
}): GovCommandGates {
  const {
    privilege,
    capabilitiesPending,
    mutinyStatus = null,
    qmStatus = null,
    captainWearers = [],
    crewWearers = [],
    memberEvmOptions = [],
  } = input;

  const mutinyActive = isMutinyActive(mutinyStatus);
  const offboardActive = isCrewOffboardActive(qmStatus);
  const crew = capabilitiesPending ? PENDING_GATE : gateRequiresCrew(privilege);
  const captain = capabilitiesPending ? PENDING_GATE : gateRequiresCaptain(privilege);
  const treasury = capabilitiesPending ? PENDING_GATE : gateRequiresCaptainOrCrew(privilege);
  const rosterFrozen = !!qmStatus?.mutinyActive || offboardActive;
  const rosterFreezeReason = qmStatus?.mutinyActive
    ? 'governance.gate.quartermasterLocked'
    : 'governance.gate.rosterFrozenOffboard';
  const qmRoster = capabilitiesPending
    ? PENDING_GATE
    : gateBlockedByMutinyMode(privilege, rosterFrozen, rosterFreezeReason);
  const exec = capabilitiesPending ? PENDING_GATE : gatePermissionlessSigner(privilege);
  const bootstrapAvailable = qmStatus?.bootstrapAvailable === true;
  const bootstrap = capabilitiesPending ? PENDING_GATE : captain;
  const randomizeExclude = [privilege.myAddress, ...captainWearers];
  const randomizePool = labeledWearerOptions(crewWearers, memberEvmOptions);
  const randomizeCandidates = randomizeCaptainCandidates(randomizePool, randomizeExclude);

  let startMutiny: CtaGate = crew;
  if (mutinyActive) startMutiny = { enabled: false, reason: 'governance.gate.mutinyAlreadyActive' };
  else if (offboardActive) startMutiny = { enabled: false, reason: 'governance.gate.cannotStartMutinyWhileOffboard' };

  let proposeOffboard: CtaGate = crew;
  if (offboardActive) proposeOffboard = { enabled: false, reason: 'governance.gate.offboardAlreadyActive' };
  else if (mutinyActive) proposeOffboard = { enabled: false, reason: 'governance.gate.cannotOffboardWhileMutiny' };

  const resign: CtaGate = mutinyActive
    ? { enabled: false, reason: 'governance.gate.cannotResignWhileMutiny' }
    : captain;

  let randomize: CtaGate = captain;
  if (mutinyActive) randomize = { enabled: false, reason: 'governance.gate.cannotResignWhileMutiny' };
  else if (!captain.enabled) randomize = captain;
  else if (randomizeCandidates.length === 0) {
    randomize = { enabled: false, reason: 'governance.gate.noOtherRosterForCaptain' };
  }

  return {
    treasury,
    crew,
    captain,
    startMutiny,
    proposeOffboard,
    qmRoster,
    exec,
    resign,
    randomize,
    bootstrap,
    mutinyActive,
    offboardActive,
    bootstrapAvailable,
  };
}
