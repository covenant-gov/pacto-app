<script lang="ts">
  import { t } from 'svelte-i18n';
  import EditIconButton from '../../ui/EditIconButton.svelte';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import { getWalletNetworkDisplayName } from '../../../lib/wallet/assets';
  import { listSquadDeployNetworkOptions } from '../../../lib/squad/squad-network';

  let {
    squadNetwork = null,
    squadNetworkFromInfra = false,
    onSetSquadNetwork = () => {},
  }: {
    squadNetwork?: SupportedChainId | null;
    squadNetworkFromInfra?: boolean;
    onSetSquadNetwork?: (chain: SupportedChainId) => void;
  } = $props();

  const squadNetworkOptions = listSquadDeployNetworkOptions();
  let editingNetwork = $state(false);
  let squadNetworkChoice = $state<SupportedChainId | ''>('');

  $effect(() => {
    if (!editingNetwork) squadNetworkChoice = squadNetwork ?? '';
  });

  const networkLabel = $derived(
    squadNetwork ? getWalletNetworkDisplayName(squadNetwork) : $t('governance.status.networkNotSet'),
  );
  const networkHint = $derived(squadNetworkFromInfra ? $t('governance.status.networkLocked') : '');

  function applySquadNetwork() {
    if (squadNetworkChoice && squadNetworkChoice !== squadNetwork) {
      onSetSquadNetwork(squadNetworkChoice);
    }
    editingNetwork = false;
  }

  function cancelNetworkEdit() {
    squadNetworkChoice = squadNetwork ?? '';
    editingNetwork = false;
  }
</script>

<div class="status-fact-row" id="squad-settings-network">
  <span class="meta-label">{$t('governance.status.networkLabel')}</span>
  {#if editingNetwork}
    <select class="network-select" bind:value={squadNetworkChoice} aria-label={$t('governance.status.squadNetworkLabel')}>
      <option value="" disabled>{$t('governance.status.selectPlaceholder')}</option>
      {#each squadNetworkOptions as opt (opt.id)}
        <option value={opt.id}>{opt.label}</option>
      {/each}
    </select>
    <button
      type="button"
      class="btn-text"
      disabled={!squadNetworkChoice || squadNetworkChoice === squadNetwork}
      onclick={applySquadNetwork}
    >
      {$t('governance.common.save')}
    </button>
    <button type="button" class="btn-text muted" onclick={cancelNetworkEdit}>{$t('governance.common.cancel')}</button>
  {:else}
    <span class="network-value">{networkLabel}</span>
    {#if networkHint}
      <span class="muted network-hint">{networkHint}</span>
    {/if}
    <EditIconButton
      ariaLabel={$t('governance.status.editNetwork')}
      title={$t('governance.status.editNetworkTitle')}
      on:click={() => (editingNetwork = true)}
    />
  {/if}
</div>

<style>
  .status-fact-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding: 8px 0;
    margin-bottom: 0;
    font-size: 0.875rem;
  }

  .meta-label {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    min-width: 5.5rem;
  }

  .network-value {
    font-weight: 500;
    color: var(--text-primary);
  }

  .network-hint {
    font-size: 0.75rem;
  }

  .muted {
    color: var(--text-muted);
  }

  .network-select {
    min-width: 140px;
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-size: 0.875rem;
  }

  .btn-text {
    padding: 4px 8px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.8125rem;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .btn-text:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    text-decoration: none;
  }
</style>
