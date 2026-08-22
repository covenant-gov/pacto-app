import type { SquadCapabilitiesDto, SquadInfraDto } from './api';
import { pactoGovWargameInfraRow, sponsorInfraRow } from './api';
import type { GovCapabilityKey } from './governance-privilege';
import { warGameRoundSponsorRow } from './war-game-payload';

const ARCHIVE_CAPABILITY_KEYS: GovCapabilityKey[] = [
  'proposeTreasury',
  'crewVote',
  'captainVote',
  'executeTreasury',
  'startMutiny',
  'castMutinyVote',
  'executeMutiny',
  'captainResign',
  'quartermasterMutateCrew',
  'quartermasterExecute',
  'proposeCrewOffboard',
  'castCrewOffboardVote',
  'executeCrewOffboard',
  'mutateTrackedTokens',
  'squadAdminCreateRole',
  'squadAdminEnableExecutor',
  'squadAdminEnableFull',
];

/** Fail-closed ACL snapshot while viewing an archived wargame round. */
export function warGameArchiveCapabilities(parentId: string): SquadCapabilitiesDto {
  const denied = { allowed: false, reason: 'governance.gate.warGameArchive' };
  return {
    parentId,
    rosterAddress: '',
    wearsCaptain: false,
    wearsCrew: false,
    captainIsSafe: false,
    squadAdminFull: false,
    squadAdminPaused: false,
    roleLabel: '',
    capabilities: Object.fromEntries(ARCHIVE_CAPABILITY_KEYS.map((key) => [key, denied])),
  };
}

/** Hub Treasury/Governance sponsor: live `sponsor` row, or the wargame round clone. */
export function resolveHubSponsorRow(params: {
  warGameStack: boolean;
  rows: SquadInfraDto[] | undefined;
  archiveView?: boolean;
}): SquadInfraDto | null {
  if (!params.warGameStack) return sponsorInfraRow(params.rows);
  if (params.archiveView) return null;
  return warGameRoundSponsorRow(pactoGovWargameInfraRow(params.rows));
}
