<script lang="ts">
  /** Optional id for the error element (for aria-describedby on retry button). */
  export let errorId: string | undefined = undefined;
  export let error: string | undefined = undefined;
  export let canRetry = false;
  export let retrying = false;
  export let onRetry: (() => void) | undefined = undefined;
</script>

<div class="parent-setting-up" role="status" aria-live="polite">
  {#if error}
    <p class="setting-up-error" role="alert" id={errorId}>{error}</p>
    {#if canRetry && onRetry}
      <button
        type="button"
        class="setting-up-retry-btn"
        disabled={retrying}
        on:click={onRetry}
        aria-describedby={errorId || undefined}
      >
        {retrying ? 'Retrying…' : 'Retry'}
      </button>
    {/if}
  {:else}
    <div class="setting-up-spinner" aria-hidden="true"></div>
    <p class="setting-up-text">Setting up…</p>
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
    border-top-color: var(--accent);
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
    background: var(--accent);
    border: none;
    border-radius: 6px;
    color: #fff;
    cursor: pointer;
  }

  .setting-up-retry-btn:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .setting-up-retry-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }
</style>
