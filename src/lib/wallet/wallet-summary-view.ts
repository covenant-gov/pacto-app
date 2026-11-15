import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import { getWalletNetworkDisplayName } from './assets';
import type { WalletSummary, WalletSummaryNetwork, WalletUsdPricingStatus } from './backend-wallet';
import type { SupportedChainId } from './chains';
import type { NetworkFilter } from './network-filter';
import { watchedWireFingerprint } from './wallet-summary-cache';
import { pricingStatusForNetworks, sumPricedUsd } from './wallet-summary-usd';
import type { WatchedErc20Wire } from './watched-tokens';

/** Summary networks that are enabled and match the filter. */
export function networksForBalanceList(
  summary: WalletSummary | null,
  filter: NetworkFilter,
  enabled: Set<SupportedChainId>,
): WalletSummaryNetwork[] {
  if (!summary) return [];
  return summary.networks.filter(
    (n) => enabled.has(n.network as SupportedChainId) && (filter === 'all' || n.network === filter),
  );
}

/** USD total and completeness for the listed networks; the backend total applies only to `all`. */
export function summaryPricing(
  summary: WalletSummary | null,
  filter: NetworkFilter,
  networks: WalletSummaryNetwork[],
): { status: WalletUsdPricingStatus; total: number | null } {
  if (!summary) return { status: 'unavailable', total: null };
  if (filter === 'all') {
    const status = summary.usdPricingStatus ?? 'unavailable';
    if (status === 'unavailable') return { status, total: null };
    return { status, total: summary.totalUsdApprox ?? sumPricedUsd(networks) };
  }
  const status = pricingStatusForNetworks(networks);
  return { status, total: status === 'unavailable' ? null : sumPricedUsd(networks) };
}

/** Friendly per-network read failure copy; raw RPC text stays off the primary line. */
export function networkErrorMessage(net: WalletSummaryNetwork): string {
  const tr = get(t);
  if (net.network === 'local') return tr('wallet.anvilNotDetected');
  return tr('wallet.couldNotReachNetwork', {
    values: { network: getWalletNetworkDisplayName(net.network as SupportedChainId) },
  });
}

/** One summary fetch per distinct address, chain set and watched-token set. */
export function walletSummaryFetchKey(
  address: string | null,
  chains: readonly SupportedChainId[],
  watched: WatchedErc20Wire[],
): string {
  return `${address ?? ''}|${chains.join(',')}|${watchedWireFingerprint(watched)}`;
}
