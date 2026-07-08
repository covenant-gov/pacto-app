<script lang="ts">
  export let disabled = false;
  export let ariaLabel = 'Edit';
  export let title: string | undefined = undefined;
  /** Extra class names for the button element. */
  export let className = '';
</script>

<button
  type="button"
  class="edit-icon-btn {className}"
  {disabled}
  aria-label={ariaLabel}
  {title}
  on:click
>
  <svg
    class="edit-icon-btn-icon"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
</button>

<style>
  .edit-icon-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .edit-icon-btn:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }

  .edit-icon-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .edit-icon-btn-icon {
    display: block;
  }
</style>
