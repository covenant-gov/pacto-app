<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { WarGameUpdatedPayload } from '../../lib/announcements';
  import { getWalletNetworkDisplayName } from '../../lib/wallet/assets';
  import { parseSupportedChainId } from '../../lib/wallet/chains';
  import { formatMessageTimestamp } from '../../lib/utils/message-formatting';
  import { profiles } from '../../stores/profiles';
  import { getProfileDisplayName } from '../../lib/utils/profile';

  let {
    payload,
    authorName,
    authorNpub,
    timestamp,
  }: {
    payload: WarGameUpdatedPayload;
    authorName: string;
    authorNpub?: string;
    timestamp: string;
  } = $props();

  const displayName = $derived(
    (authorNpub ? getProfileDisplayName($profiles[authorNpub]) : '') ||
      authorName ||
      $t('announcements.governanceUpdated.aMember'),
  );
  const networkLabel = $derived(getWalletNetworkDisplayName(parseSupportedChainId(payload.chain)));
  const titleKey = $derived(
    payload.action === 'redeploy'
      ? 'announcements.warGameUpdated.redeploy'
      : payload.action === 'retire'
        ? 'announcements.warGameUpdated.retire'
        : 'announcements.warGameUpdated.deploy',
  );
</script>

<div class="war-game-updated-body">
  <p class="war-game-updated-title">{$t(titleKey, { values: { who: displayName } })}</p>
  {#if networkLabel}
    <p class="war-game-updated-meta">{networkLabel}</p>
  {/if}
  <p class="war-game-updated-meta">{$t('announcements.warGameUpdated.round', { values: { round: payload.round } })}</p>
  {#if timestamp}
    <p class="war-game-updated-time">{formatMessageTimestamp(timestamp)}</p>
  {/if}
</div>

<style>
  .war-game-updated-body {
    flex: 1;
    min-width: 0;
  }

  .war-game-updated-title {
    margin: 0;
    font-weight: 600;
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--text-primary);
  }

  .war-game-updated-meta {
    margin: 4px 0 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .war-game-updated-time {
    margin: 10px 0 0;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
</style>
