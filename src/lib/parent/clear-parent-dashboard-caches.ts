import { removeTreasurySafesCacheForParent } from '../dashboard/treasury-safes-cache';
import { removeSquadInfraCacheForParent } from '../dashboard/squad-infra-cache';
import { removeSquadMemberEvmCacheForParent } from '../dashboard/squad-member-evm-cache';
import { removeSettingsChainCacheForParent } from '../dashboard/settings-chain-cache';

/** Drop session + disk dashboard caches for a squad the user left. */
export function clearParentDashboardCaches(npub: string | null | undefined, parentId: string): void {
  if (!npub || !parentId) return;
  removeTreasurySafesCacheForParent(npub, parentId);
  removeSquadInfraCacheForParent(npub, parentId);
  removeSquadMemberEvmCacheForParent(npub, parentId);
  removeSettingsChainCacheForParent(npub, parentId);
}
