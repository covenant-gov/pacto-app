<script lang="ts">
  import { t } from 'svelte-i18n';
  import { getWalletNetworkDisplayName } from '../../../lib/wallet/assets';
  import { parseWarGameStackMeta } from '../../../lib/governance/war-game-payload';

  let { providerPayload = null }: { providerPayload?: string | null } = $props();

  const meta = $derived(parseWarGameStackMeta(providerPayload));
  const networkLabel = getWalletNetworkDisplayName('sepolia');
  const statusKey = $derived(
    meta.status === 'retired'
      ? 'governance.warGameHub.statusRetired'
      : 'governance.warGameHub.statusActive',
  );
</script>

<div class="war-game-hub-banner" role="status">
  <span>{$t(statusKey)}</span>
  <span aria-hidden="true">·</span>
  <span>{networkLabel}</span>
  {#if meta.round}
    <span aria-hidden="true">·</span>
    <span>{$t('governance.warGameHub.round', { values: { round: meta.round } })}</span>
  {/if}
</div>

<style>
  .war-game-hub-banner {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 16px;
    font-size: 0.8125rem;
    color: var(--text-muted);
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border-subtle);
  }
</style>
