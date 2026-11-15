import { persistenceKey } from '../../stores/persistence-context';
import { WALLET_ASSETS_CHAIN_IDS } from './assets';
import type { SupportedChainId } from './chains';

/** `all` = every enabled chain; otherwise one chain. */
export type NetworkFilter = 'all' | SupportedChainId;

export const PROFILE_NETWORK_FILTER_PREFIX = 'pacto_profile_wallet_network_filter';
export const WALLET_BAR_NETWORK_FILTER_PREFIX = 'pacto_wallet_bar_network_filter';

export function parseNetworkFilter(raw: string | null | undefined): NetworkFilter {
  if (raw && WALLET_ASSETS_CHAIN_IDS.includes(raw as SupportedChainId)) return raw as SupportedChainId;
  return 'all';
}

export function loadNetworkFilter(prefix: string): NetworkFilter {
  const key = persistenceKey(prefix);
  if (!key || typeof localStorage === 'undefined') return 'all';
  return parseNetworkFilter(localStorage.getItem(key));
}

export function saveNetworkFilter(prefix: string, filter: NetworkFilter): void {
  const key = persistenceKey(prefix);
  if (!key || typeof localStorage === 'undefined') return;
  localStorage.setItem(key, filter);
}

/** `all` when the filtered chain is no longer enabled. */
export function coerceNetworkFilter(filter: NetworkFilter, enabled: Set<SupportedChainId>): NetworkFilter {
  return filter === 'all' || enabled.has(filter) ? filter : 'all';
}
