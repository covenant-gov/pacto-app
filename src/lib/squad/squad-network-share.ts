/**
 * Silent #announcements share of the squad's selected deploy network.
 * Last-write-wins; FE localStorage only (no SQLite side effect).
 */

import { get } from 'svelte/store';
import { sendDmMessage } from '../api/nostr';
import { listSquadInfra } from '../governance/api';
import { currentUser } from '../../stores/auth';
import type { SupportedChainId } from '../wallet/chains';
import {
  isSquadDeployableChain,
  loadSquadNetworkOverride,
  resolveSquadNetwork,
} from './squad-network';

export const SQUAD_NETWORK_UPDATED_TYPE = 'squad_network_updated';
export const SQUAD_NETWORK_UPDATED_VERSION = 1;

export type SquadNetworkUpdatedPayload = {
  parent_id: string;
  chain: SupportedChainId;
};

export function formatSquadNetworkUpdated(params: {
  parentId: string;
  chain: SupportedChainId;
}): string {
  return JSON.stringify({
    version: SQUAD_NETWORK_UPDATED_VERSION,
    type: SQUAD_NETWORK_UPDATED_TYPE,
    payload: {
      parent_id: params.parentId.trim(),
      chain: params.chain,
    } satisfies SquadNetworkUpdatedPayload,
    pacto_virtual_bucket: 'announcements',
  });
}

export function parseSquadNetworkUpdated(
  content: string | null | undefined,
): SquadNetworkUpdatedPayload | null {
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
  if (root.type !== SQUAD_NETWORK_UPDATED_TYPE) return null;
  const payload = root.payload;
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const parent_id = typeof p.parent_id === 'string' ? p.parent_id.trim() : '';
  const chain = p.chain;
  if (!parent_id || !isSquadDeployableChain(chain)) return null;
  return { parent_id, chain };
}

/** Prefer pacto_gov → squad_admin → sponsor chain, matching dashboard infra seed. */
export function infraChainFromSquadRows(
  rows: { infraType: string; chain?: string | null }[],
): string | null {
  const byType = (t: string) => rows.find((r) => r.infraType === t)?.chain?.trim() || null;
  return byType('pacto_gov') || byType('squad_admin') || byType('sponsor') || null;
}

/**
 * Publish effective squad network (override → infra) to #announcements.
 * Returns false when unset or send fails.
 */
export async function publishSquadNetworkUpdated(
  announcementsGroupId: string,
): Promise<boolean> {
  const gid = announcementsGroupId.trim();
  if (!gid) return false;
  const me = get(currentUser)?.npub?.trim();
  if (!me) return false;

  const override = loadSquadNetworkOverride(me, gid);
  let infraChain: string | null = null;
  try {
    infraChain = infraChainFromSquadRows(await listSquadInfra(gid));
  } catch {
    /* still try override-only */
  }
  const chain = resolveSquadNetwork({ override, infraChain });
  if (!chain) return false;

  const json = formatSquadNetworkUpdated({ parentId: gid, chain });
  try {
    await sendDmMessage(gid, json, '', { virtualBucket: 'announcements' });
    return true;
  } catch (e) {
    console.warn('[squad-network] publish failed', e);
    return false;
  }
}
