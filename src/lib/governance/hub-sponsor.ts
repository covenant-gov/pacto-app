import type { SquadInfraDto } from './api';
import { pactoGovWargameInfraRow, sponsorInfraRow } from './api';
import { warGameRoundSponsorRow } from './war-game-payload';

/** Hub Treasury/Governance sponsor: live `sponsor` row, or the wargame round clone. */
export function resolveHubSponsorRow(params: {
  warGameStack: boolean;
  rows: SquadInfraDto[] | undefined;
}): SquadInfraDto | null {
  if (!params.warGameStack) return sponsorInfraRow(params.rows);
  return warGameRoundSponsorRow(pactoGovWargameInfraRow(params.rows));
}
