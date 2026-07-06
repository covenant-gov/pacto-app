/**
 * User-preferred EVM network for wallet defaults (Settings → EVM).
 */

import { writable } from 'svelte/store';
import type { SupportedChainId } from './chains';
import { WALLET_ASSETS_CHAIN_IDS, getWalletNetworkDisplayName } from './assets';

const STORAGE_VERSION = 1 as const;
export const WALLET_PREFERRED_NETWORK_PREFIX = 'pacto_wallet_preferred_network_v1';

export type PreferredNetworkId = SupportedChainId;

export const DEFAULT_PREFERRED_NETWORK: PreferredNetworkId = 'arbitrum';

export const walletPreferredNetworkTick = writable(0);

const KNOWN_IDS = new Set<string>(WALLET_ASSETS_CHAIN_IDS);

function storageKey(accountNpub: string): string {
  return `${WALLET_PREFERRED_NETWORK_PREFIX}_${accountNpub}`;
}

export function isPreferredNetworkId(raw: string): raw is PreferredNetworkId {
  return KNOWN_IDS.has(raw);
}

export function getPreferredNetworkDisplayName(id: PreferredNetworkId): string {
  return getWalletNetworkDisplayName(id);
}

/** Options for Settings edit dropdown (Arbitrum first as product default). */
export function listPreferredNetworkOptions(): { id: PreferredNetworkId; label: string }[] {
  const ids = [...WALLET_ASSETS_CHAIN_IDS].sort((a, b) => {
    if (a === DEFAULT_PREFERRED_NETWORK) return -1;
    if (b === DEFAULT_PREFERRED_NETWORK) return 1;
    return 0;
  });
  return ids.map((id) => ({
    id,
    label: getWalletNetworkDisplayName(id),
  }));
}

export function loadPreferredNetwork(accountNpub: string | null | undefined): PreferredNetworkId {
  if (!accountNpub || typeof localStorage === 'undefined') return DEFAULT_PREFERRED_NETWORK;
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(accountNpub)) ?? '') as {
      v?: number;
      network?: unknown;
    };
    if (parsed?.v !== STORAGE_VERSION) return DEFAULT_PREFERRED_NETWORK;
    const n = typeof parsed.network === 'string' ? parsed.network.trim() : '';
    return isPreferredNetworkId(n) ? n : DEFAULT_PREFERRED_NETWORK;
  } catch {
    return DEFAULT_PREFERRED_NETWORK;
  }
}

export function savePreferredNetwork(accountNpub: string, network: PreferredNetworkId): void {
  if (!accountNpub || typeof localStorage === 'undefined') return;
  const id = isPreferredNetworkId(network) ? network : DEFAULT_PREFERRED_NETWORK;
  localStorage.setItem(storageKey(accountNpub), JSON.stringify({ v: STORAGE_VERSION, network: id }));
  walletPreferredNetworkTick.update((n) => n + 1);
}
