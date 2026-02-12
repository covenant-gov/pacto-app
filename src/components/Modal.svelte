<script lang="ts">
  /**
   * Shared modal: overlay, content box, Escape/click-outside to close.
   * Parent supplies title (with matching id for titleId), optional description, and body via default slot.
   */
  export let titleId: string;
  export let descriptionId: string | undefined = undefined;
  export let onClose: () => void;

  function handleOverlayClick() {
    onClose();
  }

  function handleOverlayKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  function handleContentKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

<div
  class="modal-overlay"
  role="button"
  tabindex="-1"
  on:click={handleOverlayClick}
  on:keydown={handleOverlayKeydown}
  aria-label="Close modal"
>
  <div
    class="modal-content"
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    aria-describedby={descriptionId}
    tabindex="0"
    on:click|stopPropagation
    on:keydown={handleContentKeydown}
  >
    <slot />
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(4px);
  }

  .modal-content {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 32px;
    max-width: 420px;
    width: 90%;
    max-height: 85vh;
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

  .modal-content :global(h2) {
    color: var(--text-primary);
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0 0 8px 0;
  }

  .modal-content :global(h2:first-child) {
    margin-top: 0;
  }
</style>
