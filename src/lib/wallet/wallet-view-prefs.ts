import type { SupportedChainId } from './chains';
import { loadWalletEnabledChains } from './wallet-ui-prefs';
import { loadWatchedErc20Rows, type WatchedErc20Row } from './watched-tokens';

export interface WalletViewPrefs {
  enabledSet: Set<SupportedChainId>;
  watchedRows: WatchedErc20Row[];
}

/** Enabled chains and watched tokens for an account; defaults when no npub. */
export function loadWalletViewPrefs(accountNpub: string | null | undefined): WalletViewPrefs {
  return {
    enabledSet: new Set(loadWalletEnabledChains(accountNpub)),
    watchedRows: loadWatchedErc20Rows(accountNpub),
  };
}
