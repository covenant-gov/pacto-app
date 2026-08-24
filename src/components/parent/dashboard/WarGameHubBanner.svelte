<script lang="ts">
  import { t } from 'svelte-i18n';
  import { getWalletNetworkDisplayName } from '../../../lib/wallet/assets';
  import {
    parseWarGameRoundNumber,
    parseWarGameStackMeta,
    warGameDelayMinutes,
  } from '../../../lib/governance/war-game-payload';

  let { providerPayload = null }: { providerPayload?: string | null } = $props();

  const meta = $derived(parseWarGameStackMeta(providerPayload));
  const currentRound = $derived(parseWarGameRoundNumber(providerPayload));
  const inactive = $derived(meta.status !== 'active');
  const networkLabel = getWalletNetworkDisplayName('sepolia');
  const statusKey = $derived(
    inactive ? 'governance.warGameHub.statusRetired' : 'governance.warGameHub.statusActive',
  );
  const delayMinutes = $derived(warGameDelayMinutes(providerPayload));
  const roundLabel = $derived(currentRound > 0 ? String(currentRound) : '');
</script>

<div class="war-game-hub-banner" role="status">
  <p class="war-game-hub-meta">
    <span>{$t(statusKey)}</span>
    <span aria-hidden="true">·</span>
    <span>{networkLabel}</span>
    {#if roundLabel}
      <span aria-hidden="true">·</span>
      <span>{$t('governance.warGameHub.round', { values: { round: roundLabel } })}</span>
    {/if}
  </p>
  <p class="war-game-hub-facts">
    <span>{$t('governance.warGameHub.delay', { values: { minutes: delayMinutes } })}</span>
    <span aria-hidden="true">·</span>
    <span>{$t('governance.warGameHub.mode')}</span>
  </p>
</div>

<style>
  .war-game-hub-banner {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
    padding: 10px 16px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border-subtle);
  }

  .war-game-hub-meta,
  .war-game-hub-facts {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }
</style>
