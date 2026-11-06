import {
  listGlobalSponsoredFeeUsage,
  type GlobalSponsoredFeeUsageDto,
} from '../api/global-sponsor';
import { feeUsageActionLabel } from '../governance/sponsored-fee-usage-display';

export type { GlobalSponsoredFeeUsageDto };
export { feeUsageActionLabel };

/** Rust lane constants from `global_sponsored_fee_ledger`. */
export const GLOBAL_FEE_USAGE_LANES = [
  'gov_module',
  'factory',
  'username_bootstrap',
  'username_member',
] as const;

export type GlobalFeeUsageLane = (typeof GLOBAL_FEE_USAGE_LANES)[number];

const LANE_I18N: Record<GlobalFeeUsageLane, string> = {
  gov_module: 'settings.evmDashGas.lane.govModule',
  factory: 'settings.evmDashGas.lane.factory',
  username_bootstrap: 'settings.evmDashGas.lane.usernameBootstrap',
  username_member: 'settings.evmDashGas.lane.usernameMember',
};

/** i18n key for a known lane; unknown lanes fall back to raw string. */
export function globalFeeUsageLaneLabelKey(lane: string): string {
  const key = lane.trim();
  return Object.hasOwn(LANE_I18N, key) ? LANE_I18N[key as GlobalFeeUsageLane] : '';
}

export function isKnownGlobalFeeUsageLane(lane: string): lane is GlobalFeeUsageLane {
  return (GLOBAL_FEE_USAGE_LANES as readonly string[]).includes(lane.trim());
}

export async function loadGlobalSponsoredFeeUsage(params?: {
  limit?: number;
}): Promise<GlobalSponsoredFeeUsageDto[]> {
  return listGlobalSponsoredFeeUsage(params);
}
