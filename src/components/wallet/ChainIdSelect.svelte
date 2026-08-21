<script lang="ts">
  import { WALLET_ASSETS_CHAIN_IDS, getWalletNetworkDisplayName } from '../../lib/wallet/assets';
  import type { SupportedChainId } from '../../lib/wallet/chains';

  interface Props {
    id?: string;
    value: SupportedChainId;
    disabled?: boolean;
    selectClass?: string;
  }

  let { id = undefined, value = $bindable(), disabled = false, selectClass = 'input-select' }: Props = $props();
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
    background: var(--bg-elevated);
    color: var(--text-primary);
    margin-bottom: 4px;
    box-sizing: border-box;
  }
</style>
