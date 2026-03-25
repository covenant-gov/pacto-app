<script lang="ts">
  /**
   * Shared modal: overlay, content box, Escape to close, click-outside to close,
   * focus trap + restore focus on destroy.
   */
  import { onMount, tick } from 'svelte';

  export let titleId: string;
  export let descriptionId: string | undefined = undefined;
  export let onClose: () => void;
  /** When false, overlay click and Escape do not close (e.g. in-flight async work). */
  export let dismissible = true;

  let dialogEl: HTMLDivElement;

  const FOCUSABLE_SELECTOR =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function handleOverlayClick() {
    if (dismissible) onClose();
  }

  function handleContentKeydown(e: KeyboardEvent) {
    if (dismissible && e.key === 'Escape') onClose();
  }

  onMount(() => {
    const previouslyFocused = document.activeElement;
    let removeTrap: (() => void) | null = null;
    let cancelled = false;

    tick().then(() => {
      if (cancelled || !dialogEl) return;

      function focusables(): HTMLElement[] {
        return Array.from(dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
          (el) => !el.hasAttribute('disabled')
        );
      }

      const list = focusables();
      if (list.length > 0) {
        list[0].focus();
      } else {
        dialogEl.focus();
      }

      function onDocumentKeydown(e: KeyboardEvent) {
        if (e.key !== 'Tab') return;
        const nodes = focusables();
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement;
        if (e.shiftKey) {
          if (active === first || active === dialogEl) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }

      document.addEventListener('keydown', onDocumentKeydown, true);
      removeTrap = () => document.removeEventListener('keydown', onDocumentKeydown, true);
    });

    return () => {
      cancelled = true;
      removeTrap?.();
      if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-overlay" on:click={handleOverlayClick}>
  <div
    bind:this={dialogEl}
    class="modal-content"
    role="dialog"
    aria-modal="true"
    aria-busy={dismissible ? undefined : 'true'}
    aria-labelledby={titleId}
    aria-describedby={descriptionId ?? undefined}
    tabindex="-1"
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
