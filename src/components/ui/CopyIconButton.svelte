<script lang="ts">
  import { t } from 'svelte-i18n';

  let {
    disabled = false,
    ariaLabel = undefined,
    title = undefined,
    className = '',
    size = 32,
    onclick = undefined,
  }: {
    disabled?: boolean;
    ariaLabel?: string;
    title?: string;
    className?: string;
    /** Button diameter in px. */
    size?: number;
    onclick?: (e: MouseEvent) => void;
  } = $props();
</script>

<button
  type="button"
  class="copy-icon-btn {className}"
  style="width: {size}px; height: {size}px;"
  {disabled}
  aria-label={ariaLabel ?? $t('ui.copy')}
  title={title ?? ariaLabel ?? $t('ui.copy')}
  {onclick}
>
  <svg
    class="copy-icon-btn-icon"
    width="60%"
    height="60%"
    viewBox="0 0 24 24"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
</button>

<style>
  .copy-icon-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .copy-icon-btn:hover:not(:disabled) {
    border-color: var(--brand);
    color: var(--text-primary);
  }

  .copy-icon-btn:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 1px;
  }

  .copy-icon-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .copy-icon-btn-icon {
    display: block;
  }
</style>
