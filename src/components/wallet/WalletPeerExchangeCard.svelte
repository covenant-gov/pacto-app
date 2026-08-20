<script lang="ts">
  import { t } from 'svelte-i18n';

  /**
   * Thread card for private wallet-address exchange (request / grant / decline).
   * Structured content is still parsed for persistence; this is the human-visible summary.
   */
  export let variant:
    | 'request-in'
    | 'request-out'
    | 'grant-in'
    | 'grant-out'
    | 'decline-in'
    | 'decline-out';
  export let peerName: string;
  /** For request-in only. */
  export let status: 'pending' | 'accepted' | 'declined' = 'pending';
  export let accepting = false;
  export let onAccept: (() => void) | undefined = undefined;
  export let onDecline: (() => void) | undefined = undefined;

  $: title = (() => {
    switch (variant) {
      case 'request-in':
        return $t('wallet.peerRequestInTitle');
      case 'request-out':
        return $t('wallet.peerRequestOutTitle');
      case 'grant-in':
        return $t('wallet.peerGrantInTitle');
      case 'grant-out':
        return $t('wallet.peerGrantOutTitle');
      case 'decline-in':
        return $t('wallet.peerDeclineInTitle');
      case 'decline-out':
        return $t('wallet.peerDeclineOutTitle');
      default:
        return $t('wallet.walletTitle');
    }
  })();

  $: body = (() => {
    switch (variant) {
      case 'request-in':
        return $t('wallet.peerRequestInBody', { values: { peerName } });
      case 'request-out':
        return $t('wallet.peerRequestOutBody', { values: { peerName } });
      case 'grant-in':
        return $t('wallet.peerGrantInBody', { values: { peerName } });
      case 'grant-out':
        return $t('wallet.peerGrantOutBody', { values: { peerName } });
      case 'decline-in':
        return $t('wallet.peerDeclineInBody', { values: { peerName } });
      case 'decline-out':
        return $t('wallet.peerDeclineOutBody', { values: { peerName } });
      default:
        return '';
    }
  })();

  $: collapsed = variant === 'request-in' && (status === 'accepted' || status === 'declined');
</script>

<div class="wpeer-card" class:collapsed role="article">
  <div class="wpeer-icon" aria-hidden="true">◈</div>
  <div class="wpeer-body">
    <p class="wpeer-title">{title}</p>
    {#if !collapsed || variant !== 'request-in'}
      <p class="wpeer-text">{body}</p>
    {/if}
    {#if variant === 'request-in'}
      {#if status === 'accepted'}
        <p class="wpeer-status wpeer-ok" aria-live="polite">{$t('wallet.accepted')}</p>
      {:else if status === 'declined'}
        <p class="wpeer-status wpeer-no" aria-live="polite">{$t('wallet.declined')}</p>
      {:else}
        <div class="wpeer-actions">
          <button
            type="button"
            class="wpeer-btn wpeer-accept"
            disabled={accepting}
            onclick={() => onAccept?.()}
          >
            {accepting ? $t('wallet.accepting') : $t('wallet.accept')}
          </button>
          <button
            type="button"
            class="wpeer-btn wpeer-decline"
            disabled={accepting}
            onclick={() => onDecline?.()}
          >
            {$t('wallet.decline')}
          </button>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .wpeer-card {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin: 8px 16px;
    padding: 12px 14px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    max-width: 380px;
    border-left: 3px solid var(--brand, #6c5ce7);
  }

  .wpeer-card.collapsed {
    align-items: center;
    padding: 8px 14px;
  }

  .wpeer-icon {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: 8px;
    background: var(--bg-panel);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    color: var(--text-primary);
  }

  .wpeer-body {
    flex: 1;
    min-width: 0;
  }

  .wpeer-title {
    margin: 0 0 6px;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .wpeer-text {
    margin: 0 0 10px;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-secondary);
  }

  .wpeer-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .wpeer-btn {
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid var(--border);
    background: var(--bg-panel);
    color: var(--text-primary);
  }

  .wpeer-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .wpeer-accept {
    background: var(--brand, #6c5ce7);
    color: var(--on-brand);
    border-color: transparent;
  }

  .wpeer-decline {
    background: transparent;
  }

  .wpeer-status {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .wpeer-ok {
    color: var(--success, #27ae60);
  }

  .wpeer-no {
    color: var(--text-secondary);
  }
</style>
