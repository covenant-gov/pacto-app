<script lang="ts">
  import { t } from 'svelte-i18n';

  interface Props {
    /** Optional id for the error element (for aria-describedby on retry button). */
    errorId?: string;
    error?: string;
    canRetry?: boolean;
    retrying?: boolean;
    onRetry?: () => void;
    canDiscard?: boolean;
    onDiscard?: () => void;
  }

  let {
    errorId,
    error,
    canRetry = false,
    retrying = false,
    onRetry,
    canDiscard = false,
    onDiscard,
  }: Props = $props();
</script>

<div class="parent-setting-up" role="status" aria-live="polite">
  {#if error}
    <p class="setting-up-error" role="alert" id={errorId}>{error}</p>
    <div class="setting-up-actions">
      {#if canRetry && onRetry}
        <button
          type="button"
          class="setting-up-retry-btn"
          disabled={retrying}
          onclick={onRetry}
          aria-describedby={errorId || undefined}
        >
          {retrying ? $t('governance.common.retrying') : $t('governance.common.retry')}
        </button>
      {/if}
      {#if canDiscard && onDiscard}
        <button type="button" class="setting-up-discard-btn" onclick={onDiscard}>
          {$t('nav.parentNavbar.create.discard')}
        </button>
      {/if}
    </div>
  {:else}
    <div class="setting-up-spinner" aria-hidden="true"></div>
    <p class="setting-up-text">{$t('governance.settingUp')}</p>
  {/if}
</div>

<style>
  .parent-setting-up {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 24px 16px;
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  .setting-up-spinner {
    width: 28px;
    height: 28px;
    border: 3px solid var(--border-subtle);
    border-top-color: var(--brand);
    border-radius: 50%;
    animation: parent-setting-up-spin 0.9s linear infinite;
  }

  @keyframes parent-setting-up-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .setting-up-text {
    margin: 0;
  }

  .setting-up-error {
    margin: 0;
    color: var(--danger);
    font-size: 0.8125rem;
    text-align: center;
  }

  .setting-up-retry-btn {
    margin-top: 4px;
    padding: 6px 12px;
    font-size: 0.8125rem;
    background: var(--brand);
    border: none;
    border-radius: 6px;
    color: var(--on-brand);
    cursor: pointer;
  }

  .setting-up-retry-btn:hover:not(:disabled) {
    background: var(--brand-hover);
  }

  .setting-up-retry-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .setting-up-actions {
    display: flex;
    gap: 8px;
  }

  .setting-up-discard-btn {
    margin-top: 4px;
    padding: 6px 12px;
    font-size: 0.8125rem;
    background: transparent;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    color: var(--text-muted);
    cursor: pointer;
  }

  .setting-up-discard-btn:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }
</style>
