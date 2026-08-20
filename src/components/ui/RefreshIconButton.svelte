<script lang="ts">
  let {
    disabled = false,
    spinning = false,
    ariaLabel = 'Refresh',
    title = undefined,
    className = '',
    onclick = undefined,
  }: {
    disabled?: boolean;
    spinning?: boolean;
    ariaLabel?: string;
    title?: string;
    /** Extra class names for the button element. */
    className?: string;
    onclick?: () => void;
  } = $props();
</script>

<button
  type="button"
  class="refresh-icon-btn {className}"
  {disabled}
  aria-label={ariaLabel}
  {title}
  {onclick}
>
  <svg
    class="refresh-icon-btn-icon"
    class:is-spinning={spinning}
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M21 12a9 9 0 1 1-2.64-6.36"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path
      d="M21 3v6h-6"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path
      d="M3 12a9 9 0 1 1 2.64 6.36"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path
      d="M3 21v-6h6"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</button>

<style>
  .refresh-icon-btn {
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

  .refresh-icon-btn:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }

  .refresh-icon-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .refresh-icon-btn-icon {
    display: block;
  }

  .refresh-icon-btn-icon.is-spinning {
    animation: refresh-icon-spin 0.8s linear infinite;
  }

  @keyframes refresh-icon-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
