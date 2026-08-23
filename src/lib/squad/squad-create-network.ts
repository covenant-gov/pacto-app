/** Deploy-network side effects a freshly created squad needs, shared by create and retry. */

import {
  defaultSquadNetworkPair,
  distinctSquadNetworkChains,
  saveSquadNetworkPair,
} from './squad-network';
import { initSquadRpcOnCreate } from './squad-rpc';
import { publishSquadNetworkUpdated } from './squad-network-share';
import { publishSquadRpcUpdated } from './squad-rpc-share';

/** Persist both default slots, seed RPC, and announce to the squad. */
export function applySquadCreateNetwork(creatorNpub: string | undefined, groupId: string): void {
  if (!creatorNpub || !groupId.trim()) return;
  const pair = defaultSquadNetworkPair();
  saveSquadNetworkPair(creatorNpub, groupId, pair);
  for (const chain of distinctSquadNetworkChains(pair)) {
    initSquadRpcOnCreate(creatorNpub, groupId, chain);
  }
  void publishSquadNetworkUpdated(groupId);
  void publishSquadRpcUpdated(groupId);
}
