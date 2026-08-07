/**
 * Silent #announcements share of squad RPC slots 1–2.
 * Last-write-wins; FE localStorage only. User Settings default is never included.
 */

import { get } from 'svelte/store';
import { sendDmMessage } from '../api/nostr';
import { currentUser } from '../../stores/auth';
import type { SupportedChainId } from '../wallet/chains';
import { dmWarn } from '../utils/dm-debug';
import { isSquadDeployableChain, loadSquadNetworkOverride } from './squad-network';
import {
  effectiveSquadRpcConfig,
  loadSquadRpcConfig,
  parseSquadRpcSlot,
  saveSquadRpcConfig,
  type SquadRpcConfig,
  type SquadRpcSlot,
} from './squad-rpc';

export const SQUAD_RPC_UPDATED_TYPE = 'squad_rpc_updated';
export const SQUAD_RPC_UPDATED_VERSION = 1;

export type SquadRpcUpdatedPayload = {
  parent_id: string;
  chain: SupportedChainId;
  rpc1: SquadRpcSlot;
  rpc2: SquadRpcSlot;
};

export function formatSquadRpcUpdated(params: {
  parentId: string;
  config: SquadRpcConfig;
}): string {
  return JSON.stringify({
    version: SQUAD_RPC_UPDATED_VERSION,
    type: SQUAD_RPC_UPDATED_TYPE,
    payload: {
      parent_id: params.parentId.trim(),
      chain: params.config.chain,
      rpc1: params.config.rpc1,
      rpc2: params.config.rpc2,
    } satisfies SquadRpcUpdatedPayload,
    pacto_virtual_bucket: 'announcements',
  });
}

export function parseSquadRpcUpdated(
  content: string | null | undefined,
): SquadRpcUpdatedPayload | null {
  if (!content || typeof content !== 'string') return null;
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const root = parsed as Record<string, unknown>;
  if (root.type !== SQUAD_RPC_UPDATED_TYPE) return null;
  if (root.version !== SQUAD_RPC_UPDATED_VERSION) return null;
  const payload = root.payload;
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const parent_id = typeof p.parent_id === 'string' ? p.parent_id.trim() : '';
  if (!parent_id || !isSquadDeployableChain(p.chain)) return null;
  const rpc1 = parseSquadRpcSlot(p.rpc1);
  const rpc2 = parseSquadRpcSlot(p.rpc2);
  if (!rpc1 || !rpc2) return null;
  return { parent_id, chain: p.chain, rpc1, rpc2 };
}

export function applySquadRpcUpdated(payload: SquadRpcUpdatedPayload, accountNpub: string): void {
  saveSquadRpcConfig(accountNpub, payload.parent_id, {
    chain: payload.chain,
    rpc1: payload.rpc1,
    rpc2: payload.rpc2,
  });
}

/** Publish current squad RPC slots to #announcements. */
export async function publishSquadRpcUpdated(announcementsGroupId: string): Promise<boolean> {
  const gid = announcementsGroupId.trim();
  if (!gid) return false;
  const me = get(currentUser)?.npub?.trim();
  if (!me) return false;

  const stored = loadSquadRpcConfig(me, gid);
  const chain = stored?.chain ?? loadSquadNetworkOverride(me, gid);
  const config = effectiveSquadRpcConfig(me, gid, chain ?? null);
  if (!config) return false;

  const json = formatSquadRpcUpdated({ parentId: gid, config });
  try {
    await sendDmMessage(gid, json, '', { virtualBucket: 'announcements' });
    return true;
  } catch (e) {
    dmWarn('[squad-rpc] publish failed', e);
    return false;
  }
}
