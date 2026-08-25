<script lang="ts">
  let {
    disabled = false,
    ariaLabel = 'Info',
    title = undefined,
    className = '',
    onclick = undefined,
  }: {
    disabled?: boolean;
    ariaLabel?: string;
    title?: string;
    /** Extra class names for the button element. */
    className?: string;
    onclick?: () => void;
  } = $props();
</script>

<button
  type="button"
  class="info-icon-btn {className}"
  {disabled}
  aria-label={ariaLabel}
  {title}
  {onclick}
>
  <svg
    class="info-icon-btn-icon"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M12 16V12M12 8H12.01M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12Z"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</button>

<style>
  .info-icon-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .info-icon-btn:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }

  .info-icon-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .info-icon-btn-icon {
    display: block;
  }
</style>
