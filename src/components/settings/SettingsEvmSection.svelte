<script lang="ts">
  import { currentUser } from '../../stores/auth-session';
  import {
    saveWalletEnabledChains,
    loadWalletEnabledChains,
    walletUiEnabledChainsTick,
    defaultWalletEnabledChains,
  } from '../../lib/wallet/wallet-ui-prefs';
  import type { SupportedChainId } from '../../lib/wallet/chains';
  import EvmWalletExtras from './EvmWalletExtras.svelte';

  const accountNpub = $derived($currentUser?.npub ?? null);

  let enabledSet = $state(new Set<SupportedChainId>(defaultWalletEnabledChains()));

  function syncFromDisk() {
    if (!accountNpub) return;
    enabledSet = new Set(loadWalletEnabledChains(accountNpub));
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
</script>

{#if accountNpub}
  <EvmWalletExtras {accountNpub} {enabledSet} onToggleChain={toggleChain} />
{/if}
