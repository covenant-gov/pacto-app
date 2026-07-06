/**
 * Background `get_wallet_summary` after login (no DM / WalletBar required).
 * Dedupes in-flight work per npub; throttles repeat success to limit RPC churn.
 */

import { get } from 'svelte/store';
import { currentUser } from '../../stores/auth';
import { getWalletSummary } from './backend-wallet';
import { loadWatchedErc20Rows, watchedRowsToWire } from './watched-tokens';
import { loadWalletEnabledChains } from './wallet-ui-prefs';
import { persistWalletSummaryCache } from './wallet-summary-cache';

const MIN_SUCCESS_INTERVAL_MS = 45_000;

let inFlightForNpub: string | null = null;
let lastSuccessAtMs = 0;
let lastSuccessForNpub: string | null = null;

export function scheduleWalletSummaryBackgroundPrefetch(npub: string | null | undefined): void {
  if (!npub) return;
  if (inFlightForNpub === npub) return;
  if (inFlightForNpub != null && inFlightForNpub !== npub) return;
  if (
    lastSuccessForNpub === npub &&
    Date.now() - lastSuccessAtMs < MIN_SUCCESS_INTERVAL_MS
  ) {
    return;
  }

  inFlightForNpub = npub;
  void (async () => {
    const startedFor = npub;
    try {
      const rows = loadWatchedErc20Rows(startedFor);
      const wire = watchedRowsToWire(rows);
      const enabledChains = loadWalletEnabledChains(startedFor);
      const r = await getWalletSummary(wire, enabledChains);
      if (!r.ok) return;
      if (get(currentUser)?.npub !== startedFor) return;
      persistWalletSummaryCache(startedFor, wire, r.summary);
      lastSuccessAtMs = Date.now();
      lastSuccessForNpub = startedFor;
    } finally {
      if (inFlightForNpub === startedFor) inFlightForNpub = null;
      const cur = get(currentUser)?.npub;
      if (cur && cur !== startedFor) {
        scheduleWalletSummaryBackgroundPrefetch(cur);
      }
    }
  })();
}
