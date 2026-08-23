/**
 * Silent #announcements share of the squad's Primary and Practice deploy networks.
 * Last-write-wins; FE localStorage only (no SQLite side effect).
 */

import { get } from 'svelte/store';
import { sendDmMessage } from '../api/nostr';
import { listSquadInfra } from '../governance/api';
import { currentUser } from '../../stores/auth';
import type { SupportedChainId } from '../wallet/chains';
import {
  isSquadDeployableChain,
  loadSquadNetworkPair,
  resolvePracticeSquadNetwork,
  resolvePrimarySquadNetwork,
  saveSquadNetworkPair,
  type SquadNetworkPair,
} from './squad-network';

export const SQUAD_NETWORK_UPDATED_TYPE = 'squad_network_updated';
export const SQUAD_NETWORK_UPDATED_VERSION = 2;

export type SquadNetworkUpdatedPayload = {
  parent_id: string;
  primary: SupportedChainId;
  practice: SupportedChainId;
};

export function formatSquadNetworkUpdated(params: {
  parentId: string;
  pair: SquadNetworkPair;
}): string {
  return JSON.stringify({
    version: SQUAD_NETWORK_UPDATED_VERSION,
    type: SQUAD_NETWORK_UPDATED_TYPE,
    payload: {
      parent_id: params.parentId.trim(),
      primary: params.pair.primary,
      practice: params.pair.practice,
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
  if (root.version !== SQUAD_NETWORK_UPDATED_VERSION) return null;
  const payload = root.payload;
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const parent_id = typeof p.parent_id === 'string' ? p.parent_id.trim() : '';
  const primary = p.primary;
  const practice = p.practice;
  if (!parent_id || !isSquadDeployableChain(primary) || !isSquadDeployableChain(practice)) return null;
  return { parent_id, primary, practice };
}

export function applySquadNetworkUpdated(payload: SquadNetworkUpdatedPayload, accountNpub: string): void {
  saveSquadNetworkPair(accountNpub, payload.parent_id, {
    primary: payload.primary,
    practice: payload.practice,
  });
}

/** Prefer pacto_gov → squad_admin → sponsor chain, matching dashboard infra seed. */
export function infraChainFromSquadRows(
  rows: { infraType: string; chain?: string | null }[],
): string | null {
  const byType = (t: string) => rows.find((r) => r.infraType === t)?.chain?.trim() || null;
  return byType('pacto_gov') || byType('squad_admin') || byType('sponsor') || null;
}

export function practiceInfraChainFromSquadRows(
  rows: { infraType: string; chain?: string | null }[],
): string | null {
  return rows.find((r) => r.infraType === 'pacto_gov_wargame')?.chain?.trim() || null;
}

/**
 * Publish effective Primary + Practice networks to #announcements.
 */
export async function publishSquadNetworkUpdated(
  announcementsGroupId: string,
): Promise<boolean> {
  const gid = announcementsGroupId.trim();
  if (!gid) return false;
  const me = get(currentUser)?.npub?.trim();
  if (!me) return false;

  const stored = loadSquadNetworkPair(me, gid);
  let rows: { infraType: string; chain?: string | null }[] = [];
  try {
    rows = await listSquadInfra(gid);
  } catch {
    /* still try stored + defaults */
  }
  const pair: SquadNetworkPair = {
    primary: resolvePrimarySquadNetwork({
      override: stored?.primary ?? null,
      infraChain: infraChainFromSquadRows(rows),
    }),
    practice: resolvePracticeSquadNetwork({
      override: stored?.practice ?? null,
      infraChain: practiceInfraChainFromSquadRows(rows),
    }),
  };
  if (!stored) {
    saveSquadNetworkPair(me, gid, pair);
  }

  const json = formatSquadNetworkUpdated({ parentId: gid, pair });
  try {
    await sendDmMessage(gid, json, '', { virtualBucket: 'announcements' });
    return true;
  } catch (e) {
    console.warn('[squad-network] publish failed', e);
    return false;
  }
}

