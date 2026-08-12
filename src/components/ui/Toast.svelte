<script lang="ts">
  import { toastMessage, clearToast, runToastRetryAction, type ToastGoTo } from '../../stores/toast';
  import { navigateToTarget } from '../../lib/navigation/open-squad-dashboard';
  import { t } from 'svelte-i18n';

  function goToSpace(goTo: ToastGoTo) {
    navigateToTarget({
      kind: 'squad-channel',
      squadId: goTo.id,
      channelId: goTo.channelId,
      hubChannelName: goTo.hubChannelName,
    });
    clearToast();
  }
</script>

{#if $toastMessage}
  <div
    class="toast"
    class:toast-error={!!$toastMessage.error}
    role={$toastMessage.error ? 'alert' : 'status'}
    aria-live={$toastMessage.error ? 'assertive' : 'polite'}
  >
    <span class="toast-icon" aria-hidden="true">{$toastMessage.error ? '!' : '✓'}</span>
    <div class="toast-body">
      <span class="toast-text">{$toastMessage.text}</span>
      {#if $toastMessage.goTo}
        <button
          type="button"
          class="toast-go-btn"
          on:click={() => goToSpace($toastMessage!.goTo!)}
          aria-label="{$t('commons.goTo')} {$toastMessage.goTo.name}"
        >
          {$t('commons.goTo')} {$toastMessage.goTo.name}
        </button>
      {/if}
      {#if $toastMessage.retryLabel}
        <button
          type="button"
          class="toast-go-btn"
          on:click={runToastRetryAction}
          aria-label={$toastMessage.retryLabel}
        >
          {$toastMessage.retryLabel}
        </button>
      {/if}
    </div>
    <button type="button" class="toast-dismiss" on:click={clearToast} aria-label={$t('commons.dismiss')}>
      ×
    </button>
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    top: 24px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 16px 12px 20px;
    max-width: min(560px, calc(100vw - 32px));
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    color: var(--text-primary);
    font-size: 0.9375rem;
    font-weight: 500;
    z-index: 99999;
    animation: toast-in 0.25s ease-out;
    pointer-events: auto;
  }

  .toast-error {
    border-color: color-mix(in srgb, var(--danger, #e53e3e) 55%, var(--border));
  }

  .toast-icon {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    margin-top: 1px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--brand);
    color: #fff;
    border-radius: 50%;
    font-size: 0.75rem;
    font-weight: 700;
  }

  .toast-error .toast-icon {
    background: var(--danger, #e53e3e);
  }

  .toast-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }

  .toast-text {
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .toast-go-btn {
    align-self: flex-start;
    padding: 4px 10px;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--brand);
    background: transparent;
    border: 1px solid var(--brand);
    border-radius: 6px;
    cursor: pointer;
  }

  .toast-go-btn:hover {
    background: var(--bg-hover);
  }

  .toast-dismiss {
    flex-shrink: 0;
    margin: -4px -4px 0 0;
    padding: 4px 8px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 1.25rem;
    line-height: 1;
    cursor: pointer;
    border-radius: 6px;
  }

  .toast-dismiss:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }
</style>
