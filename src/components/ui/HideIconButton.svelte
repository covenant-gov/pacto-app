<script lang="ts">
  let {
    ariaLabel,
    title = undefined,
    className = '',
    size = 22,
    onclick = undefined,
  }: {
    ariaLabel: string;
    title?: string;
    /** Extra class names for the button element. */
    className?: string;
    /** Button diameter in px; the icon scales with it. */
    size?: number;
    onclick?: (e: MouseEvent) => void;
  } = $props();
</script>

<button
  type="button"
  class="hide-icon-btn {className}"
  style="width: {size}px; height: {size}px;"
  aria-label={ariaLabel}
  {title}
  {onclick}
>
  <svg
    class="hide-icon-btn-icon"
    width="60%"
    height="60%"
    viewBox="0 0 24 24"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
    <line x1="2" x2="22" y1="2" y2="22" />
  </svg>
</button>

<style>
  .hide-icon-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    cursor: pointer;
  }

  .hide-icon-btn:hover {
    background: rgba(0, 0, 0, 0.8);
  }

  .hide-icon-btn-icon {
    display: block;
  }
</style>
