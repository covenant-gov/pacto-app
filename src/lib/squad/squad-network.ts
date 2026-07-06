/**
 * Squad network model: a squad's on-chain infra lives on a single network.
 *
 * Squad deployments (Pacto Gov, Squad Admin, sponsor, treasury Safe) are restricted to
 * `SQUAD_DEPLOYABLE_CHAIN_IDS`. The first deploy picks and locks the squad network; later
 * deploys default to and are pinned to it. A member can retarget future deploys from
 * Settings via a small per-parent override (npub-scoped). The DM wallet is unaffected and
 * still uses the full chain set.
 */

import { writable } from 'svelte/store';
import type { SupportedChainId } from '../wallet/chains';
import { getWalletNetworkDisplayName } from '../wallet/assets';

/** Chains a squad may deploy on-chain infrastructure to. */
export const SQUAD_DEPLOYABLE_CHAIN_IDS: SupportedChainId[] = ['sepolia', 'local'];

const STORAGE_VERSION = 1 as const;
/** Prefix for `clear-account-state` scoped removal (`_${npub}`). */
export const SQUAD_NETWORK_PREFIX = 'pacto_squad_network_v1';

/** Bump so the dashboard reactively re-reads the squad network when Settings changes it. */
export const squadNetworkTick = writable(0);

export function isSquadDeployableChain(id: unknown): id is SupportedChainId {
  return typeof id === 'string' && (SQUAD_DEPLOYABLE_CHAIN_IDS as string[]).includes(id);
}

/** Options for squad-deploy network pickers (single source of truth). */
export function listSquadDeployNetworkOptions(): { id: SupportedChainId; label: string }[] {
  return SQUAD_DEPLOYABLE_CHAIN_IDS.map((id) => ({ id, label: getWalletNetworkDisplayName(id) }));
}

function storageKey(accountNpub: string): string {
  return `${SQUAD_NETWORK_PREFIX}_${accountNpub}`;
}

function readBlob(accountNpub: string): Record<string, SupportedChainId> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(accountNpub)) ?? '') as {
      v?: number;
      byParentId?: unknown;
    };
    if (parsed?.v !== STORAGE_VERSION || !parsed.byParentId || typeof parsed.byParentId !== 'object') {
      return {};
    }
    const out: Record<string, SupportedChainId> = {};
    for (const [parentId, chain] of Object.entries(parsed.byParentId as Record<string, unknown>)) {
      if (isSquadDeployableChain(chain)) out[parentId] = chain;
    }
    return out;
  } catch {
    return {};
  }
}

/** User-set squad network override for a parent, or null when unset / stale. */
export function loadSquadNetworkOverride(
  accountNpub: string | null | undefined,
  parentId: string | null | undefined,
): SupportedChainId | null {
  if (!accountNpub || !parentId) return null;
  return readBlob(accountNpub)[parentId] ?? null;
}

export function saveSquadNetworkOverride(
  accountNpub: string,
  parentId: string,
  chain: SupportedChainId,
): void {
  if (!accountNpub || !parentId || !isSquadDeployableChain(chain) || typeof localStorage === 'undefined') {
    return;
  }
  const byParentId = readBlob(accountNpub);
  byParentId[parentId] = chain;
  localStorage.setItem(storageKey(accountNpub), JSON.stringify({ v: STORAGE_VERSION, byParentId }));
  squadNetworkTick.update((n) => n + 1);
}

/**
 * Effective squad network for deploy defaults: the user override wins, else the chain of
 * already-deployed infra, else null (never established → first deploy must pick). Only
 * deployable chains count; anything else resets to unset.
 */
export function resolveSquadNetwork(params: {
  override: SupportedChainId | null;
  infraChain: string | null | undefined;
}): SupportedChainId | null {
  if (isSquadDeployableChain(params.override)) return params.override;
  if (isSquadDeployableChain(params.infraChain)) return params.infraChain;
  return null;
}
