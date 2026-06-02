<script lang="ts">
  import { WALLET_ASSETS_CHAIN_IDS, getWalletNetworkDisplayName } from '../../lib/wallet/assets';
  import type { SupportedChainId } from '../../lib/wallet/chains';

  export let id: string | undefined = undefined;
  export let value: SupportedChainId;
  export let disabled = false;
  export let selectClass = 'input-select';
</script>

<select {id} class={selectClass} bind:value {disabled}>
  {#each WALLET_ASSETS_CHAIN_IDS as chainId (chainId)}
    <option value={chainId}>{getWalletNetworkDisplayName(chainId)}</option>
  {/each}
</select>

<style>
  .input-select {
    width: 100%;
    padding: 10px 12px;
    font-size: 0.875rem;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    margin-bottom: 4px;
    box-sizing: border-box;
  }
</style>
