<script lang="ts">
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import { getWalletNetworkDisplayName } from '../../../lib/wallet/assets';
  import { listSquadDeployNetworkOptions } from '../../../lib/squad/squad-network';

  export let id: string;
  /** When set, the squad network is established: pin the selection and show it read-only. */
  export let squadNetwork: SupportedChainId | null = null;
  /** Bound selection; forced to `squadNetwork` when pinned, otherwise the user's pick. */
  export let value: SupportedChainId | '' = '';
  export let labelText = 'Network';
  export let labelClass = '';
  export let selectClass = '';

  const options = listSquadDeployNetworkOptions();

  $: if (squadNetwork && value !== squadNetwork) value = squadNetwork;
</script>

<label class={labelClass} for={id}>{labelText}</label>
{#if squadNetwork}
  <p {id} class="squad-deploy-pinned">
    {getWalletNetworkDisplayName(squadNetwork)}
    <span class="squad-deploy-pinned-note">· squad network</span>
  </p>
{:else}
  <select {id} class={selectClass} bind:value>
    <option value="" disabled>Select network…</option>
    {#each options as opt (opt.id)}
      <option value={opt.id}>{opt.label}</option>
    {/each}
  </select>
{/if}

<style>
  .squad-deploy-pinned {
    margin: 0;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-elevated, var(--bg-panel));
    color: var(--text-primary);
    font-size: 0.9375rem;
  }

  .squad-deploy-pinned-note {
    color: var(--text-muted);
    font-size: 0.8125rem;
  }
</style>
