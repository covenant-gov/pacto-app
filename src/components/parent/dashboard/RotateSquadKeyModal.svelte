<script lang="ts">
  import Modal from '../../ui/Modal.svelte';

  export let open = false;
  export let onClose: () => void = () => {};

  /** Enable when squad key rotation backend is wired. */
  const GENERATE_NEW_KEY_ENABLED = false;
</script>

{#if open}
  <Modal
    titleId="rotate-squad-key-title"
    descriptionId="rotate-squad-key-description"
    onClose={onClose}
  >
    <h2 id="rotate-squad-key-title">Rotate personal signer key for this Squad</h2>
    <p id="rotate-squad-key-description" class="rotate-modal-lead">
      Choose how to update the EVM address members see for you in this squad.
    </p>
    <div class="rotate-modal-options">
      <button
        type="button"
        class="rotate-option"
        disabled={!GENERATE_NEW_KEY_ENABLED}
        title={GENERATE_NEW_KEY_ENABLED ? undefined : 'Coming soon'}
      >
        <span class="rotate-option-label">Generate new key</span>
        <span class="rotate-option-hint">New squad-purpose derived address for this squad only.</span>
      </button>
    </div>
    <div class="rotate-modal-actions">
      <button type="button" class="btn-secondary" on:click={onClose}>Cancel</button>
    </div>
  </Modal>
{/if}

<style>
  .rotate-modal-lead {
    margin: 0 0 16px;
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--text-secondary);
  }

  .rotate-modal-options {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 20px;
  }

  .rotate-option {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    width: 100%;
    padding: 12px 14px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-elevated);
    text-align: left;
    cursor: pointer;
    font-family: inherit;
  }

  .rotate-option:hover:not(:disabled) {
    border-color: var(--accent);
  }

  .rotate-option:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .rotate-option-label {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .rotate-option-hint {
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--text-muted);
  }

  .rotate-modal-actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
