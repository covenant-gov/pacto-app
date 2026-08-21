<script lang="ts">
  import { t } from 'svelte-i18n';
  import { getWalletNetworkDisplayName } from '../../../lib/wallet/assets';
  import {
    isWarGameArchiveView,
    parseWarGameRoundNumber,
    parseWarGameStackMeta,
    warGameDelayMinutes,
  } from '../../../lib/governance/war-game-payload';

  let {
    providerPayload = null,
    viewedRound = 0,
    onViewedRound = () => {},
  }: {
    providerPayload?: string | null;
    viewedRound?: number;
    onViewedRound?: (round: number) => void;
  } = $props();

  const meta = $derived(parseWarGameStackMeta(providerPayload));
  const activeRound = $derived(parseWarGameRoundNumber(providerPayload));
  const maxRound = $derived(activeRound);
  const currentRound = $derived(
    activeRound > 0 ? (viewedRound > 0 ? viewedRound : activeRound) : 0,
  );
  const archiveView = $derived(isWarGameArchiveView(currentRound, activeRound));
  const inactive = $derived(archiveView || meta.status === 'retired');
  const networkLabel = getWalletNetworkDisplayName('sepolia');
  const statusKey = $derived(
    inactive ? 'governance.warGameHub.statusRetired' : 'governance.warGameHub.statusActive',
  );
  const delayMinutes = $derived(warGameDelayMinutes(providerPayload));
  const roundLabel = $derived(currentRound > 0 ? String(currentRound) : '');

  function prevRound() {
    if (currentRound <= 1) return;
    onViewedRound(currentRound - 1);
  }

  function nextRound() {
    if (maxRound < 1 || currentRound >= maxRound) return;
    onViewedRound(currentRound + 1);
  }
</script>

<div class="war-game-hub-banner" role="status">
  <div class="war-game-hub-meta-row">
    <p class="war-game-hub-meta">
      <span>{$t(statusKey)}</span>
      <span aria-hidden="true">·</span>
      <span>{networkLabel}</span>
      {#if roundLabel}
        <span aria-hidden="true">·</span>
        <span>{$t('governance.warGameHub.round', { values: { round: roundLabel } })}</span>
      {/if}
    </p>
    <div class="war-game-hub-pager" role="group" aria-label={$t('governance.warGameHub.roundPager')}>
      <button
        type="button"
        class="war-game-hub-pager-btn"
        aria-label={$t('governance.warGameHub.prevRound')}
        title={$t('governance.warGameHub.prevRound')}
        disabled={currentRound <= 1}
        onclick={prevRound}
      >
        &lt;
      </button>
      <button
        type="button"
        class="war-game-hub-pager-btn"
        aria-label={$t('governance.warGameHub.nextRound')}
        title={$t('governance.warGameHub.nextRound')}
        disabled={maxRound < 1 || currentRound >= maxRound}
        onclick={nextRound}
      >
        &gt;
      </button>
    </div>
  </div>
  <p class="war-game-hub-facts">
    <span>{$t('governance.warGameHub.delay', { values: { minutes: delayMinutes } })}</span>
    <span aria-hidden="true">·</span>
    <span>{$t('governance.warGameHub.mode')}</span>
  </p>
  {#if archiveView}
    <p class="war-game-hub-facts">{$t('governance.warGameHub.archiveNotice')}</p>
  {/if}
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

  .war-game-hub-meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .war-game-hub-meta,
  .war-game-hub-facts {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--text-muted);
  }

  .war-game-hub-meta,
  .war-game-hub-facts {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }

  .war-game-hub-pager {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .war-game-hub-pager-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--bg-elevated);
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.875rem;
    line-height: 1;
    cursor: pointer;
  }

  .war-game-hub-pager-btn:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .war-game-hub-pager-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
</style>
