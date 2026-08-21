/** Deploy-network side effects a freshly created squad needs, shared by create and retry. */

import type { SupportedChainId } from '../wallet/chains';
import { saveSquadNetworkOverride } from './squad-network';
import { initSquadRpcOnCreate } from './squad-rpc';
import { publishSquadNetworkUpdated } from './squad-network-share';
import { publishSquadRpcUpdated } from './squad-rpc-share';

/** Persist the creator's chosen network, seed RPC slots, and announce both to the squad. */
export function applySquadCreateNetwork(
  creatorNpub: string | undefined,
  groupId: string,
  network: SupportedChainId | undefined
): void {
  if (!creatorNpub || !network) return;
  saveSquadNetworkOverride(creatorNpub, groupId, network);
  initSquadRpcOnCreate(creatorNpub, groupId, network);
  void publishSquadNetworkUpdated(groupId);
  void publishSquadRpcUpdated(groupId);
}
