<script lang="ts">
  import { t } from 'svelte-i18n';
  import EditIconButton from '../../ui/EditIconButton.svelte';
  import DashboardAssetCard from './DashboardAssetCard.svelte';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import { getWalletNetworkDisplayName } from '../../../lib/wallet/assets';
  import { listSquadDeployNetworkOptions, type SquadNetworkSlot } from '../../../lib/squad/squad-network';
  import { squadSettingsNetworkFocusNonce, squadSettingsNetworkFocusSlot } from '../../../stores/navigation';

  let {
    primaryNetwork,
    practiceNetwork,
    onSetPrimaryNetwork = () => {},
    onSetPracticeNetwork = () => {},
  }: {
    primaryNetwork: SupportedChainId;
    practiceNetwork: SupportedChainId;
    onSetPrimaryNetwork?: (chain: SupportedChainId) => void;
    onSetPracticeNetwork?: (chain: SupportedChainId) => void;
  } = $props();

  const squadNetworkOptions = listSquadDeployNetworkOptions();
  let editingSlot = $state<SquadNetworkSlot | null>(null);
  let slotChoice = $state<SupportedChainId | ''>('');
  let lastNetworkFocusNonce = $state(0);

  const rows = $derived(
    [
      {
        slot: 'primary' as const,
        value: primaryNetwork,
        labelKey: 'governance.status.networkPrimary',
        editKey: 'governance.status.editPrimaryNetwork',
      },
      {
        slot: 'practice' as const,
        value: practiceNetwork,
        labelKey: 'governance.status.networkPractice',
        editKey: 'governance.status.editPracticeNetwork',
      },
    ] as const,
  );

  $effect(() => {
    if (!editingSlot) slotChoice = '';
  });

  $effect(() => {
    const nonce = $squadSettingsNetworkFocusNonce;
    if (nonce <= lastNetworkFocusNonce) return;
    lastNetworkFocusNonce = nonce;
    editingSlot = $squadSettingsNetworkFocusSlot;
    slotChoice = editingSlot === 'practice' ? practiceNetwork : primaryNetwork;
    if (typeof document !== 'undefined') {
      queueMicrotask(() => {
        document.getElementById('squad-settings-network')?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      });
    }
  });

  function startEdit(slot: SquadNetworkSlot, current: SupportedChainId) {
    editingSlot = slot;
    slotChoice = current;
  }

  function applySlot() {
    if (!editingSlot || !slotChoice) {
      editingSlot = null;
      return;
    }
    const current = editingSlot === 'primary' ? primaryNetwork : practiceNetwork;
    if (slotChoice !== current) {
      if (editingSlot === 'primary') onSetPrimaryNetwork(slotChoice);
      else onSetPracticeNetwork(slotChoice);
    }
    editingSlot = null;
  }

  function cancelEdit() {
    editingSlot = null;
    slotChoice = '';
  }
</script>

<DashboardAssetCard
  id="squad-settings-network"
  headingId="squad-settings-network-heading"
  heading={$t('governance.status.networkLabel')}
>
  <dl class="asset-dl">
    {#each rows as row (row.slot)}
      <dt>{$t(row.labelKey)}</dt>
      <dd class="asset-dd-inline">
        {#if editingSlot === row.slot}
          <select
            class="network-select"
            bind:value={slotChoice}
            aria-label={$t(row.labelKey)}
          >
            {#each squadNetworkOptions as opt (opt.id)}
              <option value={opt.id}>{opt.label}</option>
            {/each}
          </select>
          <button
            type="button"
            class="btn-text"
            disabled={!slotChoice || slotChoice === row.value}
            onclick={applySlot}
          >
            {$t('governance.common.save')}
          </button>
          <button type="button" class="btn-text muted" onclick={cancelEdit}>
            {$t('governance.common.cancel')}
          </button>
        {:else}
          <strong>{getWalletNetworkDisplayName(row.value)}</strong>
          <EditIconButton
            ariaLabel={$t(row.editKey)}
            title={$t(row.editKey)}
            onclick={() => startEdit(row.slot, row.value)}
          />
        {/if}
      </dd>
    {/each}
  </dl>
</DashboardAssetCard>

<style>
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
