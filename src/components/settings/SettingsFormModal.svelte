<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from 'svelte-i18n';
  import Modal from '../ui/Modal.svelte';

  let {
    titleId,
    title,
    busy = false,
    primaryLabel,
    primaryBusyLabel,
    primaryDisabled = false,
    cancelLabel,
    onClose,
    onPrimary,
    children,
    footerStart,
    error = null,
    contentClass = 'settings-form-modal',
  }: {
    titleId: string;
    title: string;
    busy?: boolean;
    primaryLabel: string;
    primaryBusyLabel?: string;
    primaryDisabled?: boolean;
    cancelLabel?: string;
    onClose: () => void;
    onPrimary: () => void | Promise<void>;
    children: Snippet;
    /** Optional controls before Cancel (e.g. Test relay). */
    footerStart?: Snippet;
    error?: string | null;
    contentClass?: string;
  } = $props();

  let cancelText = $derived(cancelLabel ?? $t('settings.cancel'));
  let primaryText = $derived(busy ? (primaryBusyLabel ?? primaryLabel) : primaryLabel);

  function handleClose() {
    if (!busy) onClose();
  }

  async function handlePrimary() {
    if (busy || primaryDisabled) return;
    await onPrimary();
  }
</script>

<Modal {titleId} onClose={handleClose} dismissible={!busy} {contentClass}>
  <h2 id={titleId}>{title}</h2>
  <div class="settings-form-modal-body">
    {@render children()}
  </div>
  {#if error}
    <p class="settings-form-modal-error" role="alert">{error}</p>
  {/if}
  <div class="settings-form-modal-actions">
    {#if footerStart}
      <div class="settings-form-modal-actions-start">
        {@render footerStart()}
      </div>
    {/if}
    <button type="button" class="settings-form-modal-btn settings-form-modal-btn--secondary" disabled={busy} onclick={handleClose}>
      {cancelText}
    </button>
    <button
      type="button"
      class="settings-form-modal-btn settings-form-modal-btn--primary"
      disabled={busy || primaryDisabled}
      onclick={() => void handlePrimary()}
    >
      {primaryText}
    </button>
  </div>
</Modal>

<style>
  :global(.settings-form-modal) {
    max-width: 480px;
  }

  .settings-form-modal-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 12px;
  }

  .settings-form-modal-error {
    margin: 12px 0 0;
    color: var(--danger);
    font-size: 0.875rem;
  }

  .settings-form-modal-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 20px;
  }

  .settings-form-modal-actions-start {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-right: auto;
  }

  .settings-form-modal-btn {
    min-height: 40px;
    padding: 0 16px;
    border-radius: 8px;
    font-size: 0.9375rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
  }

  .settings-form-modal-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .settings-form-modal-btn--secondary {
    border: 1px solid var(--border);
    background: var(--bg-panel);
    color: var(--text-primary);
  }

  .settings-form-modal-btn--primary {
    border: none;
    background: var(--brand);
    color: var(--on-brand);
  }

  .settings-form-modal-btn--primary:hover:not(:disabled) {
    filter: brightness(1.05);
  }

  :global(.settings-form-modal .settings-form-field) {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  :global(.settings-form-modal .settings-form-label) {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-secondary);
  }

  :global(.settings-form-modal .settings-form-input),
  :global(.settings-form-modal .settings-form-select),
  :global(.settings-form-modal .settings-form-textarea) {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 0.875rem;
    font-family: inherit;
  }

  :global(.settings-form-modal .settings-form-input:focus),
  :global(.settings-form-modal .settings-form-select:focus),
  :global(.settings-form-modal .settings-form-textarea:focus) {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }

  :global(.settings-form-modal .settings-form-textarea) {
    min-height: 5.5rem;
    resize: vertical;
  }

  :global(.settings-form-modal .settings-form-warn) {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--warning, #e6a23c);
  }

  :global(.settings-form-modal .settings-form-status) {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  :global(.settings-form-modal .settings-form-status--ok) {
    color: var(--success);
  }

  :global(.settings-form-modal .settings-form-status--bad) {
    color: var(--danger);
  }

  :global(.settings-form-modal .settings-form-btn-secondary) {
    min-height: 40px;
    padding: 0 14px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 0.875rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
  }

  :global(.settings-form-modal .settings-form-btn-secondary:disabled) {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
