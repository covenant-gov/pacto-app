<script lang="ts">
  import { t } from 'svelte-i18n';
  import { getWalletNetworkDisplayName } from '../../../lib/wallet/assets';
  import { parseWarGameStackMeta } from '../../../lib/governance/war-game-payload';
  import { WAR_GAME_PUBLIC_RULES_URL } from '../../../lib/governance/war-game-links';
  import { openExternalUrl } from '../../../lib/utils/open-external';

  let { providerPayload = null }: { providerPayload?: string | null } = $props();

  const meta = $derived(parseWarGameStackMeta(providerPayload));
  const networkLabel = getWalletNetworkDisplayName('sepolia');
  const statusKey = $derived(
    meta.status === 'retired'
      ? 'governance.warGameHub.statusRetired'
      : 'governance.warGameHub.statusActive',
  );
  const copyKey = $derived(
    meta.status === 'retired' ? 'governance.warGameHub.retiredHint' : 'governance.warGameHub.objective',
  );
</script>

<div class="war-game-hub-banner" role="status">
  <p class="war-game-hub-meta">
    <span>{$t(statusKey)}</span>
    <span aria-hidden="true">·</span>
    <span>{networkLabel}</span>
    {#if meta.round}
      <span aria-hidden="true">·</span>
      <span>{$t('governance.warGameHub.round', { values: { round: meta.round } })}</span>
    {/if}
  </p>
  <p class="war-game-hub-copy">{$t(copyKey)}</p>
  <button
    type="button"
    class="war-game-hub-rules"
    onclick={() => void openExternalUrl(WAR_GAME_PUBLIC_RULES_URL)}
  >
    {$t('governance.warGameHub.rulesLink')}
  </button>
</div>

<style>
  .war-game-hub-banner {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 10px 16px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border-subtle);
  }

  .war-game-hub-meta,
  .war-game-hub-copy {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--text-muted);
  }

  .war-game-hub-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }

  .war-game-hub-rules {
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.8125rem;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
