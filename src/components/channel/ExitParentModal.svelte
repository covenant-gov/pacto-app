<script lang="ts">
  import { t } from 'svelte-i18n';

  export let open = false;
  export let parentName = '';
  export let error = '';
  export let exiting = false;

  export let onClose: () => void = () => {};
  export let onConfirm: () => void = () => {};

  const titleId = 'exit-parent-modal-title';
  $: title = $t('messaging.exitParent.title');
  $: confirmLabel = $t('messaging.exitParent.confirm');
  $: message = parentName
    ? $t('messaging.exitParent.messageNamed', { values: { parentName } })
    : $t('messaging.exitParent.messageUnnamed');
</script>

{#if open}
  <div
    class="parent-modal-overlay"
    role="button"
    tabindex="-1"
    onclick={onClose}
    onkeydown={(e) => e.key === 'Escape' && onClose()}
  >
    <div
      class="parent-modal-content exit-parent-content"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-label="{$t('messaging.exitParent.title')}{parentName ? ' ' + parentName : ''}"
      tabindex="0"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.key === 'Escape' && onClose()}
    >
      <h2 id={titleId}>{title}</h2>
      <p class="exit-parent-message">{message}</p>
      {#if error}
        <p class="exit-parent-error" role="alert">{error}</p>
      {/if}
      <div class="exit-parent-actions">
        <button
          type="button"
          class="exit-parent-btn-cancel"
          onclick={onClose}
          disabled={exiting}
        >
          {$t('messaging.exitParent.cancel')}
        </button>
        <button
          type="button"
          class="exit-parent-btn-confirm"
          onclick={onConfirm}
          disabled={exiting}
        >
          {exiting ? $t('messaging.exitParent.exiting') : confirmLabel}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .parent-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(4px);
  }

  .parent-modal-content {
    background: var(--bg-elevated);
    border-radius: 12px;
    padding: 32px;
    max-width: 420px;
    width: 90%;
    max-height: 85vh;
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

  .parent-modal-content h2 {
    color: var(--text-primary);
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0 0 8px 0;
  }

  .exit-parent-message {
    color: var(--text-secondary);
    font-size: 0.9375rem;
    margin: 0 0 20px 0;
    line-height: 1.5;
  }

  .exit-parent-error {
    color: var(--danger);
    background: rgba(242, 63, 66, 0.1);
    padding: 12px 16px;
    border-radius: 8px;
    margin-bottom: 16px;
    font-size: 0.875rem;
  }

  .exit-parent-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 24px;
  }

  .exit-parent-btn-cancel {
    padding: 8px 16px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-secondary);
    font-size: 0.9375rem;
    cursor: pointer;
  }

  .exit-parent-btn-cancel:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .exit-parent-btn-confirm {
    padding: 8px 16px;
    background: var(--danger);
    border: none;
    border-radius: 8px;
    color: #fff;
    font-size: 0.9375rem;
    cursor: pointer;
  }

  .exit-parent-btn-confirm:hover:not(:disabled) {
    filter: brightness(0.9);
  }

  .exit-parent-btn-confirm:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
