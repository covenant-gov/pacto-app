<script lang="ts">
  import { currentUser } from '../../stores/auth-session';
  import {
    saveWalletEnabledChains,
    walletUiEnabledChainsTick,
    defaultWalletEnabledChains,
  } from '../../lib/wallet/wallet-ui-prefs';
  import { DEFAULT_PREFERRED_NETWORK } from '../../lib/wallet/preferred-network';
  import type { SupportedChainId } from '../../lib/wallet/chains';
  import { saveWatchedErc20Rows, type WatchedErc20Row } from '../../lib/wallet/watched-tokens';
  import { loadWalletViewPrefs } from '../../lib/wallet/wallet-view-prefs';
  import WalletImportTokensModal from '../wallet/WalletImportTokensModal.svelte';
  import EvmWalletExtras from './EvmWalletExtras.svelte';

  const accountNpub = $derived($currentUser?.npub ?? null);

  let importModalOpen = $state(false);
  let watchedRows: WatchedErc20Row[] = $state([]);
  let enabledSet = $state(new Set<SupportedChainId>(defaultWalletEnabledChains()));
  let tokenNetworkFilter: 'all' | SupportedChainId = $state(DEFAULT_PREFERRED_NETWORK);

  function syncFromDisk() {
    if (!accountNpub) return;
    ({ watchedRows, enabledSet } = loadWalletViewPrefs(accountNpub));
  }

  $effect(() => {
    void accountNpub;
    void $walletUiEnabledChainsTick;
    syncFromDisk();
  });

  function toggleChain(chain: SupportedChainId) {
    if (!accountNpub) return;
    const next = new Set(enabledSet);
    if (next.has(chain)) {
      if (next.size <= 1) return;
      next.delete(chain);
    } else {
      next.add(chain);
    }
    enabledSet = next;
    saveWalletEnabledChains(accountNpub, [...next]);
  }

  function removeWatchedRow(row: WatchedErc20Row) {
    if (!accountNpub) return;
    const next = watchedRows.filter((r) => r.id !== row.id);
    watchedRows = next;
    saveWatchedErc20Rows(accountNpub, next);
  }
</script>

{#if accountNpub}
  <EvmWalletExtras
    {accountNpub}
    {enabledSet}
    {watchedRows}
    bind:tokenNetworkFilter
    onToggleChain={toggleChain}
    onRemoveWatchedRow={removeWatchedRow}
    onImportTokens={() => {
      importModalOpen = true;
    }}
  />

  <WalletImportTokensModal
    open={importModalOpen}
    networkScope={tokenNetworkFilter}
    {accountNpub}
    onClose={() => (importModalOpen = false)}
    onSaved={() => {
      syncFromDisk();
      importModalOpen = false;
    }}
  />
{/if}
