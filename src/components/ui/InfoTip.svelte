<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from 'svelte-i18n';
  import * as Tooltip from '$lib/components/ui/tooltip/index.js';

  let {
    text = '',
    ariaLabel = undefined,
    side = 'top',
    className = '',
    children,
  }: {
    /** Tip body when not using `children`. */
    text?: string;
    ariaLabel?: string;
    side?: 'top' | 'right' | 'bottom' | 'left';
    className?: string;
    children?: Snippet;
  } = $props();
</script>

<Tooltip.Root>
  <Tooltip.Trigger>
    {#snippet child({ props })}
      <button
        type="button"
        class="info-tip-trigger {className}"
        aria-label={ariaLabel ?? $t('ui.info')}
        {...props}
      >
        <svg
          class="info-tip-icon"
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
    {/snippet}
  </Tooltip.Trigger>
  <Tooltip.Content {side} sideOffset={6} class="info-tip-content max-w-sm text-left whitespace-normal">
    {#if children}
      {@render children()}
    {:else}
      {text}
    {/if}
  </Tooltip.Content>
</Tooltip.Root>

<style>
  .info-tip-trigger {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    margin: 0;
    padding: 0;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: var(--text-muted);
    cursor: help;
  }

  .info-tip-trigger:hover,
  .info-tip-trigger:focus-visible {
    color: var(--text-primary);
  }

  .info-tip-trigger:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }

  .info-tip-icon {
    display: block;
  }

  :global(.info-tip-content) {
    line-height: 1.4;
  }
</style>
