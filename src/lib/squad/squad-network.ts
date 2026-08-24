/**
 * Squad deploy networks: Primary (dashboard / production) and Practice/Wargame.
 *
 * Flip `DEFAULT_SQUAD_PRIMARY_NETWORK` to `arbitrum` when protocol addresses exist.
 * Deployable set stays Sepolia + Local until then. DM wallet is unaffected.
 */

import { writable } from 'svelte/store';
import type { SupportedChainId } from '../wallet/chains';
import { getWalletNetworkDisplayName } from '../wallet/assets';

/** Chains a squad may deploy on-chain infrastructure to. */
export const SQUAD_DEPLOYABLE_CHAIN_IDS: SupportedChainId[] = ['sepolia', 'local'];

/** Pointer: change to `arbitrum` when factories land. */
export const DEFAULT_SQUAD_PRIMARY_NETWORK: SupportedChainId = 'sepolia';
export const DEFAULT_SQUAD_PRACTICE_NETWORK: SupportedChainId = 'sepolia';

export type SquadNetworkSlot = 'primary' | 'practice';
export type SquadNetworkPair = {
  primary: SupportedChainId;
  practice: SupportedChainId;
};

const STORAGE_VERSION = 2 as const;
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

export function defaultSquadNetworkPair(): SquadNetworkPair {
  return {
    primary: DEFAULT_SQUAD_PRIMARY_NETWORK,
    practice: DEFAULT_SQUAD_PRACTICE_NETWORK,
  };
}

function storageKey(accountNpub: string): string {
  return `${SQUAD_NETWORK_PREFIX}_${accountNpub}`;
}

function parseSlot(value: unknown, fallback: SupportedChainId): SupportedChainId {
  return isSquadDeployableChain(value) ? value : fallback;
}

function parsePair(value: unknown): SquadNetworkPair | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  return {
    primary: parseSlot(rec.primary, DEFAULT_SQUAD_PRIMARY_NETWORK),
    practice: parseSlot(rec.practice, DEFAULT_SQUAD_PRACTICE_NETWORK),
  };
}

function readBlob(accountNpub: string): Record<string, SquadNetworkPair> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(accountNpub)) ?? '') as {
      v?: number;
      byParentId?: unknown;
    };
    if (parsed?.v !== STORAGE_VERSION || !parsed.byParentId || typeof parsed.byParentId !== 'object') {
      return {};
    }
    const out: Record<string, SquadNetworkPair> = {};
    for (const [parentId, raw] of Object.entries(parsed.byParentId as Record<string, unknown>)) {
      const pair = parsePair(raw);
      if (pair) out[parentId] = pair;
    }
    return out;
  } catch {
    return {};
  }
}

function writeBlob(accountNpub: string, byParentId: Record<string, SquadNetworkPair>): void {
  localStorage.setItem(storageKey(accountNpub), JSON.stringify({ v: STORAGE_VERSION, byParentId }));
  squadNetworkTick.update((n) => n + 1);
}

/** Stored pair for a parent, or null when unset / stale v1 blob. */
export function loadSquadNetworkPair(
  accountNpub: string | null | undefined,
  parentId: string | null | undefined,
): SquadNetworkPair | null {
  if (!accountNpub || !parentId) return null;
  return readBlob(accountNpub)[parentId] ?? null;
}

export function loadSquadNetworkSlot(
  accountNpub: string | null | undefined,
  parentId: string | null | undefined,
  slot: SquadNetworkSlot,
): SupportedChainId | null {
  return loadSquadNetworkPair(accountNpub, parentId)?.[slot] ?? null;
}

export function saveSquadNetworkPair(
  accountNpub: string,
  parentId: string,
  pair: SquadNetworkPair,
): void {
  if (!accountNpub || !parentId || typeof localStorage === 'undefined') return;
  if (!isSquadDeployableChain(pair.primary) || !isSquadDeployableChain(pair.practice)) return;
  const byParentId = readBlob(accountNpub);
  byParentId[parentId] = { primary: pair.primary, practice: pair.practice };
  writeBlob(accountNpub, byParentId);
}

export function saveSquadNetworkSlot(
  accountNpub: string,
  parentId: string,
  slot: SquadNetworkSlot,
  chain: SupportedChainId,
): void {
  if (!accountNpub || !parentId || !isSquadDeployableChain(chain) || typeof localStorage === 'undefined') {
    return;
  }
  const current = loadSquadNetworkPair(accountNpub, parentId) ?? defaultSquadNetworkPair();
  current[slot] = chain;
  saveSquadNetworkPair(accountNpub, parentId, current);
}

/**
 * Effective slot chain: override → matching infra → default pointer.
 * Unknown / non-deployable values reset to the slot default.
 */
export function resolveSquadNetworkSlot(params: {
  override: SupportedChainId | null | undefined;
  infraChain?: string | null | undefined;
  fallback: SupportedChainId;
}): SupportedChainId {
  if (isSquadDeployableChain(params.override)) return params.override;
  if (isSquadDeployableChain(params.infraChain)) return params.infraChain;
  return isSquadDeployableChain(params.fallback) ? params.fallback : DEFAULT_SQUAD_PRIMARY_NETWORK;
}

export function resolvePrimarySquadNetwork(params: {
  override: SupportedChainId | null | undefined;
  infraChain?: string | null | undefined;
}): SupportedChainId {
  return resolveSquadNetworkSlot({ ...params, fallback: DEFAULT_SQUAD_PRIMARY_NETWORK });
}

export function resolvePracticeSquadNetwork(params: {
  override: SupportedChainId | null | undefined;
  infraChain?: string | null | undefined;
}): SupportedChainId {
  return resolveSquadNetworkSlot({ ...params, fallback: DEFAULT_SQUAD_PRACTICE_NETWORK });
}

export function distinctSquadNetworkChains(pair: SquadNetworkPair): SupportedChainId[] {
  return pair.primary === pair.practice ? [pair.primary] : [pair.primary, pair.practice];
}
