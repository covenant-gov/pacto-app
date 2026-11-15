<script lang="ts">
  import { WALLET_ASSETS_CHAIN_IDS, getWalletNetworkDisplayName } from '../../lib/wallet/assets';
  import type { SupportedChainId } from '../../lib/wallet/chains';

  interface Props {
    id?: string;
    value: SupportedChainId;
    disabled?: boolean;
    selectClass?: string;
  }

  let { id = undefined, value = $bindable(), disabled = false, selectClass = 'ui-select' }: Props = $props();
</script>

<select {id} class={selectClass} bind:value {disabled}>
  {#each WALLET_ASSETS_CHAIN_IDS as chainId (chainId)}
    <option value={chainId}>{getWalletNetworkDisplayName(chainId)}</option>
  {/each}
</select>
